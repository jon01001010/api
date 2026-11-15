/**
 * Loops kept in step: two devices (A, a phone; B, the PC) in memory, with
 * the real read, merge and apply. Only the definition travels; a loop
 * arrives paused and not started; the newer edit wins; a stop (deletion)
 * travels, is kept 30 days and can be restored; more than 5 at once are
 * asked first; odd or oversize entries are refused.
 */
import {Alert} from 'react-native';

type MockDev = {store: Record<string, string>};
const mockDevs: Record<string, MockDev> = {};
let mockCur = 'A';
let mockClock = 1_800_000_000_000;
const mockDev = () => mockDevs[mockCur];

jest.mock('@react-native-async-storage/async-storage', () => {
  const s = {
    getItem: jest.fn(async (k: string) => mockDev().store[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockDev().store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete mockDev().store[k];
    }),
  };
  return {__esModule: true, default: s, ...s};
});
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
jest.mock('../../../store', () => ({
  palStore: {pals: [], reloadFromDatabase: async () => {}},
}));
jest.mock('../../loops/loopNotify', () => ({
  syncLoopAlarms: async () => {},
}));

import {
  buildLoop,
  loadLoops,
  saveLoopEdit,
  saveLoops,
  startShared,
  stopLoop,
  togglePause,
  updateLoop,
  type Loop,
} from '../../loops/loops';
import {
  changedWhileRunning,
  cleanDefinition,
  LOOP_DELETE_CAP,
  mergeLoops,
  parseLoops,
  readLoopsItem,
  recentlyDeletedLoops,
  resetAskingLoops,
  restoreLoop,
} from '../loopSync';
import {
  applyItems,
  cleanItems,
  describeKeys,
  MAX_CLOCK_SKEW,
  merge,
  readItems,
} from '../promptSync';

const MIN = 60_000;
const DAY = 86_400_000;

const on = async <T>(dev: string, f: () => Promise<T>): Promise<T> => {
  mockCur = dev;
  return f();
};
const later = (ms = MIN) => {
  mockClock += ms;
};

const make = (title: string, prompt = `Help me with ${title}`): Loop => {
  const r = buildLoop({
    templateId: 'custom',
    values: {},
    custom: {title, prompt},
    every: 'day',
    at: {hour: 7, minute: 30},
    maxRuns: 10,
    days: 20,
    battery: {kind: 'charger'},
    now: mockClock,
  });
  if (!r.ok) {
    throw new Error(r.error);
  }
  return r.loop;
};

const add = (dev: string, ...loops: Loop[]) =>
  on(dev, async () => saveLoops([...(await loadLoops()), ...loops]));
const loopsOf = (dev: string) => on(dev, () => loadLoops());
const titles = async (dev: string) =>
  (await loopsOf(dev)).map(l => l.title).sort();

const blank = () => ({
  assistantsDeleted: 0,
  assistantsHeld: 0,
});

/** One sync: A (the phone) sends, B (the PC) merges and answers. */
async function sync() {
  const report = {A: blank() as any, B: blank() as any};
  const sent = await on('A', () => readItems());
  let changedB: string[] = [];
  const merged = await on('B', async () => {
    const m = merge(await readItems(), cleanItems(sent));
    changedB = await applyItems(m.items, Date.now(), {
      from: 'A',
      report: report.B,
    });
    return m;
  });
  const changedA = await on('A', () =>
    applyItems(cleanItems(merged.items), Date.now(), {
      from: 'the PC',
      report: report.A,
    }),
  );
  later(1000);
  return {...report, changedA, changedB, sent, merged};
}

let alert: jest.SpyInstance;
beforeEach(() => {
  mockClock = 1_800_000_000_000;
  mockDevs.A = {store: {}};
  mockDevs.B = {store: {}};
  resetAskingLoops();
  jest.spyOn(Date, 'now').mockImplementation(() => mockClock);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('a new loop travels and arrives paused, not started', async () => {
  await add('B', make('Walk'));
  const r = await sync();
  const [here] = await loopsOf('A');
  expect(here.title).toBe('Walk');
  expect(here.paused).toBe(true);
  expect(here.notStarted).toBe(true);
  expect(here.runs).toBe(0);
  expect(here.at).toEqual({hour: 7, minute: 30});
  expect(here.battery).toEqual({kind: 'charger'});
  expect(here.maxRuns).toBe(10);
  // The PC's copy keeps running as it was.
  const [pc] = await loopsOf('B');
  expect(pc.paused).toBe(false);
  expect(pc.id).toBe(here.id);
  expect(r.A.loopsAdded).toBe(1);
  expect(r.changedA).toContain('loops');
  expect(describeKeys(['loops'])).toBe('Loops');
  // Nothing more moves on the next syncs.
  const again = await sync();
  expect(again.A.loopsAdded ?? 0).toBe(0);
  expect(again.changedA).not.toContain('loops');
  expect(await titles('A')).toEqual(['Walk']);
  expect(await titles('B')).toEqual(['Walk']);
});

it('says where to start loops that came', async () => {
  const {describeLoopReport} = require('../loopSync');
  expect(describeLoopReport({loopsAdded: 2}, 'the PC')).toEqual([
    '2 loops from the PC; start them under Toolbox → Loops',
  ]);
  expect(describeLoopReport({loopsDeleted: 1}, 'the PC')).toEqual([
    '1 loop stopped on the PC; kept 30 days under Recently deleted',
  ]);
});

it('nothing of run state travels', async () => {
  const loop: Loop = {
    ...make('Walk'),
    runs: 4,
    sessionId: 'chat-on-pc',
    paused: true,
    pausedWhy: 'no progress for 2 runs',
    progress: {steps: 'aa', reply: 'bb'},
    nextAt: mockClock + 5 * MIN,
    log: [{at: mockClock, what: 'Run 4: secret reply words'}],
  };
  await add('B', loop);
  const r = await sync();
  const sent = r.merged.items.find(i => i.key === 'loops')!.text;
  for (const word of [
    'chat-on-pc',
    'secret reply words',
    'no progress',
    'sessionId',
    'nextAt',
    'runs"',
    'progress',
    'paused',
    'log',
  ]) {
    expect(sent).not.toContain(word);
  }
  const [here] = await loopsOf('A');
  expect(here.sessionId).toBeUndefined();
  expect(here.runs).toBe(0);
  expect(here.progress).toBeUndefined();
  expect(here.pausedWhy).toBeUndefined();
  expect(here.log.map(l => l.what)).toEqual([
    'Came from the PC (not started here)',
  ]);
});

it('an edit travels and wins by time; each device keeps its own schedule', async () => {
  await add('B', make('Walk'));
  await sync();
  // Started on the phone, ran twice there.
  await on('A', async () => {
    const [l] = await loadLoops();
    await updateLoop(l.id, x => ({...startShared(x, mockClock), runs: 2}));
  });
  later(DAY);
  const [pc] = await loopsOf('B');
  await on('B', () =>
    saveLoopEdit(pc.id, {
      title: 'Long walk',
      prompt: 'Walk 5 km',
      every: 'day',
      at: {hour: 8, minute: 0},
      maxRuns: 12,
      days: 20,
      battery: {kind: 'any'},
    }),
  );
  await sync();
  const [here] = await loopsOf('A');
  expect(here.title).toBe('Long walk');
  expect(here.prompt).toBe('Walk 5 km');
  expect(here.at).toEqual({hour: 8, minute: 0});
  expect(here.maxRuns).toBe(12);
  // Paused here (it was running), with its own runs; resumed by the user.
  expect(here.paused).toBe(true);
  expect(here.pausedWhy).toBe('changed on the PC');
  expect(here.runs).toBe(2);
  expect(here.log[0].what).toBe(
    'Changed on the PC; press Resume to run the new version',
  );
  expect(here.log[0].what).toBe(changedWhileRunning('the PC'));
  const resumed = togglePause(here, mockClock);
  expect(resumed.paused).toBe(false);
  expect(resumed.prompt).toBe('Walk 5 km');
  // Then the phone edits it later: the phone wins.
  later(MIN);
  await on('A', () =>
    saveLoopEdit(here.id, {
      title: 'Short walk',
      prompt: 'Walk 1 km',
      every: 'day',
      at: {hour: 8, minute: 0},
      maxRuns: 12,
      days: 20,
      battery: {kind: 'any'},
    }),
  );
  await sync();
  expect(await titles('B')).toEqual(['Short walk']);
  expect(await titles('A')).toEqual(['Short walk']);
  // The PC's own run state stays its own.
  const [pcNow] = await loopsOf('B');
  expect(pcNow.runs).toBe(0);
  // Changed on the phone while running on the PC: paused there until resumed.
  expect(pcNow.paused).toBe(true);
  expect(pcNow.log[0].what).toBe(changedWhileRunning('A'));
  // In step: nothing moves any more.
  for (let i = 0; i < 2; i++) {
    const again = await sync();
    expect(again.changedA).not.toContain('loops');
    expect(again.changedB).not.toContain('loops');
    expect(again.merged.takenHere).not.toContain('loops');
    expect(again.merged.takenThere).not.toContain('loops');
  }
});

it('an older edit loses to a newer one made on the other device', async () => {
  await add('B', make('Walk'));
  await sync();
  const [l] = await loopsOf('A');
  const edit = (title: string) => ({
    title,
    prompt: 'x',
    every: 'day' as const,
    at: {hour: 7, minute: 30},
    maxRuns: 10,
    days: 20,
  });
  later(MIN);
  await on('B', () => saveLoopEdit(l.id, edit('PC title')));
  await on('B', () => readItems());
  later(MIN);
  await on('A', () => saveLoopEdit(l.id, edit('Phone title')));
  await on('A', () => readItems());
  later(MIN);
  await sync();
  expect(await titles('A')).toEqual(['Phone title']);
  expect(await titles('B')).toEqual(['Phone title']);
});

it('a stop travels, is kept 30 days and can be restored (paused)', async () => {
  await add('B', make('Walk'), make('Read'));
  await sync();
  later(DAY);
  const [walk] = (await loopsOf('A')).filter(l => l.title === 'Walk');
  await on('A', () => stopLoop(walk.id));
  const r = await sync();
  expect(await titles('A')).toEqual(['Read']);
  expect(await titles('B')).toEqual(['Read']);
  expect(r.B.loopsDeleted).toBe(1);
  const kept = await on('B', () => recentlyDeletedLoops());
  expect(kept.map(k => [k.loop.title, k.from])).toEqual([['Walk', 'A']]);
  // Stays gone sync after sync.
  await sync();
  expect(await titles('B')).toEqual(['Read']);
  // Restored on the PC: back there paused, and back on the phone too.
  later(MIN);
  expect(await on('B', () => restoreLoop(walk.id))).toBe(true);
  const back = (await loopsOf('B')).find(l => l.id === walk.id)!;
  expect(back.paused).toBe(true);
  await sync();
  expect(await titles('A')).toEqual(['Read', 'Walk']);
  const onPhone = (await loopsOf('A')).find(l => l.id === walk.id)!;
  expect(onPhone.paused).toBe(true);
  expect(onPhone.notStarted).toBe(true);
  expect(await on('B', () => recentlyDeletedLoops())).toEqual([]);
});

it('a copy changed since the stop stays, and comes back where it was stopped', async () => {
  await add('A', make('Walk'));
  await sync();
  later(DAY);
  const [l] = await loopsOf('A');
  await on('A', () => stopLoop(l.id));
  later(MIN);
  await on('B', () =>
    saveLoopEdit(l.id, {
      title: 'Walk more',
      prompt: 'more',
      every: 'day',
      at: {hour: 7, minute: 30},
      maxRuns: 10,
      days: 20,
    }),
  );
  await on('B', () => readItems());
  later(MIN);
  await sync();
  expect(await titles('B')).toEqual(['Walk more']);
  expect(await titles('A')).toEqual(['Walk more']);
  const [back] = await loopsOf('A');
  expect(back.notStarted).toBe(true);
});

it('more than 5 stops in one sync are asked first', async () => {
  const many = Array.from({length: LOOP_DELETE_CAP + 1}, (_, i) =>
    make(`Loop ${i}`),
  );
  await add('B', ...many);
  await sync();
  later(DAY);
  for (const l of many) {
    await on('A', () => stopLoop(l.id));
  }
  const r = await sync();
  expect(r.B.loopsHeld).toBe(LOOP_DELETE_CAP + 1);
  expect((await loopsOf('B')).length).toBe(LOOP_DELETE_CAP + 1);
  expect(alert).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls[0][0]).toBe('Remove loops?');
  // "Remove": removed and kept under Recently deleted.
  mockCur = 'B';
  const buttons = alert.mock.calls[0][2];
  buttons.find((b: any) => b.text === 'Remove').onPress();
  await new Promise(res => setImmediate(res));
  await new Promise(res => setImmediate(res));
  expect((await loopsOf('B')).length).toBe(0);
  expect((await on('B', () => recentlyDeletedLoops())).length).toBe(
    LOOP_DELETE_CAP + 1,
  );
});

it('malformed, oversize and future entries are refused', () => {
  const now = mockClock;
  const good = {
    id: 'ok1',
    title: 'Walk',
    prompt: 'Walk',
    every: 'day',
    at: {hour: 7, minute: 0},
    maxRuns: 10,
    days: 10,
    editedAt: now,
  };
  const list = [
    good,
    {...good, id: 'bad id!'},
    {...good, id: 'big', prompt: 'x'.repeat(20_000)},
    {...good, id: 'notitle', title: ''},
    {...good, id: 'noprompt', prompt: ''},
    {...good, id: 'limits', maxRuns: 9999, days: 9999},
    {...good, id: 'future', editedAt: now + DAY},
    {id: 'gone', deletedAt: now + DAY},
    {id: 'gone2', deletedAt: 'x'},
    {id: 'gone3', title: 'Old', deletedAt: now - MIN},
    'junk',
    null,
    {...good, id: 'runs', runs: 50, sessionId: 's', paused: false, log: [1]},
  ];
  const p = parseLoops(JSON.stringify(list), now, now)!;
  expect(p.live.map(e => e.id).sort()).toEqual([
    'future',
    'limits',
    'ok1',
    'runs',
  ]);
  const lim = p.live.find(e => e.id === 'limits')!;
  expect(lim.maxRuns).toBeLessThanOrEqual(60);
  expect(lim.days).toBeLessThanOrEqual(60);
  expect(p.live.find(e => e.id === 'future')!.editedAt).toBe(
    now + MAX_CLOCK_SKEW,
  );
  const runs = p.live.find(e => e.id === 'runs') as any;
  expect(runs.sessionId).toBeUndefined();
  expect(runs.runs).toBeUndefined();
  expect(runs.log).toBeUndefined();
  expect(p.dead.map(t => t.id)).toEqual(['gone3']);
  expect(parseLoops('not json', now, now)).toBeNull();
  expect(parseLoops('{}', now, now)).toBeNull();
  expect(mergeLoops('nope', '[]', 0, 0, now)).toBeNull();
  expect(cleanDefinition({title: 'x'}, now)).toBeNull();
});

it('a forged far-future edit time cannot win forever', async () => {
  await add('B', make('Walk'));
  await sync();
  const [l] = await loopsOf('A');
  // The PC sends an edit claimed a year ahead: taken as 5 minutes ahead.
  const forged = JSON.stringify([
    {
      id: l.id,
      title: 'Forged',
      prompt: 'x',
      every: 'day',
      at: {hour: 7, minute: 30},
      maxRuns: 10,
      days: 20,
      editedAt: mockClock + 365 * DAY,
    },
  ]);
  const local = await on('A', () => readLoopsItem());
  const m = mergeLoops(local, forged, 0, 0, mockClock)!;
  expect(JSON.parse(m.text)[0].editedAt).toBe(mockClock + MAX_CLOCK_SKEW);
  await on('A', () =>
    applyItems([{key: 'loops', text: m.text, updatedAt: mockClock}]),
  );
  expect(await titles('A')).toEqual(['Forged']);
  // A later edit on the phone (after the skew) wins over it.
  later(MAX_CLOCK_SKEW + MIN);
  await on('A', () =>
    saveLoopEdit(l.id, {
      title: 'Mine',
      prompt: 'y',
      every: 'day',
      at: {hour: 7, minute: 30},
      maxRuns: 10,
      days: 20,
    }),
  );
  await sync();
  expect(await titles('B')).toEqual(['Mine']);
});

it('no room: a device with 10 loops says so and keeps its own', async () => {
  await add('A', ...Array.from({length: 10}, (_, i) => make(`Mine ${i}`)));
  await add('B', make('From PC'));
  const r = await sync();
  expect((await loopsOf('A')).length).toBe(10);
  expect(r.A.loopsNoRoom).toBe(1);
  // Nothing on the phone was deleted because of it.
  expect((await loopsOf('B')).length).toBe(10);
  expect(r.B.loopsNoRoom).toBe(1);
});

it('a loop with a plan arrives with its goal and steps', async () => {
  const {loopPromptOf, blankDraft} = require('../../loops/makeLoop');
  const steps = ['Pick a book', 'Read 10 pages'];
  const r = buildLoop({
    templateId: 'custom',
    values: {},
    custom: {
      title: 'Reading',
      prompt: loopPromptOf({...blankDraft(''), prompt: 'Read more', steps}),
      plan: {goal: 'Read more', steps},
    },
    every: 'week',
    at: {hour: 18, minute: 0},
    maxRuns: 8,
    days: 56,
    now: mockClock,
  });
  if (!r.ok) {
    throw new Error(r.error);
  }
  await add('A', r.loop);
  await sync();
  const [pc] = await loopsOf('B');
  expect(pc.plan).toEqual({goal: 'Read more', steps});
  expect(pc.prompt).toBe(r.loop.prompt);
  expect(pc.every).toBe('week');
  expect(pc.notStarted).toBe(true);
  const again = await sync();
  expect(again.merged.takenHere).not.toContain('loops');
  expect(again.merged.takenThere).not.toContain('loops');
});
