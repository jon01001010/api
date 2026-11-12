/**
 * The PC's own tools: desktop app only; the native side asks (run_command
 * every time, open_file) and does the work (src-tauri/src/pc.rs).
 */
import {
  describePc,
  DesktopToolsEngine,
  DESKTOP_TOOL_NAMES,
} from '../DesktopToolsEngine';
import {registerDefaultTalents, resetRegisteredFlag} from '..';
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
  expect(DESKTOP_TOOL_NAMES.some(n => talentRegistry.get(n))).toBe(false);
});
