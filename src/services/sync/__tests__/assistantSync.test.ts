/**
 * Deleting one of your own assistants travels with keeping in step: two
 * devices (A, a phone; B, the PC) in memory, with the real merge, apply,
 * read and write. A deletion removes the other copy only if it hasn't
 * changed since; the removed one is kept under Recently deleted and can be
 * restored; more than 5 at once are asked first; store assistants are never
 * deleted; odd entries are ignored.
 */
import {Alert} from 'react-native';

type MockDev = {store: Record<string, string>; pals: any[]};
const mockDevs: Record<string, MockDev> = {};
let mockCur = 'A';
let mockClock = 1_800_000_000_000;
const mockDev = () => mockDevs[mockCur];

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockDev().store[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockDev().store[k] = v;
  }),
}));
jest.mock('../../../utils/globalToolSettings', () => ({
  readGlobalPrompt: async () => '',
  writeGlobalPrompt: async () => {},
}));
jest.mock('../../talents/agentMemory', () => ({
  DEFAULT_MEMORY: 'TEMPLATE\n',
  userMemoryGet: async () => '',
  memoryGet: async () => 'TEMPLATE\n',
  userMemoryReplace: async () => {},
  memoryReplace: async () => {},
}));
jest.mock('../../talents/customTools', () => ({
  listCustomTools: async () => [],
  replaceCustomTools: async () => {},
}));
const mockDropPicture = jest.fn(async () => {});
jest.mock('../../../utils/imageUtils', () => ({
  deletePalThumbnail: (...a: any[]) => mockDropPicture(...(a as [])),
}));
jest.mock('../../../store', () => ({
  palStore: {
    get pals() {
      return mockDev().pals;
    },
    updatePal: async (id: string, fields: any) => {
      Object.assign(
        mockDev().pals.find(p => p.id === id),
        fields,
        {updated_at: new Date(mockClock).toISOString()},
      );
    },
    // As PalStore.deletePal: your own deletion is remembered.
    deletePal: async (id: string, opts: {bySync?: boolean} = {}) => {
      const pals = mockDev().pals;
      const i = pals.findIndex(p => p.id === id);
      const [pal] = pals.splice(i, 1);
      if (!opts.bySync) {
        await require('../assistantDeletes').recordAssistantDeleted(pal);
      }
    },
    reloadFromDatabase: async () => {},
  },
}));
jest.mock('../../../repositories/PalRepository', () => ({
  palRepository: {
    createPal: async (data: any, id?: string) => {
      mockDev().pals.push({
        ...data,
        id,
        updated_at: new Date(mockClock).toISOString(),
      });
    },
  },
}));

import {
  ASSISTANT_ID,
  DELETE_CAP,
  mergeAssistants,
  parseAssistants,
  recentlyDeletedAssistants,
  resetAskingAssistants,
  restoreAssistant,
} from '../assistantDeletes';
import {
  applyItems,
  cleanItems,
  MAX_CLOCK_SKEW,
  merge,
  readItems,
  syncHistory,
} from '../promptSync';
import {readAssistants} from '../syncSources';

const MIN = 60_000;
const DAY = 86_400_000;

const pal = (id: string, name: string, prompt = `${name} prompt`) => ({
  id,
  name,
  systemPrompt: prompt,
  source: 'local',
  thumbnail_url: `${id}.png`,
  defaultModel: {id: 'here-only'},
  updated_at: new Date(mockClock).toISOString(),
});

const on = async <T>(dev: string, f: () => Promise<T>): Promise<T> => {
  mockCur = dev;
  return f();
};
const names = (dev: string) =>
  mockDevs[dev].pals.map(p => p.name as string).sort();
const later = (ms = MIN) => {
  mockClock += ms;
};

/** One sync: A (the phone) sends, B (the PC) merges and answers. */
async function sync() {
  const report = {
    A: {assistantsDeleted: 0, assistantsHeld: 0},
    B: {assistantsDeleted: 0, assistantsHeld: 0},
  };
  const sent = await on('A', () => readItems());
  const merged = await on('B', async () => {
    const m = merge(await readItems(), cleanItems(sent));
    await applyItems(m.items, Date.now(), {from: 'A', report: report.B});
    return m;
  });
  await on('A', () =>
    applyItems(cleanItems(merged.items), Date.now(), {
      from: 'the PC',
      report: report.A,
    }),
  );
  later(1000);
  return report;
}

let alert: jest.SpyInstance;
beforeEach(() => {
  mockClock = 1_800_000_000_000;
  mockDevs.A = {store: {}, pals: []};
  mockDevs.B = {store: {}, pals: []};
  mockDropPicture.mockClear();
  resetAskingAssistants();
  jest.spyOn(Date, 'now').mockImplementation(() => mockClock);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('a deletion on one device deletes it on the other, kept there 30 days', async () => {
  // Made on the PC (with its picture and model there).
  mockDevs.B.pals.push(pal('p1', 'Coder'), pal('p2', 'Writer'));
  await sync();
  expect(names('A')).toEqual(['Coder', 'Writer']);
  later(DAY);
  await on('A', () => require('../../../store').palStore.deletePal('p1'));
  const r = await sync();
  expect(names('A')).toEqual(['Writer']);
  expect(names('B')).toEqual(['Writer']);
  expect(r.B.assistantsDeleted).toBe(1);
  const kept = await on('B', () => recentlyDeletedAssistants());
  expect(kept.map(k => [k.pal.name, k.from])).toEqual([['Coder', 'A']]);
  // Its device-only parts are kept too (the picture file is not removed).
  expect(kept[0].pal.defaultModel).toEqual({id: 'here-only'});
  expect(mockDropPicture).not.toHaveBeenCalled();
  // And it stays gone on both, sync after sync.
  await sync();
  await sync();
  expect(names('A')).toEqual(['Writer']);
  expect(names('B')).toEqual(['Writer']);
});

it('it goes the other way too (deleted on the PC)', async () => {
  mockDevs.B.pals.push(pal('p1', 'Coder'), pal('p2', 'Writer'));
  await sync();
  later(DAY);
  await on('B', () => require('../../../store').palStore.deletePal('p2'));
  const r = await sync();
  expect(names('A')).toEqual(['Coder']);
  expect(names('B')).toEqual(['Coder']);
  expect(r.A.assistantsDeleted).toBe(1);
});

it('a copy changed since the deletion stays, and comes back where it was deleted', async () => {
  mockDevs.A.pals.push(pal('p1', 'Coder'));
  await sync();
  later(DAY);
  await on('A', () => require('../../../store').palStore.deletePal('p1'));
  later(MIN);
  // Edited on the PC after it was deleted on the phone (before they meet).
  mockDevs.B.pals[0].systemPrompt = 'better';
  await on('B', () => readItems());
  later(MIN);
  const r = await sync();
  expect(r.B.assistantsDeleted).toBe(0);
  expect(names('B')).toEqual(['Coder']);
  expect(names('A')).toEqual(['Coder']);
  expect(mockDevs.A.pals[0].systemPrompt).toBe('better');
  // Back for good: not deleted again later.
  await sync();
  expect(names('A')).toEqual(['Coder']);
});

it('a deletion and an edit of another assistant both survive the meeting', async () => {
  mockDevs.A.pals.push(pal('p1', 'Coder'), pal('p2', 'Writer'));
  await sync();
  later(DAY);
  await on('A', () => require('../../../store').palStore.deletePal('p1'));
  later(MIN);
  // The PC's edit is newer than the phone's deletion (whole-list newer-wins
  // would have lost the deletion).
  mockDevs.B.pals.find(p => p.id === 'p2').systemPrompt = 'newer';
  await on('B', () => readItems());
  await sync();
  expect(names('A')).toEqual(['Writer']);
  expect(names('B')).toEqual(['Writer']);
  expect(mockDevs.A.pals[0].systemPrompt).toBe('newer');
});

it('restoring brings it back on the other device too', async () => {
  mockDevs.B.pals.push(pal('p1', 'Coder'));
  await sync();
  later(DAY);
  await on('A', () => require('../../../store').palStore.deletePal('p1'));
  await sync();
  expect(names('B')).toEqual([]);
  later(MIN);
  expect(await on('B', () => restoreAssistant('p1'))).toBe(true);
  expect(names('B')).toEqual(['Coder']);
  // Restored with what belongs to this device.
  expect(mockDevs.B.pals[0].thumbnail_url).toBe('p1.png');
  expect(await on('B', () => recentlyDeletedAssistants())).toEqual([]);
  await sync();
  expect(names('A')).toEqual(['Coder']);
  expect(names('B')).toEqual(['Coder']);
});

it('the starter assistants (same name, own ids) are deleted by name', async () => {
  mockDevs.A.pals.push(pal('a-lookie', 'Lookie', 'look'));
  mockDevs.B.pals.push(pal('b-lookie', 'Lookie', 'look'));
  await sync();
  // Matched by name: no second Lookie on either.
  expect(names('A')).toEqual(['Lookie']);
  expect(names('B')).toEqual(['Lookie']);
  later(DAY);
  await on('A', () => require('../../../store').palStore.deletePal('a-lookie'));
  await sync();
  expect(names('A')).toEqual([]);
  expect(names('B')).toEqual([]);
  await sync();
  expect(names('A')).toEqual([]);
});

it('the same assistants under other ids are no change (no history each sync)', async () => {
  mockDevs.A.pals.push(pal('a-lookie', 'Lookie', 'look'));
  mockDevs.B.pals.push(pal('b-lookie', 'Lookie', 'look'));
  await sync();
  const before = [
    (await on('A', () => syncHistory('assistants'))).length,
    (await on('B', () => syncHistory('assistants'))).length,
  ];
  await sync();
  await sync();
  expect([
    (await on('A', () => syncHistory('assistants'))).length,
    (await on('B', () => syncHistory('assistants'))).length,
  ]).toEqual(before);
});

it('never deletes a downloaded (store) assistant', async () => {
  mockDevs.A.pals.push(pal('p1', 'Tutor'));
  await sync();
  // On the PC, a store assistant with the same name (and one with the id).
  mockDevs.B.pals.push(
    {...pal('hub1', 'Tutor'), source: 'palshub'},
    {...pal('hub2', 'Other'), source: 'palshub'},
  );
  later(DAY);
  await on('A', () => require('../../../store').palStore.deletePal('p1'));
  // A forged deletion of the store one's id, too.
  const now = Date.now();
  const forged = JSON.stringify([{id: 'hub2', name: 'Other', deletedAt: now}]);
  await on('B', () =>
    require('../syncSources').writeAssistants(forged, {from: 'x'}),
  );
  await sync();
  expect(names('B')).toEqual(['Other', 'Tutor']);
  expect(mockDevs.B.pals.every(p => p.source === 'palshub')).toBe(true);
});

it('more than 5 at once: asked first; keeping them brings them back', async () => {
  const many = Array.from({length: DELETE_CAP + 1}, (_, i) =>
    pal(`p${i}`, `A${i}`),
  );
  mockDevs.A.pals.push(...many);
  await sync();
  later(DAY);
  for (const p of many) {
    await on('A', () => require('../../../store').palStore.deletePal(p.id));
  }
  const r = await sync();
  expect(r.B.assistantsHeld).toBe(DELETE_CAP + 1);
  expect(names('B')).toHaveLength(DELETE_CAP + 1);
  expect(alert).toHaveBeenCalledWith(
    'Delete assistants?',
    expect.stringContaining(`${DELETE_CAP + 1} of your assistants`),
    expect.anything(),
    expect.anything(),
  );
  // "Keep them" (on the PC).
  const keep = alert.mock.calls[0][2].find((b: any) => b.text === 'Keep them');
  mockCur = 'B';
  keep.onPress();
  await new Promise(res => setImmediate(res));
  later(MIN);
  await sync();
  expect(names('B')).toHaveLength(DELETE_CAP + 1);
  expect(names('A')).toHaveLength(DELETE_CAP + 1);
});

it('more than 5 at once: "Delete" removes them, kept under Recently deleted', async () => {
  const many = Array.from({length: DELETE_CAP + 1}, (_, i) =>
    pal(`p${i}`, `A${i}`),
  );
  mockDevs.A.pals.push(...many);
  await sync();
  later(DAY);
  for (const p of many) {
    await on('A', () => require('../../../store').palStore.deletePal(p.id));
  }
  await sync();
  const del = alert.mock.calls[0][2].find((b: any) => b.text === 'Delete');
  mockCur = 'B';
  del.onPress();
  await new Promise(res => setImmediate(res));
  await new Promise(res => setImmediate(res));
  expect(names('B')).toEqual([]);
  expect(await on('B', () => recentlyDeletedAssistants())).toHaveLength(
    DELETE_CAP + 1,
  );
  await sync();
  expect(names('A')).toEqual([]);
});

it('recently deleted ones are kept 30 days, then their picture goes', async () => {
  mockDevs.B.pals.push(pal('p1', 'Coder'));
  await sync();
  later(DAY);
  await on('A', () => require('../../../store').palStore.deletePal('p1'));
  await sync();
  later(29 * DAY);
  expect(await on('B', () => recentlyDeletedAssistants())).toHaveLength(1);
  later(2 * DAY);
  expect(await on('B', () => recentlyDeletedAssistants())).toEqual([]);
  expect(mockDropPicture).toHaveBeenCalledWith('p1.png');
});

it('sends deletions with the list, not device-only parts', async () => {
  mockDevs.A.pals.push(pal('p1', 'Coder'), pal('p2', 'Writer'));
  await on('A', () => require('../../../store').palStore.deletePal('p1'));
  const list = JSON.parse(await on('A', () => readAssistants()));
  expect(list).toEqual([
    {id: 'p1', name: 'Coder', deletedAt: mockClock},
    {
      id: 'p2',
      name: 'Writer',
      systemPrompt: 'Writer prompt',
      editedAt: expect.any(Number),
    },
  ]);
});

describe('what comes from the other device is checked', () => {
  const now = 1_800_000_000_000;

  it('ignores malformed entries and deletions from the future', () => {
    const parsed = parseAssistants(
      JSON.stringify([
        null,
        'x',
        {id: 'ok', name: 'Fine', systemPrompt: 's', editedAt: now},
        {id: 'bad id!', name: 'X', systemPrompt: 's'},
        {id: 'noprompt', name: 'X'},
        {id: 'd1', deletedAt: now - 1},
        {id: 'd2', deletedAt: now + MAX_CLOCK_SKEW + 1},
        {id: 'd3', deletedAt: 'soon'},
        {id: 'd4', deletedAt: -5},
        {id: 'x'.repeat(65), deletedAt: now},
        {id: 'ok', deletedAt: now + 1},
        {id: 'n', name: 'y'.repeat(201), deletedAt: now},
      ]),
      0,
      now,
    )!;
    expect(parsed.live.map(e => e.id)).toEqual(['ok']);
    // A live entry and a deletion of the same id: the live one stands.
    expect(parsed.dead).toEqual([
      {id: 'd1', deletedAt: now - 1},
      {id: 'n', deletedAt: now},
    ]);
    expect(parseAssistants('{"not":"a list"}', 0, now)).toBeNull();
    expect(parseAssistants('not json', 0, now)).toBeNull();
    expect(ASSISTANT_ID.test('a'.repeat(64))).toBe(true);
  });

  it('clamps edit times far ahead, so a forged time cannot beat a deletion forever', () => {
    const local = JSON.stringify([{id: 'p1', name: 'C', deletedAt: now}]);
    const remote = JSON.stringify([
      {id: 'p1', name: 'C', systemPrompt: 's', editedAt: now + 365 * DAY},
    ]);
    const m = mergeAssistants(local, remote, now, now, now)!;
    // Taken as at most 5 minutes ahead: newer than this deletion...
    expect(JSON.parse(m.text)[0].editedAt).toBe(now + MAX_CLOCK_SKEW);
    // ...but not than one made after that.
    const later2 = JSON.stringify([
      {id: 'p1', name: 'C', deletedAt: now + MAX_CLOCK_SKEW + 1},
    ]);
    const m2 = mergeAssistants(
      later2,
      m.text,
      now,
      now,
      now + 2 * MAX_CLOCK_SKEW,
    )!;
    expect(JSON.parse(m2.text)).toEqual([
      {id: 'p1', name: 'C', deletedAt: now + MAX_CLOCK_SKEW + 1},
    ]);
  });

  it('a deletion wins a tie; the merge says which side takes what', () => {
    const live = JSON.stringify([
      {id: 'p1', name: 'C', systemPrompt: 's', editedAt: now},
    ]);
    const dead = JSON.stringify([{id: 'p1', name: 'C', deletedAt: now}]);
    const m = mergeAssistants(live, dead, now, now, now)!;
    expect(JSON.parse(m.text)).toEqual([{id: 'p1', name: 'C', deletedAt: now}]);
    expect([m.takenHere, m.takenThere]).toEqual([true, false]);
    // A list from an older app (no times) takes the item's time.
    const old = JSON.stringify([{id: 'p2', name: 'D', systemPrompt: 's'}]);
    const m2 = mergeAssistants('[]', old, 0, now - 5, now)!;
    expect(JSON.parse(m2.text)[0].editedAt).toBe(now - 5);
  });
});
