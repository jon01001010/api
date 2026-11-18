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

import {
  changedHereText,
  pcWins,
  setSyncWithPc,
  syncWithPc,
  syncWithPcOn,
} from '../deviceSync';
import {resetAsking} from '../promptSync';

/** Presses a button of the last "Take the …?" question. */
async function answerLast(alert: jest.SpyInstance, button: string) {
  const calls = alert.mock.calls.filter(c =>
    String(c[0]).startsWith('Take the '),
  );
  const [, , buttons] = calls[calls.length - 1] as any;
  await buttons.find((b: any) => b.text === button).onPress();
}
import {
  LOCKED_ANSWER,
  answerSync,
  keptInStepNotice,
  resetKeptInStepNotice,
} from '../hostSync.web';

beforeEach(() => {
  resetAsking();
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
  // A new system prompt from a device: asked first (review 2026-11-17),
  // with the app's own size line and the text; the device keeps its own
  // until then.
  expect(mockText.prompt).toBe('Old PC prompt');
  expect(reply.takenByPc).toEqual([]);
  expect(reply.items.find((i: any) => i.key === 'systemPrompt').text).toBe(
    'Phone prompt',
  );
  expect(alert).toHaveBeenCalledWith(
    'Take the system prompt from Pixel?',
    expect.stringContaining(
      'System prompt (the app counted 12 characters, 1 line):\nPhone prompt',
    ),
    expect.anything(),
    expect.anything(),
  );
  await answerLast(alert, 'Take it');
  expect(mockText.prompt).toBe('Phone prompt');
  expect(mockText.user).toBe('PC notes (newer)');
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
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
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
    'loops',
  ]);
  // The prompt and "your memory": asked first, taken on yes.
  expect(r).toEqual({
    ok: true,
    changedHere: [],
    changedOnPc: [],
    chatsReceived: 0,
    chatsSent: 0,
  });
  expect(mockText.prompt).toBe('');
  for (const call of alert.mock.calls.filter(c =>
    String(c[0]).startsWith('Take the '),
  )) {
    await (call as any)[2].find((b: any) => b.text === 'Take it').onPress();
  }
  expect(mockText.prompt).toBe('Be brief.');
  expect(mockText.user).toBe('PC notes');
  // Told, after it was taken.
  expect(alert).toHaveBeenCalledWith(
    'Kept in step with your PC',
    expect.stringContaining('taken from the PC'),
  );
  alert.mockRestore();
});

it('the device never takes an empty item over real text, nor what is the same', () => {
  const local = [
    {key: 'customTools' as const, text: '[{"name":"x"}]', updatedAt: 1},
    {key: 'modelMemory' as const, text: 'real notes', updatedAt: 1},
    {key: 'systemPrompt' as const, text: 'Same', updatedAt: 1},
  ];
  const agreed = [
    {key: 'customTools' as const, text: '[]', updatedAt: 9},
    {key: 'modelMemory' as const, text: 'TEMPLATE\n', updatedAt: 9},
    {key: 'systemPrompt' as const, text: 'Same', updatedAt: 9},
  ];
  expect(pcWins(local, agreed)).toEqual([]);
  expect(
    pcWins(local, [{key: 'modelMemory', text: 'PC notes', updatedAt: 9}]),
  ).toEqual([{key: 'modelMemory', text: 'PC notes', updatedAt: 9}]);
});

it('"Keep mine" keeps it, and the same text is not asked about again', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockText.prompt = 'Mine';
  (NativeModules as any).HomeLink = {
    sync: jest.fn(async () =>
      JSON.stringify({
        ok: true,
        items: [{key: 'systemPrompt', text: 'Injected', updatedAt: 50}],
        takenByPc: [],
      }),
    ),
  };
  await syncWithPc('pc1');
  await answerLast(alert, 'Keep mine');
  expect(mockText.prompt).toBe('Mine');
  const asked = alert.mock.calls.length;
  await syncWithPc('pc1');
  expect(alert.mock.calls.length).toBe(asked);
  expect(mockText.prompt).toBe('Mine');
  alert.mockRestore();
});

it('says what changed after a sync in the background', () => {
  expect(
    changedHereText({
      ok: true,
      changedHere: ['modelMemory'],
      changedOnPc: [],
      chatsDeleted: 2,
    }),
  ).toBe(
    "The model's memory notes taken from the PC; 2 chat(s) deleted on the PC removed here.",
  );
  expect(changedHereText({ok: true, changedHere: [], changedOnPc: []})).toBe(
    '',
  );
});

it('a device that sends the same text "5 minutes from now" every time no longer wins', async () => {
  // The model's notes are asked first too (review 2): the user takes them.
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find(b => b.text === 'Take it')?.onPress?.();
  });
  mockText.user = 'x';
  const t0 = Date.now();
  const send = (now: number) =>
    JSON.stringify({
      items: [
        {key: 'modelMemory', text: 'Evil notes', updatedAt: now + 5 * 60_000},
      ],
    });
  mockText.model = 'PC notes';
  await answerSync(send(t0), 'Pixel');
  await new Promise(r => setTimeout(r, 0));
  // Newer than the PC's notes then: taken (after the user's yes).
  expect(mockText.model).toBe('Evil notes');
  // The user puts their notes back a minute later (within the skew).
  mockText.model = 'PC notes again';
  const now = jest.spyOn(Date, 'now').mockReturnValue(t0 + 60_000);
  const reply = JSON.parse(await answerSync(send(t0 + 60_000), 'Pixel'));
  expect(mockText.model).toBe('PC notes again');
  expect(reply.items.find((i: any) => i.key === 'modelMemory').text).toBe(
    'PC notes again',
  );
  now.mockRestore();
  (Alert.alert as any).mockRestore();
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

describe('security review 2 (2026-11-18), the PC side', () => {
  it('while DesktopAgent is locked a sync is answered "try later", nothing changes', async () => {
    const lock = require('../../appLock/appLock');
    const spy = jest.spyOn(lock, 'appUnlockedNow').mockReturnValue(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockText.prompt = 'PC prompt';
    const reply = JSON.parse(
      await answerSync(
        JSON.stringify({
          items: [
            {key: 'systemPrompt', text: 'Device prompt', updatedAt: Date.now()},
          ],
        }),
        'Pixel',
      ),
    );
    expect(reply).toEqual({ok: false, error: LOCKED_ANSWER});
    expect(mockText.prompt).toBe('PC prompt');
    expect(alert).not.toHaveBeenCalled();
    spy.mockRestore();
    alert.mockRestore();
  });

  it("a device is known by its key: another with the same name doesn't share its answers", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockText.prompt = 'PC prompt';
    const body = (text: string) =>
      JSON.stringify({
        items: [{key: 'systemPrompt', text, updatedAt: Date.now() + 1000}],
      });
    await answerSync(body('From A'), 'Pixel', 'KEYAAAAAAAAA');
    const keepA = alert.mock.calls
      .at(-1)?.[2]
      ?.find((b: any) => b.text === 'Keep mine');
    await keepA!.onPress!();
    const asked = alert.mock.calls.length;
    // The same name, another key: asked about its own text.
    await answerSync(body('From B'), 'Pixel', 'KEYBBBBBBBBB');
    expect(alert.mock.calls.length).toBe(asked + 1);
    // The first device again, a changed text: held ("Keep mine", a day).
    await answerSync(body('From A, changed'), 'Pixel', 'KEYAAAAAAAAA');
    expect(alert.mock.calls.length).toBe(asked + 1);
    expect(mockText.prompt).toBe('PC prompt');
    alert.mockRestore();
  });
});
