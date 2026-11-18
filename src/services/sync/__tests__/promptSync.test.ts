/**
 * Keeping the system prompt and memory in step: newer edit wins, empty never
 * wins over real text, the replaced text is kept in history.
 */
const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore[k] = v;
  }),
  removeItem: jest.fn(async (k: string) => {
    delete mockStore[k];
  }),
}));
const mockText = {prompt: '', user: '', model: ''};
jest.mock('../../../utils/globalToolSettings', () => ({
  readGlobalPrompt: async () => mockText.prompt,
  writeGlobalPrompt: async (t: string) => {
    mockText.prompt = t;
  },
}));
const mockReplaced: string[] = [];
jest.mock('../../talents/agentMemory', () => ({
  DEFAULT_MEMORY: '01 =MEM/1 | 02:@U=user | 03:@P=project | 04:@G=goal\n',
  userMemoryGet: async () => mockText.user,
  memoryGet: async () => mockText.model,
  userMemoryReplace: async (next: string, prev: string) => {
    mockReplaced.push(prev); // the real one keeps prev as a snapshot
    mockText.user = next;
  },
  memoryReplace: async (next: string, prev: string) => {
    mockReplaced.push(prev);
    mockText.model = next;
  },
}));

const mockSources = {assistants: '[]', customTools: '[]'};
jest.mock('../syncSources', () => ({
  readAssistants: async () => mockSources.assistants,
  readCustomTools: async () => mockSources.customTools,
  writeAssistants: async (t: string) => {
    mockSources.assistants = t;
  },
  writeCustomTools: async (t: string) => {
    mockSources.customTools = t;
  },
}));

import {Alert} from 'react-native';

import {
  ASK_FIRST,
  ASK_GAP_MS,
  KEEP_MINE_MS,
  applyItems,
  claimedTime,
  holdForAnswer,
  loadPeer,
  movePeerOnce,
  resetAsking,
  cleanItems,
  fingerprint,
  MAX_CLOCK_SKEW,
  MAX_HISTORY_CHARS,
  MAX_PROMPT,
  merge,
  trimHistory,
  promptHistory,
  readItems,
  type SyncItem,
} from '../promptSync';

const TEMPLATE = '01 =MEM/1 | 02:@U=user | 03:@P=project | 04:@G=goal\n';
const item = (key: SyncItem['key'], text: string, updatedAt: number) => ({
  key,
  text,
  updatedAt,
});

beforeEach(() => {
  for (const k of Object.keys(mockStore)) {
    delete mockStore[k];
  }
  Object.assign(mockText, {prompt: '', user: '', model: TEMPLATE});
  mockReplaced.length = 0;
});

it('the newer edit wins, item by item', () => {
  const phone = [
    item('systemPrompt', 'Be brief.', 200),
    item('userMemory', 'I like tea', 100),
  ];
  const pc = [
    item('systemPrompt', 'Be detailed.', 100),
    item('userMemory', 'I like coffee', 300),
  ];
  const m = merge(pc, phone);
  expect(m.items).toEqual([
    item('systemPrompt', 'Be brief.', 200),
    item('userMemory', 'I like coffee', 300),
  ]);
  expect(m.takenHere).toEqual(['systemPrompt']);
  expect(m.takenThere).toEqual(['userMemory']);
});

it('empty (or the memory template) never wins over real text, whatever the time', () => {
  const fresh = [item('modelMemory', TEMPLATE, 0), item('systemPrompt', '', 0)];
  const used = [
    item('modelMemory', 'project: PocketAgent', 5),
    item('systemPrompt', 'Be kind.', 5),
  ];
  const m = merge(fresh, used);
  expect(m.items.map(i => i.text)).toEqual([
    'Be kind.',
    'project: PocketAgent',
  ]);
  expect(m.takenHere).toEqual(['systemPrompt', 'modelMemory']);
});

it('same text is no change; a tie picks the same winner on both sides', () => {
  expect(
    merge([item('userMemory', 'a', 1)], [item('userMemory', 'a', 9)]).takenHere,
  ).toEqual([]);
  const a = [item('userMemory', 'apple', 5)];
  const b = [item('userMemory', 'banana', 5)];
  expect(merge(a, b).items[0].text).toBe(merge(b, a).items[0].text);
});

it('an edit counts from when this device first saw it; seen text keeps its time', async () => {
  mockText.prompt = 'Be brief.';
  const first = await readItems(1000);
  expect(first.find(i => i.key === 'systemPrompt')!.updatedAt).toBe(1000);
  expect(first.find(i => i.key === 'modelMemory')!.updatedAt).toBe(0); // template
  const again = await readItems(5000);
  expect(again.find(i => i.key === 'systemPrompt')!.updatedAt).toBe(1000);
  mockText.prompt = 'Be very brief.';
  const edited = await readItems(9000);
  expect(edited.find(i => i.key === 'systemPrompt')!.updatedAt).toBe(9000);
});

it('applying keeps what it replaces in history and is not then seen as a local edit', async () => {
  mockText.prompt = 'Old prompt';
  mockText.user = 'old notes';
  await readItems(1);
  const changed = await applyItems([
    item('systemPrompt', 'New prompt', 50),
    item('userMemory', 'new notes', 50),
    item('modelMemory', TEMPLATE, 0),
  ]);
  expect(changed).toEqual(['systemPrompt', 'userMemory']);
  expect(mockText.prompt).toBe('New prompt');
  expect((await promptHistory())[0].text).toBe('Old prompt');
  expect(mockReplaced).toEqual(['old notes']);
  const after = await readItems(999);
  expect(after.find(i => i.key === 'systemPrompt')!.updatedAt).toBe(50);
});

it('drops malformed or oversized items from the other device', () => {
  expect(
    cleanItems([
      {key: 'systemPrompt', text: 'ok', updatedAt: 1},
      {key: 'userMemory', text: 5, updatedAt: 1},
      {key: 'modelMemory', text: 'x'.repeat(2 * 1024 * 1024), updatedAt: 1},
      {key: 'other', text: 'x', updatedAt: 1},
    ]),
  ).toEqual([item('systemPrompt', 'ok', 1)]);
  expect(cleanItems('nonsense')).toEqual([]);
});

describe('a time far in the future (a clock ahead, or forged)', () => {
  it('is taken as a few minutes ahead at most', () => {
    expect(
      cleanItems([{key: 'systemPrompt', text: 'x', updatedAt: 9e15}], 1000),
    ).toEqual([item('systemPrompt', 'x', 1000 + MAX_CLOCK_SKEW)]);
    expect(
      cleanItems([{key: 'systemPrompt', text: 'x', updatedAt: 1e300}], 1000)[0]
        .updatedAt,
    ).toBe(1000 + MAX_CLOCK_SKEW);
  });

  it('no longer locks an injected edit in: the next real edit wins', async () => {
    mockText.prompt = 'Mine';
    await readItems(1000);
    // A paired device sends an injected prompt "from the far future".
    const now = 2000;
    const local = await readItems(now);
    const merged = merge(
      local,
      cleanItems([item('systemPrompt', 'Evil', 9e15)], now),
    );
    expect(merged.takenHere).toEqual(['systemPrompt']);
    await applyItems(merged.items, now);
    expect(mockText.prompt).toBe('Evil');
    // What this device now passes on carries its own time, not the future.
    const after = await readItems(3000);
    expect(after.find(i => i.key === 'systemPrompt')!.updatedAt).toBe(now);
    // The user fixes it later: a device that still has "Evil" (with the
    // time it got it) no longer wins.
    mockText.prompt = 'Mine again';
    const fixed = await readItems(10 * 60_000);
    const replay = cleanItems([item('systemPrompt', 'Evil', now)], 10 * 60_000);
    expect(merge(fixed, replay).takenHere).toEqual([]);
  });

  it('a future time stored before the clamp is brought back to now', async () => {
    mockText.prompt = 'Seen';
    await readItems(1000);
    const key = Object.keys(mockStore).find(k => k.includes('sync/state'))!;
    const state = JSON.parse(mockStore[key]);
    state.systemPrompt.updatedAt = 9e15;
    mockStore[key] = JSON.stringify(state);
    const items = await readItems(5000);
    expect(items.find(i => i.key === 'systemPrompt')!.updatedAt).toBe(5000);
  });
});

describe('security review 2026-11-17', () => {
  it('a system prompt over MAX_PROMPT is not taken from another device', () => {
    expect(
      cleanItems([
        {key: 'systemPrompt', text: 'x'.repeat(MAX_PROMPT + 1), updatedAt: 1},
      ]),
    ).toEqual([]);
    expect(
      cleanItems([
        {key: 'systemPrompt', text: 'x'.repeat(MAX_PROMPT), updatedAt: 1},
      ]),
    ).toHaveLength(1);
    // Notes may be longer.
    expect(
      cleanItems([
        {key: 'userMemory', text: 'x'.repeat(MAX_PROMPT + 1), updatedAt: 1},
      ]),
    ).toHaveLength(1);
  });

  it('the same text sent again counts from when it was first seen', () => {
    const peer = {systemPrompt: {seenPrint: fingerprint('Evil'), seenAt: 1000}};
    // Sent again "5 minutes from now": it counts from 1000.
    const again = item('systemPrompt', 'Evil', 5000 + MAX_CLOCK_SKEW);
    expect(claimedTime(again, peer.systemPrompt).updatedAt).toBe(1000);
    // A local edit after that wins; without the memory, it would not.
    const local = [item('systemPrompt', 'Mine', 3000)];
    expect(merge(local, [again], peer).takenHere).toEqual([]);
    expect(merge(local, [again]).takenHere).toEqual(['systemPrompt']);
    // A new text is a new edit: its own time.
    const edited = item('systemPrompt', 'Evil 2', 4000);
    expect(merge(local, [edited], peer).takenHere).toEqual(['systemPrompt']);
  });
});

it('sync history keeps at most 10 versions within its size budget', () => {
  const big = (n: number) => ({at: n, text: 'x'.repeat(MAX_HISTORY_CHARS / 2)});
  expect(trimHistory([big(1), big(2), big(3)]).map(e => e.at)).toEqual([1, 2]);
  // The newest is always kept, however big.
  const huge = {at: 9, text: 'y'.repeat(MAX_HISTORY_CHARS + 1)};
  expect(trimHistory([huge, big(1)]).map(e => e.at)).toEqual([9]);
  const small = Array.from({length: 15}, (_, i) => ({at: i, text: 's'}));
  expect(trimHistory(small)).toHaveLength(10);
});

it('the global prompt cap is the same as the sync cap', () => {
  const {readFileSync} = require('fs');
  const src = readFileSync(
    require('path').join(__dirname, '../../../utils/globalToolSettings.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  expect(src).toContain('export const MAX_GLOBAL_PROMPT = 32 * 1024;');
  expect(MAX_PROMPT).toBe(32 * 1024);
  expect(src).toMatch(
    /if \(prompt\.length > MAX_GLOBAL_PROMPT\) \{\s*throw new Error/,
  );
});

describe('security review 2 (2026-11-18): asked first, and not worn down', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => {
    resetAsking();
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => alert.mockRestore());
  const press = async (button: string) => {
    const buttons = alert.mock.calls.at(-1)[2];
    await buttons.find((b: any) => b.text === button).onPress();
  };

  it("everything that reaches the model's prompt or tools is asked first", () => {
    expect(ASK_FIRST).toEqual([
      'systemPrompt',
      'userMemory',
      'modelMemory',
      'assistants',
      'customTools',
    ]);
  });

  it('"Keep mine" holds that item from that device for a day, whatever it sends', async () => {
    let t = 1_000_000;
    const clock = () => t;
    const take = jest.fn(async () => {});
    const hold = (text: string) =>
      holdForAnswer(
        [item('modelMemory', text, t)],
        'Pixel',
        take,
        'key:abc',
        clock,
      );
    expect(await hold('notes v1')).toEqual([]);
    expect(alert).toHaveBeenCalledTimes(1);
    await press('Keep mine');
    // One character changed each sync: never asked, never taken.
    for (const text of ['notes v2', 'notes v3', 'notes v4']) {
      t += 60 * 60_000;
      expect(await hold(text)).toEqual([]);
    }
    expect(alert).toHaveBeenCalledTimes(1);
    expect(take).not.toHaveBeenCalled();
    // A day later it may ask again (the declined text itself never).
    t = 1_000_000 + KEEP_MINE_MS + 1;
    await hold('notes v1');
    expect(alert).toHaveBeenCalledTimes(1);
    await hold('notes v5');
    expect(alert).toHaveBeenCalledTimes(2);
    await press('Take it');
    expect(take).toHaveBeenCalledTimes(1);
  });

  it('at most one question per device and item in a while; another device is its own', async () => {
    let t = 5_000_000;
    const clock = () => t;
    const take = jest.fn(async () => {});
    const hold = (text: string, peer = 'key:abc') =>
      holdForAnswer([item('assistants', text, t)], 'Pixel', take, peer, clock);
    await hold('[1]');
    // Closed without an answer.
    alert.mock.calls.at(-1)[3].onDismiss();
    t += 60_000;
    await hold('[2]');
    expect(alert).toHaveBeenCalledTimes(1);
    // A clock set back doesn't make room.
    t -= 10 * 60_000;
    await hold('[3]');
    expect(alert).toHaveBeenCalledTimes(1);
    await hold('[3]', 'key:other');
    expect(alert).toHaveBeenCalledTimes(2);
    t = 5_000_000 + ASK_GAP_MS + 1;
    await hold('[4]');
    expect(alert).toHaveBeenCalledTimes(3);
    expect(take).not.toHaveBeenCalled();
  });

  it("a device's old name-kept record moves to its key once", async () => {
    mockStore[
      `@pocketagent/sync/peer/${encodeURIComponent('device:Pixel')}/v1`
    ] = JSON.stringify({systemPrompt: {seenPrint: 'p', seenAt: 1}});
    await movePeerOnce('device:Pixel', 'key:abc');
    expect((await loadPeer('key:abc')).systemPrompt?.seenPrint).toBe('p');
    expect(await loadPeer('device:Pixel')).toEqual({});
    // Not again: a second device named "Pixel" starts as new.
    await movePeerOnce('device:Pixel', 'key:def');
    expect(await loadPeer('key:def')).toEqual({});
  });
});
