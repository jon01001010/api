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
  expect(invoke).toHaveBeenCalledWith('run_command', {command: 'Get-Volume'});
  expect(r.summary).toContain('Finished (exit code 0).');
  expect(r.summary).toContain('C: 120 GB free');
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
    DESKTOP_TOOL_NAMES.filter(n => n !== 'image_generate').some(n =>
      talentRegistry.get(n),
    ),
  ).toBe(false);
  // On the phone, image_generate asks the paired Home PC instead.
  expect(talentRegistry.get('image_generate')).toBeInstanceOf(PcPictureEngine);
  expect(talentRegistry.get('image_generate')).not.toBeInstanceOf(
    DesktopToolsEngine,
  );
});

it('reads the clipboard only through the native dialog', async () => {
  invoke.mockResolvedValueOnce('meeting at 3');
  const r = await new DesktopToolsEngine('clipboard_read').execute({});
  expect(invoke).toHaveBeenCalledWith('clipboard_read', undefined);
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
  expect(invoke).toHaveBeenCalledWith('media_key', {key: 'play_pause'});
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
  expect(invoke).toHaveBeenCalledWith('print_file', {name: 'letter.docx'});
});

describe('image_generate', () => {
  const RNFS = require('@dr.pogodin/react-native-fs');
  const installed = (yes: boolean) =>
    RNFS.exists.mockImplementation(async () => yes);
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
});
