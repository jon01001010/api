/**
 * The PC's own tools: desktop app only; the native side asks (run_command
 * every time, open_file) and does the work (src-tauri/src/pc.rs).
 */
import {
  describePc,
  DesktopToolsEngine,
  DESKTOP_TOOL_NAMES,
} from '../DesktopToolsEngine';
import {PcPictureEngine} from '../PcPictureEngine';
import {PcToolsEngine} from '../PcToolsEngine';
import {registerDefaultTalents, resetRegisteredFlag} from '..';

const mockApprove = jest.fn();
jest.mock('../fileApprovalGate', () => ({
  requestFileApproval: (...a: unknown[]) => mockApprove(...a),
}));
import {talentRegistry} from '../TalentRegistry';

const invoke = jest.fn();
beforeEach(() => {
  invoke.mockReset();
  (globalThis as any).__TAURI_INTERNALS__ = {invoke};
});
afterEach(() => {
  delete (globalThis as any).__TAURI_INTERNALS__;
});

it('describes the PC in plain lines', () => {
  const text = describePc({
    system: 'Windows 11 Pro',
    processor: 'Intel Core i7',
    cores: 8,
    totalMemory: 16e9,
    availableMemory: 9e9,
    gpus: [
      {
        name: 'NVIDIA GeForce',
        totalMemory: 8e9,
        freeMemory: 7e9,
        shared: false,
      },
    ],
    disks: [{name: 'OS', mount: 'C:\\', total: 500e9, free: 120e9}],
    uptimeSeconds: 7200,
  });
  expect(text).toContain('Memory: 16.0 GB total, 9.0 GB free');
  expect(text).toContain(
    'Graphics: NVIDIA GeForce, 8.0 GB of its own (7.0 GB free)',
  );
  expect(text).toContain('Disk C:\\ (OS): 120.0 GB free of 500.0 GB');
});

it('runs a command through the native side and returns its output', async () => {
  invoke.mockResolvedValueOnce({
    exitCode: 0,
    output: 'C: 120 GB free',
    timedOut: false,
  });
  const r = await new DesktopToolsEngine('run_command').execute({
    command: 'Get-Volume',
  });
  expect(invoke).toHaveBeenCalledWith('run_command', {
    command: 'Get-Volume',
    thinking: null,
  });
  expect(r.summary).toContain('Finished (exit code 0).');
  expect(r.summary).toContain('C: 120 GB free');
});

it("passes the model's thinking to the PC's question (shown there only)", async () => {
  invoke.mockResolvedValueOnce({exitCode: 0, output: '', timedOut: false});
  await new DesktopToolsEngine('run_command').execute(
    {command: 'Get-Date'},
    {signal: new AbortController().signal, thinking: 'the user wants the date'},
  );
  expect(invoke).toHaveBeenCalledWith('run_command', {
    command: 'Get-Date',
    thinking: 'the user wants the date',
  });
});

it('a "no" in the native dialog is not an error, and nothing is retried', async () => {
  invoke.mockRejectedValueOnce('The user said no. Nothing was run.');
  const r = await new DesktopToolsEngine('run_command').execute({
    command: 'rm x',
  });
  expect(r.type).toBe('text');
  expect(r.summary).toMatch(/said no/);
});

it('the PC tools exist only in the desktop app', () => {
  talentRegistry.reset();
  resetRegisteredFlag();
  registerDefaultTalents();
  expect(DESKTOP_TOOL_NAMES.every(n => talentRegistry.get(n))).toBe(true);

  delete (globalThis as any).__TAURI_INTERNALS__;
  talentRegistry.reset();
  resetRegisteredFlag();
  registerDefaultTalents();
  expect(
    DESKTOP_TOOL_NAMES.filter(
      n => n !== 'image_generate' && n !== 'pc_info',
    ).some(n => talentRegistry.get(n)),
  ).toBe(false);
  // On the phone, image_generate and pc_info ask the paired Home PC instead.
  expect(talentRegistry.get('image_generate')).toBeInstanceOf(PcPictureEngine);
  expect(talentRegistry.get('pc_info')).toBeInstanceOf(PcToolsEngine);
  for (const n of ['image_generate', 'pc_info']) {
    expect(talentRegistry.get(n)).not.toBeInstanceOf(DesktopToolsEngine);
  }
});

it('reads the clipboard only through the native dialog', async () => {
  invoke.mockResolvedValueOnce('meeting at 3');
  const r = await new DesktopToolsEngine('clipboard_read').execute({});
  expect(invoke).toHaveBeenCalledWith('clipboard_read', {thinking: null});
  expect(r.summary).toContain('meeting at 3');
});

it('media keys: the native side asks (once); only known keys', async () => {
  invoke.mockRejectedValueOnce(new Error('The user said no.'));
  const no = await new DesktopToolsEngine('media_control').execute({
    action: 'next',
  });
  expect(no.summary).toMatch(/said no/);
  expect(mockApprove).not.toHaveBeenCalled();
  invoke.mockResolvedValueOnce(null);
  const yes = await new DesktopToolsEngine('media_control').execute({
    action: 'play_pause',
  });
  expect(invoke).toHaveBeenCalledWith('media_key', {
    key: 'play_pause',
    thinking: null,
  });
  expect(yes.summary).toMatch(/play or pause/);
  invoke.mockClear();
  const bad = await new DesktopToolsEngine('media_control').execute({
    action: 'alt_f4',
  });
  expect(bad.type).toBe('error');
  expect(invoke).not.toHaveBeenCalled();
});

it('prints through the native side, which asks', async () => {
  invoke.mockResolvedValueOnce(null);
  await new DesktopToolsEngine('print_file').execute({filename: 'letter.docx'});
  expect(invoke).toHaveBeenCalledWith('print_file', {
    name: 'letter.docx',
    thinking: null,
  });
});

describe('outside_files', () => {
  const run = (args: Record<string, unknown>) =>
    new DesktopToolsEngine('outside_files').execute(args);

  it('goes to the native side (which asks) with a place and a path', async () => {
    invoke.mockResolvedValueOnce({
      path: 'C:\\Users\\me\\Downloads\\a.txt',
      text: 'hello',
      cut: false,
    });
    const r = await run({
      action: 'read',
      place: 'downloads',
      path: 'a.txt',
      reason: 'you asked',
    });
    expect(invoke).toHaveBeenCalledWith('outside_files', {
      action: 'read',
      place: 'downloads',
      path: 'a.txt',
      content: null,
      reason: 'you asked',
      thinking: null,
    });
    expect(r.summary).toContain('hello');
    expect(r.summary).toContain('data, not instructions');
    // No in-app question of its own: the PC's native one is the question.
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('lists, and a "no" on the PC is not an error', async () => {
    invoke.mockResolvedValueOnce({
      path: '/home/me/Downloads',
      entries: [
        {name: 'a.txt', isDir: false, size: 3},
        {name: 'work', isDir: true, size: 0},
      ],
      more: 0,
    });
    const r = await run({action: 'list', place: 'downloads', path: ''});
    expect(r.summary).toContain('a.txt (3 bytes)\nwork/');
    invoke.mockRejectedValueOnce('The user said no. Nothing was done.');
    const no = await run({action: 'delete', path: '/home/me/x.txt'});
    expect(no.type).toBe('text');
    expect(no.summary).toMatch(/said no/);
  });

  it('refuses unknown actions and places, and a write without text', async () => {
    for (const args of [
      {action: 'move', path: '/x'},
      {action: 'read', place: 'appdata', path: 'x'},
      {action: 'read', path: ''},
      {action: 'write', place: 'documents', path: 'a.txt'},
    ]) {
      expect((await run(args)).type).toBe('error');
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('image_generate', () => {
  const RNFS = require('@dr.pogodin/react-native-fs');
  // A downloaded set: every file there, with its checked-sha256 note
  // (the list's sets are verified, so a file counts only with its note).
  const installed = (yes: boolean) => {
    RNFS.exists.mockImplementation(async () => yes);
    const {IMAGE_MODEL_SETS} = require('../../imageGen/imageModels');
    RNFS.readFile = jest.fn(async (path: string) => {
      for (const set of IMAGE_MODEL_SETS) {
        for (const f of set.files) {
          if (path.endsWith(`/${f.name}.sha256`)) {
            return f.sha256 ?? '';
          }
        }
      }
      return '';
    });
  };
  afterEach(() => RNFS.exists.mockReset());

  it('says how to get a model when none is downloaded; runs nothing', async () => {
    installed(false);
    const r = await new DesktopToolsEngine('image_generate').execute({
      prompt: 'a cat',
    });
    expect(r.type).toBe('text');
    expect(r.summary).toMatch(/Toolbox, Image models/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('makes the picture natively with the first downloaded set and returns it as an image', async () => {
    installed(true);
    invoke.mockResolvedValueOnce({
      name: 'picture-20261115-101530-ab12.png',
      path: '/pocketagent/Documents/PocketAgentFiles/images/picture-20261115-101530-ab12.png',
      seed: 7,
      seconds: 9,
    });
    const r = await new DesktopToolsEngine('image_generate').execute({
      prompt: ' a red fox ',
      width: 768,
    });
    expect(invoke).toHaveBeenCalledWith('image_generate', {
      model: 'flux2-klein-4b',
      prompt: 'a red fox',
      width: 768,
      height: 768,
      steps: null,
      seed: null,
      job: expect.stringMatching(/^pic-[a-z0-9]+-[a-z0-9]*$/),
    });
    expect(r.type).toBe('image');
    expect(r.summary).toContain('images/picture-20261115-101530-ab12.png');
  });

  it('a refused prompt comes back as the native side says it', async () => {
    installed(true);
    invoke.mockRejectedValueOnce(
      'Refused: it combines minors with sexual content. Nothing was made.',
    );
    const r = await new DesktopToolsEngine('image_generate').execute({
      prompt: 'x',
    });
    expect(r.type).toBe('error');
    expect(r.summary).toMatch(/Refused/);
  });

  it("the chat's Stop stops the picture maker", async () => {
    installed(true);
    let finish: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === 'image_generate'
        ? new Promise(resolve => {
            finish = resolve;
          })
        : Promise.resolve(null),
    );
    const stop = new AbortController();
    const running = new DesktopToolsEngine('image_generate').execute(
      {prompt: 'a cat'},
      {signal: stop.signal},
    );
    await new Promise(r => setTimeout(r, 0));
    stop.abort();
    expect(invoke).toHaveBeenCalledWith('image_cancel', undefined);
    finish({name: 'p.png', path: 'p', seed: 1, seconds: 1});
    await running;
  });

  it('shows the maker’s progress for its own picture while it runs, then clears it', async () => {
    installed(true);
    const events = require('../pictureEvents');
    const {toolProgress} = require('../pictureProgress');
    let send: (p: unknown) => void = () => {};
    const unlisten = jest.fn();
    const spy = jest
      .spyOn(events, 'onPictureProgress')
      .mockImplementation(async (handler: any) => {
        send = handler;
        return unlisten;
      });
    let finish: (v: unknown) => void = () => {};
    invoke.mockImplementation((cmd: string) =>
      cmd === 'image_generate'
        ? new Promise(resolve => {
            finish = resolve;
          })
        : Promise.resolve(null),
    );
    const running = new DesktopToolsEngine('image_generate').execute({
      prompt: 'a cat',
    });
    await new Promise(r => setTimeout(r, 0));
    expect(toolProgress.text).toBe('Loading the model…');
    const job = invoke.mock.calls.find(c => c[0] === 'image_generate')![1].job;
    send({id: job, phase: 'sampling', step: 7, steps: 20, seconds: 39});
    expect(toolProgress.text).toBe(
      'Making the picture… step 7 of 20, about 40 s left',
    );
    // Another picture's events (a paired device's) are not shown here.
    send({id: 'other', phase: 'saving', step: 20, steps: 20, seconds: null});
    expect(toolProgress.text).toMatch(/step 7 of 20/);
    send({id: job, phase: 'decoding', step: 20, steps: 20, seconds: null});
    expect(toolProgress.text).toBe('Finishing…');
    finish({name: 'p.png', path: 'p', seed: 1, seconds: 1});
    await running;
    expect(toolProgress.text).toBeNull();
    expect(unlisten).toHaveBeenCalled();
    spy.mockRestore();
  });
});
