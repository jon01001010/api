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

import {
  applyItems,
  cleanItems,
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
      {key: 'modelMemory', text: 'x'.repeat(300 * 1024), updatedAt: 1},
      {key: 'other', text: 'x', updatedAt: 1},
    ]),
  ).toEqual([item('systemPrompt', 'ok', 1)]);
  expect(cleanItems('nonsense')).toEqual([]);
});
