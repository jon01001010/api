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

import {
  applyItems,
  claimedTime,
  cleanItems,
  fingerprint,
  MAX_CLOCK_SKEW,
  MAX_PROMPT,
  merge,
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
