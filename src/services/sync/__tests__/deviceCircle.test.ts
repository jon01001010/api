/**
 * All devices in one circle, stage 3: three devices keep in step and settle
 * on the same result (docs/design/device-circle.md).
 *
 * Desktop (a PC, home), Laptop (a PC: home for the Phone, and a device of
 * the Desktop) and Phone (a device of both PCs). Each has its own storage,
 * chat database, assistants, memory, loops and clock. The JS sync layer has
 * no notion of "a PC that is a device of another PC" beyond this: the
 * Laptop answers the Phone with the PC side (hostSync.web.ts answerSync)
 * and dials the Desktop with the device side (deviceSync.ts syncWithPc), on
 * the same storage. Every sync here goes through those real paths (read,
 * merge, apply, chat mirroring and tombstones); only the link is replaced
 * by a direct call.
 *
 * The three pairs (Phone→Desktop, Phone→Laptop, Laptop→Desktop) sync in
 * every order (all 6), and in seeded random orders, until a round changes
 * nothing. Then: every device has the same items, assistants, loops and
 * chats; a further round changes nothing (no ping-pong, no history, no
 * notices); deletions stay deleted; what the rules keep (history, Recently
 * deleted, up to 3 versions of a chat) is kept.
 *
 * Edits count from a device's next look (`readItems`); each edit here is
 * looked at right away, so the expected winner is the later edit.
 */
import {Alert, NativeModules} from 'react-native';

type Row = Record<string, any> & {id: string};
type MockDev = {
  name: string;
  store: Record<string, string>;
  pals: any[];
  db: {chat_sessions: Map<string, Row>; messages: Map<string, Row>};
  prompt: string;
  userMem: string;
  modelMem: string;
  userMemHistory: string[];
  modelMemHistory: string[];
  tools: any[];
  /** This device's clock minus the real time (ms). */
  skew: number;
};
const mockDevs: Record<string, MockDev> = {};
let mockCur = 'phone';
/** The real time; each device reads it plus its own skew. */
let mockClock = 1_800_000_000_000;
const mockDev = () => mockDevs[mockCur];
const mockNow = () => mockClock + mockDev().skew;

jest.mock('@react-native-async-storage/async-storage', () => {
  const s = {
    getItem: async (k: string) => mockDev().store[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockDev().store[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockDev().store[k];
    },
  };
  return {__esModule: true, default: s, ...s};
});
jest.mock('../../../utils/globalToolSettings', () => ({
  readGlobalPrompt: async () => mockDev().prompt,
  writeGlobalPrompt: async (t: string) => {
    mockDev().prompt = t;
  },
}));
jest.mock('../../talents/agentMemory', () => ({
  DEFAULT_MEMORY: 'TEMPLATE\n',
  userMemoryGet: async () => mockDev().userMem,
  memoryGet: async () => mockDev().modelMem,
  // As the real ones: refused if changed since read; the earlier kept.
  userMemoryReplace: async (next: string, previous: string) => {
    const d = mockDev();
    if (d.userMem !== previous) {
      throw new Error('User memory changed; reload before saving');
    }
    d.userMemHistory.push(previous);
    d.userMem = next;
  },
  memoryReplace: async (next: string, previous: string) => {
    const d = mockDev();
    if (d.modelMem !== previous) {
      throw new Error('Memory changed since it was read');
    }
    d.modelMemHistory.push(previous);
    d.modelMem = next;
  },
}));
jest.mock('../../talents/customTools', () => ({
  listCustomTools: async () => mockDev().tools,
  replaceCustomTools: async (list: any[]) => {
    mockDev().tools = list;
  },
}));
jest.mock('../../../utils/imageUtils', () => ({
  deletePalThumbnail: async () => {},
}));
jest.mock('../../loops/loopNotify', () => ({
  syncLoopAlarms: async () => {},
}));
jest.mock('@tauri-apps/api/core', () => ({invoke: jest.fn(async () => {})}));
jest.mock('@tauri-apps/api/event', () => ({listen: jest.fn()}));
jest.mock('../../../store', () => ({
  palStore: {
    get pals() {
      return mockDev().pals;
    },
    updatePal: async (id: string, fields: any) => {
      Object.assign(
        mockDev().pals.find(p => p.id === id),
        fields,
        {
          updated_at: new Date(mockNow()).toISOString(),
        },
      );
    },
    // As PalStore.deletePal: your own deletion is remembered.
    deletePal: async (id: string, opts: {bySync?: boolean} = {}) => {
      const pals = mockDev().pals;
      const [pal] = pals.splice(
        pals.findIndex(p => p.id === id),
        1,
      );
      if (!opts.bySync) {
        await require('../assistantDeletes').recordAssistantDeleted(pal);
      }
    },
    reloadFromDatabase: async () => {},
  },
  chatSessionStore: {
    activeSessionId: undefined,
    resetActiveSession: () => {},
    loadSessionList: async () => {},
  },
}));
jest.mock('../../../repositories/PalRepository', () => ({
  palRepository: {
    createPal: async (data: any, id?: string) => {
      mockDev().pals.push({
        ...data,
        id,
        updated_at: new Date(mockNow()).toISOString(),
      });
    },
  },
}));
jest.mock('../../../repositories/ChatSessionRepository', () => ({
  chatSessionRepository: {
    deleteSessions: async (ids: string[]) => {
      const db = mockDev().db;
      for (const id of ids) {
        db.chat_sessions.delete(id);
        for (const m of [...db.messages.values()]) {
          if (m.session_id === id) {
            db.messages.delete(m.id);
          }
        }
      }
    },
  },
}));
// The chat database (WatermelonDB) of the current device, as chatSync.ts
// uses it: rows by id, `Q.where` on one column, prepared writes in a batch.
jest.mock('@nozbe/watermelondb', () => ({
  ...jest.requireActual('@nozbe/watermelondb'),
  Q: {where: (left: string, value: unknown) => ({left, value})},
}));
jest.mock('../../../database', () => {
  const record = (rows: Map<string, any>, raw: any) => ({
    id: raw.id,
    _raw: raw,
    prepareUpdate: (fn: (r: any) => void) => () => fn({_raw: raw}),
    prepareDestroyPermanently: () => () => rows.delete(raw.id),
  });
  const table = (name: 'chat_sessions' | 'messages') => {
    const rows = (): Map<string, any> => mockDev().db[name];
    return {
      find: async (id: string) => {
        const raw = rows().get(id);
        if (!raw) {
          throw new Error('not found');
        }
        return record(rows(), raw);
      },
      query: (...conds: any[]) => ({
        fetch: async () =>
          [...rows().values()]
            .filter(raw => conds.every(c => raw[c.left] === c.value))
            .map(raw => record(rows(), raw)),
      }),
      prepareCreate: (fn: (r: any) => void) => {
        const here = rows();
        return () => {
          const r = {_raw: {} as any};
          fn(r);
          here.set(r._raw.id, r._raw);
        };
      },
    };
  };
  return {
    database: {
      collections: {get: (t: 'chat_sessions' | 'messages') => table(t)},
      write: async (fn: () => Promise<void>) => fn(),
      batch: async (...ops: (() => void)[]) => ops.forEach(op => op()),
    },
  };
});

import {
  buildLoop,
  loadLoops,
  saveLoopEdit,
  saveLoops,
  stopLoop as stopLoopHere,
  type Loop,
} from '../../loops/loops';
import {
  knownAssistantTombstones,
  portablePal,
  recentlyDeletedAssistants,
  resetAskingAssistants,
} from '../assistantDeletes';
import {
  knownTombstones,
  MAX_VERSIONS,
  recentlyDeleted,
  recordChatsDeleted,
  restoreDeleted,
  type RecentlyDeleted,
} from '../chatDeletes';
import {readAllChats, versionOf} from '../chatSync';
import {setMirrorChats, syncWithPc, type SyncOutcome} from '../deviceSync';
import {answerSync, resetKeptInStepNotice} from '../hostSync.web';
import {
  definitionOf,
  knownLoopTombstones,
  recentlyDeletedLoops,
  resetAskingLoops,
} from '../loopSync';
import {
  MAX_CLOCK_SKEW,
  promptHistory,
  readItems,
  SYNC_KEYS,
  syncHistory,
} from '../promptSync';

const SEC = 1000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const USER = 'y9d7f8pgn';

type Name = 'desktop' | 'laptop' | 'phone';
const NAMES: Name[] = ['desktop', 'laptop', 'phone'];
/** Who dials whom: [device, home PC]. */
const PAIRS: [Name, Name][] = [
  ['phone', 'desktop'],
  ['phone', 'laptop'],
  ['laptop', 'desktop'],
];
const PAIR_LABEL = ['phone→desktop', 'phone→laptop', 'laptop→desktop'];

const fresh = (name: string): MockDev => ({
  name,
  store: {},
  pals: [],
  db: {chat_sessions: new Map(), messages: new Map()},
  prompt: '',
  userMem: '',
  modelMem: 'TEMPLATE\n',
  userMemHistory: [],
  modelMemHistory: [],
  tools: [],
  skew: 0,
});

const on = async <T>(dev: Name, f: () => Promise<T>): Promise<T> => {
  mockCur = dev;
  return f();
};
const tick = (ms: number) => {
  mockClock += ms;
};

let alerts: string[] = [];
/** The user's yes to "Take the … from …?", given after each sync. */
let takes: (() => Promise<unknown>)[] = [];

beforeEach(async () => {
  mockClock = 1_800_000_000_000;
  mockDevs.desktop = fresh('Desktop');
  mockDevs.laptop = fresh('Laptop');
  mockDevs.phone = fresh('Phone');
  resetAskingAssistants();
  resetAskingLoops();
  resetKeptInStepNotice();
  alerts = [];
  takes = [];
  require('../promptSync').resetAsking();
  jest.spyOn(Date, 'now').mockImplementation(() => mockNow());
  jest
    .spyOn(Alert, 'alert')
    .mockImplementation((title: string, _m?: string, buttons?: any[]) => {
      // A new system prompt or "your memory" notes from another device are
      // asked first (review 2026-11-17): the user says yes, on that device,
      // once the sync is through.
      if (title.startsWith('Take the ')) {
        const dev = mockCur as Name;
        const take = buttons?.find(b => b.text === 'Take it');
        takes.push(() => on(dev, () => take.onPress()));
        return;
      }
      alerts.push(title);
      // "Kept in step" notices are closed at once (one at a time).
      if (title === 'Kept in step' || title === 'Kept in step with your PC') {
        buttons?.[0]?.onPress?.();
      }
    });
  // Each PC lets its devices keep in step and mirror chats.
  (globalThis as any).localStorage = {
    getItem: (k: string) =>
      k === 'pa-link-sync' || k === 'pa-link-mirror' ? 'on' : null,
    setItem: () => {},
  };
  // The link: the dialing device's request answered by that PC's screens,
  // on the PC's own storage and clock.
  (NativeModules as any).HomeLink = {
    sync: async (pc: Name, body: string) => {
      const caller = mockCur as Name;
      mockCur = pc;
      try {
        return await answerSync(body, mockDevs[caller].name);
      } finally {
        mockCur = caller;
      }
    },
  };
  for (const [device, pc] of PAIRS) {
    await on(device, () => setMirrorChats(pc, true));
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  delete (NativeModules as any).HomeLink;
  delete (globalThis as any).localStorage;
});

// ---------------------------------------------------------------- orders

/** Seeded random numbers (Park-Miller), so a failing order can be rerun. */
function rng(seed: number) {
  let a = (seed % 2147483646) + 1;
  return () => {
    a = (a * 16807) % 2147483647;
    return (a - 1) / 2147483646;
  };
}

/** Which pairs sync in one round (each round has every pair at least once). */
type Order = {label: string; make: () => () => number[]};

const PERMUTATIONS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const ORDERS: Order[] = [
  ...PERMUTATIONS.map(p => ({
    label: p.map(i => PAIR_LABEL[i]).join(', '),
    make: () => () => p,
  })),
  ...[7, 42, 1234].map(seed => ({
    label: `random (seed ${seed})`,
    make: () => {
      const r = rng(seed);
      return () => {
        // A shuffled round, sometimes with a pair again in between.
        const p = [0, 1, 2].sort(() => r() - 0.5);
        const extra = Math.floor(r() * 3);
        for (let i = 0; i < extra; i++) {
          p.splice(Math.floor(r() * (p.length + 1)), 0, Math.floor(r() * 3));
        }
        return p;
      };
    },
  })),
];

// ---------------------------------------------------------------- syncing

async function syncPair(i: number): Promise<SyncOutcome> {
  const [device, pc] = PAIRS[i];
  const r = await on(device, () => syncWithPc(pc));
  if (!r.ok) {
    throw new Error(`${PAIR_LABEL[i]}: ${r.error}`);
  }
  for (const take of takes.splice(0)) {
    await take();
  }
  tick(SEC);
  return r;
}

async function round(
  next: () => number[],
  only: number[] = [0, 1, 2],
): Promise<SyncOutcome[]> {
  const out: SyncOutcome[] = [];
  for (const i of next()) {
    if (only.includes(i)) {
      out.push(await syncPair(i));
    }
  }
  return out;
}

/** What a device has (ids of assistants differ for each device's starters). */
async function contentOf(dev: Name) {
  return on(dev, async () => {
    const d = mockDev();
    return {
      prompt: d.prompt,
      userMem: d.userMem,
      modelMem: d.modelMem,
      tools: JSON.stringify(d.tools),
      assistants: d.pals
        .filter(p => (p.source ?? 'local') === 'local')
        .map(p => JSON.stringify(portablePal({...p, id: undefined})))
        .sort(),
      loops: (await loadLoops())
        .map(l => `${l.id} ${JSON.stringify(definitionOf(l))}`)
        .sort(),
      chats: [...(await readAllChats()).values()]
        .map(c => {
          const v = versionOf(c);
          return `${v.id} ${v.print} ${v.count}`;
        })
        .sort(),
    };
  });
}

/** Content and deletions known: what a round may still move. */
async function moving() {
  const out: unknown[] = [];
  for (const dev of NAMES) {
    out.push(await contentOf(dev));
    out.push(
      await on(dev, async () => [
        (await knownAssistantTombstones()).map(t => t.id).sort(),
        (await knownLoopTombstones()).map(t => t.id).sort(),
        (await knownTombstones()).map(t => t.id).sort(),
      ]),
    );
  }
  return JSON.stringify(out);
}

/** Everything a quiet round must leave as it is (also history and kept). */
async function everything() {
  const out: unknown[] = [await moving()];
  for (const dev of NAMES) {
    out.push(
      await on(dev, async () => ({
        history: await Promise.all(
          SYNC_KEYS.map(async k => (await syncHistory(k)).length),
        ),
        memory: [
          mockDev().userMemHistory.length,
          mockDev().modelMemHistory.length,
        ],
        kept: [
          (await recentlyDeletedAssistants()).length,
          (await recentlyDeletedLoops()).length,
          (await recentlyDeleted()).length,
        ],
      })),
    );
  }
  return out;
}

/** Rounds until one changes nothing; returns how many it took. */
async function settle(
  next: () => number[],
  only: number[] = [0, 1, 2],
): Promise<number> {
  for (let i = 1; i <= 12; i++) {
    const before = await moving();
    await round(next, only);
    if ((await moving()) === before) {
      return i;
    }
  }
  throw new Error('Not settled after 12 rounds (ping-pong?)');
}

/** Every device has the same items, assistants, loops and chats. */
async function expectSame() {
  const desktop = await contentOf('desktop');
  expect(await contentOf('laptop')).toEqual(desktop);
  expect(await contentOf('phone')).toEqual(desktop);
  return desktop;
}

/** A further full round moves nothing, writes no history, says nothing. */
async function expectQuiet(next: () => number[]) {
  const before = await everything();
  const shown = alerts.length;
  for (const r of await round(next)) {
    expect(r).toMatchObject({
      ok: true,
      changedHere: [],
      changedOnPc: [],
      chatsSent: 0,
      chatsReceived: 0,
      chatsDeleted: 0,
      chatsHeld: 0,
    });
    expect(r).not.toHaveProperty('assistantsDeleted');
    expect(r).not.toHaveProperty('assistantsHeld');
    expect(r).not.toHaveProperty('loops');
  }
  expect(await everything()).toEqual(before);
  expect(alerts.slice(shown)).toEqual([]);
}

/** Settled, the same everywhere, and quiet. */
async function settleAll(next: () => number[]) {
  await settle(next);
  const same = await expectSame();
  await expectQuiet(next);
  return same;
}

// ---------------------------------------------------------------- the user

/** The app looks (the edit's time is the time of the next look). */
const look = (dev: Name) => on(dev, () => readItems());

async function setPrompt(dev: Name, text: string) {
  mockDevs[dev].prompt = text;
  await look(dev);
}
async function setUserMem(dev: Name, text: string) {
  mockDevs[dev].userMem = text;
  await look(dev);
}
async function setModelMem(dev: Name, text: string) {
  mockDevs[dev].modelMem = text;
  await look(dev);
}

async function addPal(dev: Name, id: string, name: string, prompt = name) {
  await on(dev, async () => {
    mockDev().pals.push({
      id,
      name,
      systemPrompt: prompt,
      source: 'local',
      // As the database makes them.
      isSystemPromptChanged: false,
      useAIPrompt: false,
      parameters: {},
      parameterSchema: [],
      thumbnail_url: `${dev}-${id}.png`,
      defaultModel: {id: `${dev}-model`},
      updated_at: new Date(mockNow()).toISOString(),
    });
  });
  await look(dev);
}
const palNamed = (dev: Name, name: string) =>
  mockDevs[dev].pals.find(p => p.name === name);
async function editPal(dev: Name, name: string, prompt: string) {
  await on(dev, () =>
    require('../../../store').palStore.updatePal(palNamed(dev, name).id, {
      systemPrompt: prompt,
    }),
  );
  await look(dev);
}
async function deletePal(dev: Name, name: string) {
  await on(dev, () =>
    require('../../../store').palStore.deletePal(palNamed(dev, name).id),
  );
  await look(dev);
}
const palNames = (dev: Name) =>
  mockDevs[dev].pals.map(p => p.name as string).sort();
const promptOf = (dev: Name, name: string) => palNamed(dev, name)?.systemPrompt;

async function addLoop(dev: Name, title: string): Promise<string> {
  const id = await on(dev, async () => {
    const r = buildLoop({
      templateId: 'custom',
      values: {},
      custom: {title, prompt: `Help me with ${title}`},
      every: 'day',
      at: {hour: 7, minute: 30},
      maxRuns: 10,
      days: 20,
      battery: {kind: 'charger'},
      now: mockNow(),
    });
    if (!r.ok) {
      throw new Error(r.error);
    }
    await saveLoops([...(await loadLoops()), r.loop]);
    return r.loop.id;
  });
  await look(dev);
  return id;
}
async function editLoop(dev: Name, id: string, title: string, prompt: string) {
  const r = await on(dev, () =>
    saveLoopEdit(id, {
      title,
      prompt,
      every: 'day',
      at: {hour: 7, minute: 30},
      maxRuns: 10,
      days: 20,
      battery: {kind: 'charger'},
    }),
  );
  if (!r.ok) {
    throw new Error(r.error);
  }
  await look(dev);
}
async function stopLoop(dev: Name, id: string) {
  await on(dev, () => stopLoopHere(id));
  await look(dev);
}
const loopsOf = (dev: Name): Promise<Loop[]> => on(dev, () => loadLoops());
const loopTitles = async (dev: Name) =>
  (await loopsOf(dev)).map(l => l.title).sort();

let msgCount = 0;
function newChat(dev: Name, id: string, texts: string[]) {
  const db = mockDevs[dev].db;
  const at = mockClock + mockDevs[dev].skew;
  db.chat_sessions.set(id, {
    id,
    title: id,
    pinned: false,
    created_at: at,
    updated_at: at,
  });
  texts.forEach(t => addMessage(dev, id, t));
}
function addMessage(dev: Name, chat: string, text: string) {
  const db = mockDevs[dev].db;
  const at = mockClock + mockDevs[dev].skew;
  const position = [...db.messages.values()].filter(
    m => m.session_id === chat,
  ).length;
  const id = `${chat}-${dev}-${++msgCount}`;
  db.messages.set(id, {
    id,
    session_id: chat,
    author: USER,
    text,
    type: 'text',
    created_at: at,
    metadata: '{}',
    position,
  });
  db.chat_sessions.get(chat)!.updated_at = at;
}
async function deleteChat(dev: Name, id: string) {
  await on(dev, async () => {
    await require('../../../repositories/ChatSessionRepository').chatSessionRepository.deleteSessions(
      [id],
    );
    await recordChatsDeleted([id]);
  });
}
const chatIds = (dev: Name) =>
  [...mockDevs[dev].db.chat_sessions.keys()].sort();
const chatTexts = (dev: Name, chat: string) =>
  [...mockDevs[dev].db.messages.values()]
    .filter(m => m.session_id === chat)
    .sort((a, b) => a.position - b.position)
    .map(m => m.text);
const keptChats = (dev: Name): Promise<RecentlyDeleted[]> =>
  on(dev, () => recentlyDeleted());
const keptTexts = (r: RecentlyDeleted) => r.chat.messages.map(m => m.text);

// ---------------------------------------------------------------- scenarios

describe.each(ORDERS)('three devices, $label', order => {
  let next: () => number[];
  beforeEach(() => {
    next = order.make();
  });

  it('system prompt, memory and custom tools: the newer edit wins on all three, the rest kept in history', async () => {
    await setPrompt('desktop', 'Desktop prompt');
    tick(MIN);
    await setUserMem('laptop', 'Laptop notes');
    tick(MIN);
    await setModelMem('phone', 'Phone model notes');
    mockDevs.laptop.tools = [{name: 'weather', code: 'x'}];
    await look('laptop');
    tick(MIN);
    const first = await settleAll(next);
    expect(first).toMatchObject({
      prompt: 'Desktop prompt',
      userMem: 'Laptop notes',
      modelMem: 'Phone model notes',
      tools: JSON.stringify([{name: 'weather', code: 'x'}]),
    });

    // Two edits of the same item on different devices: the later wins.
    tick(HOUR);
    await setPrompt('phone', 'Phone prompt');
    tick(MIN);
    await setPrompt('laptop', 'Laptop prompt');
    tick(MIN);
    await setUserMem('desktop', 'Desktop notes');
    const second = await settleAll(next);
    expect(second.prompt).toBe('Laptop prompt');
    expect(second.userMem).toBe('Desktop notes');
    // What each device had is kept in its history.
    const kept = async (dev: Name) =>
      (await on(dev, () => promptHistory())).map(h => h.text);
    expect(await kept('desktop')).toContain('Desktop prompt');
    expect(await kept('phone')).toContain('Phone prompt');
    expect(mockDevs.laptop.userMemHistory).toContain('Laptop notes');
  });

  it('assistants added, edited and deleted on different devices (deletion against a later and an earlier edit)', async () => {
    await addPal('desktop', 'd1', 'Coder');
    await addPal('desktop', 'd2', 'Writer');
    // Each device made its own starter assistant (own id, same name).
    await addPal('desktop', 'desk-lookie', 'Lookie', 'look');
    await addPal('laptop', 'lap-lookie', 'Lookie', 'look');
    await addPal('phone', 'pho-lookie', 'Lookie', 'look');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(palNames(dev)).toEqual(['Coder', 'Lookie', 'Writer']);
    }
    // Each keeps its own starter id.
    expect(palNamed('laptop', 'Lookie').id).toBe('lap-lookie');

    tick(DAY);
    await deletePal('phone', 'Coder');
    tick(MIN);
    await editPal('laptop', 'Writer', 'Writer v2');
    tick(MIN);
    await addPal('desktop', 'd3', 'Tutor');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(palNames(dev)).toEqual(['Lookie', 'Tutor', 'Writer']);
      expect(promptOf(dev, 'Writer')).toBe('Writer v2');
    }
    // Removed because of another device's deletion: kept there.
    for (const dev of ['desktop', 'laptop'] as Name[]) {
      const kept = await on(dev, () => recentlyDeletedAssistants());
      expect(kept.map(k => k.pal.name)).toEqual(['Coder']);
    }

    tick(DAY);
    // Deleted on the Desktop, then edited on the Phone (not told yet): back.
    await deletePal('desktop', 'Writer');
    tick(MIN);
    await editPal('phone', 'Writer', 'Writer v3');
    // Edited on the Laptop, then deleted on the Phone: gone.
    await editPal('laptop', 'Tutor', 'Tutor v2');
    tick(MIN);
    await deletePal('phone', 'Tutor');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(palNames(dev)).toEqual(['Lookie', 'Writer']);
      expect(promptOf(dev, 'Writer')).toBe('Writer v3');
    }
    // The Laptop's edit is not lost: kept under Recently deleted there.
    const lapKept = await on('laptop', () => recentlyDeletedAssistants());
    expect(lapKept.find(k => k.pal.name === 'Tutor')?.pal.systemPrompt).toBe(
      'Tutor v2',
    );

    // A starter deleted on one device goes on all (matched by name).
    tick(DAY);
    await deletePal('laptop', 'Lookie');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(palNames(dev)).toEqual(['Writer']);
    }
    // Deletions don't come back, round after round.
    await settleAll(next);
    for (const dev of NAMES) {
      expect(palNames(dev)).toEqual(['Writer']);
    }
    expect(
      alerts.filter(
        a => a !== 'Kept in step' && a !== 'Kept in step with your PC',
      ),
    ).toEqual([]);
  });

  it('loops added, edited and stopped on different devices', async () => {
    const walk = await addLoop('desktop', 'Walk');
    const read = await addLoop('laptop', 'Read');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(await loopTitles(dev)).toEqual(['Read', 'Walk']);
    }
    // Arrived paused and not started; the Desktop's own keeps running.
    const onPhone = await loopsOf('phone');
    expect(onPhone.every(l => l.paused && l.notStarted)).toBe(true);
    expect((await loopsOf('desktop')).find(l => l.id === walk)!.paused).toBe(
      false,
    );

    tick(HOUR);
    await editLoop('phone', walk, 'Long walk', 'Walk 5 km');
    tick(MIN);
    await stopLoop('laptop', read);
    tick(MIN);
    await addLoop('phone', 'Stretch');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(await loopTitles(dev)).toEqual(['Long walk', 'Stretch']);
    }
    for (const dev of ['desktop', 'phone'] as Name[]) {
      const kept = await on(dev, () => recentlyDeletedLoops());
      expect(kept.map(k => k.loop.title)).toEqual(['Read']);
    }

    // Stopped on the Desktop, edited later on the Laptop: back everywhere.
    tick(HOUR);
    await stopLoop('desktop', walk);
    tick(MIN);
    await editLoop('laptop', walk, 'Short walk', 'Walk 1 km');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(await loopTitles(dev)).toEqual(['Short walk', 'Stretch']);
    }
    // Read stays stopped.
    for (const dev of NAMES) {
      expect((await loopsOf(dev)).some(l => l.id === read)).toBe(false);
    }
  });

  it('mirrored chats added, edited and deleted; earlier versions kept (up to 3, the first always)', async () => {
    newChat('phone', 'c1', ['hello from the phone']);
    newChat('desktop', 'c2', ['desktop chat']);
    newChat('laptop', 'c3', ['laptop chat']);
    tick(MIN);
    await settleAll(next);
    for (const dev of NAMES) {
      expect(chatIds(dev)).toEqual(['c1', 'c2', 'c3']);
    }

    tick(HOUR);
    addMessage('phone', 'c1', 'more');
    await deleteChat('laptop', 'c3');
    // The same chat on two devices: the later change wins the whole chat.
    addMessage('desktop', 'c2', 'from desktop');
    tick(MIN);
    addMessage('phone', 'c2', 'from phone');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(chatIds(dev)).toEqual(['c1', 'c2']);
      expect(chatTexts(dev, 'c1')).toEqual(['hello from the phone', 'more']);
      expect(chatTexts(dev, 'c2')).toEqual(['desktop chat', 'from phone']);
    }
    // The Desktop's lost reply is kept there as an earlier version.
    const desk = await keptChats('desktop');
    expect(
      desk.some(
        r =>
          r.replaced &&
          r.chat.session.id === 'c2' &&
          keptTexts(r).includes('from desktop'),
      ),
    ).toBe(true);
    // The deleted chat is kept 30 days where it was removed by a sync.
    for (const dev of ['desktop', 'phone'] as Name[]) {
      expect(
        (await keptChats(dev)).some(
          r => !r.replaced && r.chat.session.id === 'c3',
        ),
      ).toBe(true);
    }

    // Four more clashes where the Desktop loses: at most 3 versions there,
    // and the first one (with "from desktop") is never dropped.
    for (let i = 1; i <= 4; i++) {
      tick(HOUR);
      addMessage('desktop', 'c2', `desktop ${i}`);
      tick(MIN);
      addMessage('laptop', 'c2', `laptop ${i}`);
      await settle(next);
    }
    await expectSame();
    const versions = (await keptChats('desktop')).filter(
      r => r.chat.session.id === 'c2',
    );
    expect(versions.length).toBeLessThanOrEqual(MAX_VERSIONS);
    expect(versions.some(r => keptTexts(r).includes('from desktop'))).toBe(
      true,
    );
    expect(versions.some(r => keptTexts(r).includes('desktop 4'))).toBe(true);
    for (const dev of NAMES) {
      expect(chatTexts(dev, 'c2')).toContain('laptop 4');
      expect(chatTexts(dev, 'c2')).not.toContain('desktop 4');
    }

    // Restoring the first version there brings it back on all three.
    tick(HOUR);
    const firstKept = versions.find(r =>
      keptTexts(r).includes('from desktop'),
    )!;
    expect(
      await on('desktop', () =>
        restoreDeleted(`${firstKept.chat.session.id}@${firstKept.removedAt}r`),
      ),
    ).toBe(true);
    await settleAll(next);
    for (const dev of NAMES) {
      expect(chatTexts(dev, 'c2')).toEqual(keptTexts(firstKept));
    }

    // Deleted on the Phone, then a reply on the Laptop (not told yet): back.
    tick(HOUR);
    await deleteChat('phone', 'c1');
    tick(MIN);
    addMessage('laptop', 'c1', 'still here');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(chatIds(dev)).toEqual(['c1', 'c2']);
      expect(chatTexts(dev, 'c1')).toContain('still here');
    }
    // c3 stays deleted, round after round.
    await settleAll(next);
    for (const dev of NAMES) {
      expect(chatIds(dev)).not.toContain('c3');
    }
    expect(
      alerts.filter(
        a => a !== 'Kept in step' && a !== 'Kept in step with your PC',
      ),
    ).toEqual([]);
  });

  it('clocks a few minutes apart (within the 5-minute clamp): the later time wins, all agree', async () => {
    mockDevs.phone.skew = 3 * MIN;
    mockDevs.laptop.skew = -2 * MIN;
    await addPal('desktop', 'd1', 'Coder');
    newChat('desktop', 'c1', ['hi']);
    await settleAll(next);

    tick(HOUR);
    // The Desktop first, the Laptop a minute later but its clock is behind.
    await setPrompt('desktop', 'Desktop prompt');
    tick(MIN);
    await setPrompt('laptop', 'Laptop prompt');
    tick(MIN);
    expect((await settleAll(next)).prompt).toBe('Desktop prompt');
    expect(
      (await on('laptop', () => promptHistory())).map(h => h.text),
    ).toContain('Laptop prompt');

    tick(HOUR);
    // The Phone (3 min ahead) first, the Desktop a minute later: the
    // Phone's time is later, and within the clamp it counts.
    await setPrompt('phone', 'Phone prompt');
    tick(MIN);
    await setPrompt('desktop', 'Desktop again');
    expect((await settleAll(next)).prompt).toBe('Phone prompt');

    // Deleted on the Phone; edited on the Laptop 4 minutes later (its
    // clock 5 behind the Phone's): the deletion is later, so it wins, and
    // the Laptop's edit is kept there.
    tick(HOUR);
    await deletePal('phone', 'Coder');
    tick(4 * MIN);
    await editPal('laptop', 'Coder', 'edited on the laptop');
    addMessage('laptop', 'c1', 'reply on the laptop');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(palNames(dev)).toEqual([]);
      expect(chatTexts(dev, 'c1')).toEqual(['hi', 'reply on the laptop']);
    }
    const kept = await on('laptop', () => recentlyDeletedAssistants());
    expect(kept[0].pal.systemPrompt).toBe('edited on the laptop');
  });

  it('a clock far ahead (beyond the clamp) cannot win for ever; all agree', async () => {
    mockDevs.phone.skew = 2 * HOUR;
    await addPal('desktop', 'd1', 'Coder');
    const walk = await addLoop('desktop', 'Walk');
    newChat('desktop', 'c1', ['hi']);
    newChat('desktop', 'c2', ['hello']);
    await settleAll(next);

    tick(HOUR);
    await setPrompt('phone', 'From the future');
    addMessage('phone', 'c1', 'future reply');
    const one = await settleAll(next);
    expect(one.prompt).toBe('From the future');
    // Its times were taken as at most 5 minutes ahead.
    const desktopTime = JSON.parse(
      mockDevs.desktop.store['@pocketagent/sync/state/v1'],
    ).systemPrompt.updatedAt;
    expect(desktopTime).toBeLessThanOrEqual(mockClock + MAX_CLOCK_SKEW);
    for (const dev of NAMES) {
      expect(chatTexts(dev, 'c1')).toEqual(['hi', 'future reply']);
    }

    // Ten minutes later in real time, an edit on the Laptop wins.
    tick(10 * MIN);
    await setPrompt('laptop', 'Laptop, later');
    addMessage('laptop', 'c1', 'laptop, later');
    const two = await settleAll(next);
    expect(two.prompt).toBe('Laptop, later');
    for (const dev of NAMES) {
      expect(chatTexts(dev, 'c1')).toEqual([
        'hi',
        'future reply',
        'laptop, later',
      ]);
    }
    expect(
      (await on('phone', () => promptHistory())).map(h => h.text),
    ).toContain('From the future');

    // Deletions dated two hours ahead are not taken by the others: the
    // assistant, the loop and the chat come back on the Phone (nothing
    // lost), and all three agree.
    tick(HOUR);
    await deletePal('phone', 'Coder');
    await stopLoop('phone', walk);
    await deleteChat('phone', 'c2');
    await settleAll(next);
    for (const dev of NAMES) {
      expect(palNames(dev)).toEqual(['Coder']);
      expect(await loopTitles(dev)).toEqual(['Walk']);
      expect(chatIds(dev)).toEqual(['c1', 'c2']);
    }
  });

  it('a device offline for days, then back: its changes and the others’ all land, deletions included', async () => {
    await addPal('desktop', 'd1', 'Coder');
    await addPal('desktop', 'd2', 'Writer');
    const walk = await addLoop('desktop', 'Walk');
    newChat('desktop', 'c1', ['first']);
    newChat('desktop', 'c2', ['second']);
    await setPrompt('desktop', 'Prompt 1');
    await settleAll(next);

    // The Phone is away for three days; the two PCs keep syncing.
    const pcs = [2];
    tick(HOUR);
    await deletePal('desktop', 'Coder');
    await deleteChat('desktop', 'c1');
    await stopLoop('desktop', walk);
    tick(MIN);
    await setPrompt('laptop', 'Prompt from the laptop');
    const read = await addLoop('laptop', 'Read');
    await settle(next, pcs);
    tick(DAY);
    // Meanwhile on the Phone (not told of any of it).
    await editPal('phone', 'Writer', 'Writer, edited offline');
    await editLoop('phone', walk, 'Walk more', 'Walk 3 km');
    addMessage('phone', 'c2', 'offline reply');
    newChat('phone', 'c4', ['new while away']);
    await setModelMem('phone', 'Phone notes');
    tick(DAY);
    await settle(next, pcs);
    tick(DAY);

    const all = await settleAll(next);
    expect(all.prompt).toBe('Prompt from the laptop');
    expect(all.modelMem).toBe('Phone notes');
    for (const dev of NAMES) {
      // Coder (unchanged on the Phone) is gone; Writer has the Phone's edit.
      expect(palNames(dev)).toEqual(['Writer']);
      expect(promptOf(dev, 'Writer')).toBe('Writer, edited offline');
      // Walk was edited on the Phone after it was stopped: it is back.
      expect(await loopTitles(dev)).toEqual(['Read', 'Walk more']);
      expect(chatIds(dev)).toEqual(['c2', 'c4']);
      expect(chatTexts(dev, 'c2')).toEqual(['second', 'offline reply']);
    }
    expect((await loopsOf('phone')).some(l => l.id === read)).toBe(true);
    // What the Phone lost to the others' deletions is kept there.
    expect(
      (await on('phone', () => recentlyDeletedAssistants())).map(
        k => k.pal.name,
      ),
    ).toEqual(['Coder']);
    expect((await keptChats('phone')).map(r => r.chat.session.id)).toEqual([
      'c1',
    ]);
  });
});

// ---------------------------------------------------------------- random

describe('random edits on random devices, random syncs (seeded)', () => {
  it.each([3, 17, 99, 2026])(
    'seed %i: settles the same everywhere',
    async seed => {
      const r = rng(seed);
      const pick = <T>(list: T[]): T => list[Math.floor(r() * list.length)];
      // Clocks within ±2 minutes; each step 10 minutes apart, so the order of
      // the edits is the order of their times.
      mockDevs.desktop.skew = 0;
      mockDevs.laptop.skew = 2 * MIN;
      mockDevs.phone.skew = -2 * MIN;
      /** Deleted on some device (never touched again anywhere). */
      const gone = {
        pals: new Set<string>(),
        loops: new Set<string>(),
        chats: new Set<string>(),
      };
      let pals = 0;
      let chats = 0;
      let loopsMade = 0;
      let palDeletes = 0;
      let loopStops = 0;
      for (let step = 0; step < 150; step++) {
        tick(10 * MIN);
        const dev = pick(NAMES);
        const live = mockDevs[dev].pals.filter(p => !gone.pals.has(p.name));
        const myLoops = (await loopsOf(dev)).filter(l => !gone.loops.has(l.id));
        const myChats = chatIds(dev).filter(id => !gone.chats.has(id));
        const what = Math.floor(r() * 12);
        if (what <= 2) {
          await syncPair(Math.floor(r() * 3));
        } else if (what === 3) {
          await setPrompt(dev, `prompt ${step} on ${dev}`);
        } else if (what === 4) {
          await setUserMem(dev, `notes ${step} on ${dev}`);
        } else if (what === 5) {
          if (live.length && r() < 0.6) {
            await editPal(dev, pick(live).name, `edit ${step} on ${dev}`);
          } else {
            pals++;
            await addPal(dev, `p${pals}`, `Pal ${pals}`);
          }
        } else if (what === 6) {
          if (live.length && palDeletes < 5) {
            const p = pick(live);
            gone.pals.add(p.name);
            palDeletes++;
            await deletePal(dev, p.name);
          }
        } else if (what === 7) {
          if (myLoops.length && r() < 0.6) {
            await editLoop(dev, pick(myLoops).id, `Loop ${step}`, `do ${step}`);
          } else if (loopsMade < 6 && myLoops.length < 6) {
            loopsMade++;
            await addLoop(dev, `Loop made ${loopsMade}`);
          }
        } else if (what === 8) {
          if (myLoops.length && loopStops < 5) {
            const l = pick(myLoops);
            gone.loops.add(l.id);
            loopStops++;
            await stopLoop(dev, l.id);
          }
        } else if (what === 9 || what === 10) {
          if (myChats.length && r() < 0.7) {
            addMessage(dev, pick(myChats), `message ${step} on ${dev}`);
          } else {
            chats++;
            newChat(dev, `chat${chats}`, [`chat ${chats} on ${dev}`]);
          }
        } else if (myChats.length) {
          const id = pick(myChats);
          gone.chats.add(id);
          await deleteChat(dev, id);
        }
      }
      await settle(() => [0, 1, 2]);
      await expectSame();
      await expectQuiet(() => [2, 1, 0]);
      // Deleted things stay deleted on every device.
      for (const dev of NAMES) {
        expect(palNames(dev).filter(n => gone.pals.has(n))).toEqual([]);
        expect((await loopsOf(dev)).filter(l => gone.loops.has(l.id))).toEqual(
          [],
        );
        expect(chatIds(dev).filter(id => gone.chats.has(id))).toEqual([]);
      }
      expect(
        alerts.filter(
          a => a !== 'Kept in step' && a !== 'Kept in step with your PC',
        ),
      ).toEqual([]);
    },
  );
});
