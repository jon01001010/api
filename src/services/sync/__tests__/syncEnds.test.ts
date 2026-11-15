/**
 * Both ends of keeping in step: the device sends its items and takes the
 * agreed ones; the PC merges, writes, answers (and says what changed).
 */
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

import {Alert, NativeModules} from 'react-native';

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
jest.mock('../../talents/agentMemory', () => ({
  DEFAULT_MEMORY: 'TEMPLATE\n',
  userMemoryGet: async () => mockText.user,
  memoryGet: async () => mockText.model,
  userMemoryReplace: async (next: string) => {
    mockText.user = next;
  },
  memoryReplace: async (next: string) => {
    mockText.model = next;
  },
}));
jest.mock('@tauri-apps/api/core', () => ({invoke: jest.fn()}));
jest.mock('@tauri-apps/api/event', () => ({listen: jest.fn()}));

import {setSyncWithPc, syncWithPc, syncWithPcOn} from '../deviceSync';
import {
  answerSync,
  keptInStepNotice,
  resetKeptInStepNotice,
} from '../hostSync.web';

beforeEach(() => {
  for (const k of Object.keys(mockStore)) {
    delete mockStore[k];
  }
  Object.assign(mockText, {prompt: '', user: '', model: 'TEMPLATE\n'});
});
afterEach(() => {
  delete (NativeModules as any).HomeLink;
});

it('is off for each PC until switched on', async () => {
  expect(await syncWithPcOn('pc1')).toBe(false);
  await setSyncWithPc('pc1', true);
  expect(await syncWithPcOn('pc1')).toBe(true);
  expect(await syncWithPcOn('pc2')).toBe(false);
});

it('the PC takes a newer prompt from the device, keeps its own newer notes, and says so', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockText.prompt = 'Old PC prompt';
  mockText.user = 'PC notes (newer)';
  const now = Date.now();
  const body = JSON.stringify({
    items: [
      {key: 'systemPrompt', text: 'Phone prompt', updatedAt: now + 60_000},
      {key: 'userMemory', text: 'phone notes (older)', updatedAt: 1},
      {key: 'modelMemory', text: 'TEMPLATE\n', updatedAt: 0},
    ],
  });
  const reply = JSON.parse(await answerSync(body, 'Pixel'));
  expect(reply.ok).toBe(true);
  expect(mockText.prompt).toBe('Phone prompt');
  expect(mockText.user).toBe('PC notes (newer)');
  expect(reply.takenByPc).toEqual(['systemPrompt']);
  expect(reply.items.find((i: any) => i.key === 'userMemory').text).toBe(
    'PC notes (newer)',
  );
  expect(alert).toHaveBeenCalledWith(
    'Kept in step',
    expect.stringContaining('System prompt updated from Pixel'),
    expect.anything(),
    expect.anything(),
  );
  alert.mockRestore();
});

it('the device sends its items and takes the agreed ones back', async () => {
  mockText.user = 'old phone notes';
  let sent: any;
  (NativeModules as any).HomeLink = {
    sync: jest.fn(async (_pc: string, body: string) => {
      sent = JSON.parse(body);
      return JSON.stringify({
        ok: true,
        items: [
          {key: 'systemPrompt', text: 'Be brief.', updatedAt: 50},
          {key: 'userMemory', text: 'PC notes', updatedAt: 60},
          {key: 'modelMemory', text: 'TEMPLATE\n', updatedAt: 0},
        ],
        takenByPc: [],
      });
    }),
  };
  const r = await syncWithPc('pc1');
  expect(sent.items.map((i: any) => i.key)).toEqual([
    'systemPrompt',
    'userMemory',
    'modelMemory',
    'assistants',
    'customTools',
  ]);
  expect(r).toEqual({
    ok: true,
    changedHere: ['systemPrompt', 'userMemory'],
    changedOnPc: [],
    chatsReceived: 0,
    chatsSent: 0,
  });
  expect(mockText.prompt).toBe('Be brief.');
  expect(mockText.user).toBe('PC notes');
});

it("says so when the PC hasn't allowed it", async () => {
  (NativeModules as any).HomeLink = {
    sync: jest.fn(async () =>
      JSON.stringify({ok: false, error: 'Keeping in step is off on the PC'}),
    ),
  };
  expect(await syncWithPc('pc1')).toEqual({
    ok: false,
    error: 'Keeping in step is off on the PC',
  });
  expect(mockText.prompt).toBe('');
});

it('"Kept in step" on the PC: one at a time, later ones shown together after', () => {
  resetKeptInStepNotice();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  for (let i = 1; i <= 50; i++) {
    keptInStepNotice(`change ${i}`);
  }
  expect(alert).toHaveBeenCalledTimes(1);
  const close = (n: number) => (alert.mock.calls[n] as any)[2][0].onPress();
  close(0);
  expect(alert).toHaveBeenCalledTimes(2);
  const text = String(alert.mock.calls[1][1]);
  expect(text).toContain('change 50');
  expect(text).toContain('change 48');
  expect(text).not.toContain('change 47');
  expect(text).toContain('and 46 more');
  close(1);
  expect(alert).toHaveBeenCalledTimes(2);
  // Closing twice (OK, then dismissed) doesn't open more.
  close(1);
  keptInStepNotice('next');
  expect(alert).toHaveBeenCalledTimes(3);
  alert.mockRestore();
  resetKeptInStepNotice();
});
