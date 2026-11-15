import {NativeModules} from 'react-native';

import {
  askPcForPicture,
  askPcTool,
  describeEvent,
  isPairingCode,
  openTunnel,
  pairWithPc,
  pcStatus,
  tunnelUrl,
} from '../homeLink';

const PC = 'a'.repeat(64);
const CODE = 'b'.repeat(32);

describe('home link (phone side)', () => {
  afterEach(() => {
    delete (NativeModules as any).HomeLink;
  });

  it('reads only desktop pairing codes', () => {
    expect(isPairingCode(`PA1:P:${PC}:${CODE}`)).toBe(true);
    expect(isPairingCode(`  PA1:P:${PC}:${CODE}\n`)).toBe(true);
    expect(isPairingCode(`PA1:T:${PC}:${CODE}`)).toBe(false);
    expect(isPairingCode('http://192.168.1.5:8080')).toBe(false);
    expect(isPairingCode(`PA1:P:${PC}:short`)).toBe(false);
    expect(isPairingCode(`PA1:P:${PC.toUpperCase()}:${CODE}`)).toBe(false);
  });

  it('answers "not in this build" without the native module', async () => {
    await expect(pairWithPc('x')).resolves.toEqual({
      ok: false,
      error: 'The home link is not in this build',
    });
  });

  it('passes the native answers through and never throws', async () => {
    (NativeModules as any).HomeLink = {
      pair: jest.fn(async () => JSON.stringify({ok: true, pc: PC})),
      status: jest.fn(async () =>
        JSON.stringify({ok: false, error: 'not paired'}),
      ),
      openTunnel: jest.fn(async () => 'not json'),
    };
    await expect(pairWithPc(` PA1:P:${PC}:${CODE} `)).resolves.toEqual({
      ok: true,
      pc: PC,
    });
    expect((NativeModules as any).HomeLink.pair).toHaveBeenCalledWith(
      `PA1:P:${PC}:${CODE}`,
    );
    await expect(pcStatus(PC)).resolves.toEqual({
      ok: false,
      error: 'not paired',
    });
    const broken = await openTunnel(PC);
    expect(broken.ok).toBe(false);
  });

  it('asks the PC for a picture: prompt, sizes and steps only (0 = its default)', async () => {
    const picture = jest.fn(async (..._args: unknown[]) =>
      JSON.stringify({ok: true, file: '/cache/pc-pictures/picture-1.png'}),
    );
    (NativeModules as any).HomeLink = {picture};
    await expect(askPcForPicture(PC, 'a cat', 512)).resolves.toEqual({
      ok: true,
      file: '/cache/pc-pictures/picture-1.png',
    });
    expect(picture).toHaveBeenCalledWith(PC, 'a cat', 512, 0, 0);
  });

  it('asks the PC for one of its tools: the name, a chat id and a file name only', async () => {
    const tool = jest.fn(async (..._args: unknown[]) =>
      JSON.stringify({ok: true, result: {files: []}}),
    );
    (NativeModules as any).HomeLink = {tool};
    await expect(
      askPcTool(PC, 'workspace_list', 'chat-0123456789abcdef'),
    ).resolves.toEqual({ok: true, result: {files: []}});
    expect(tool).toHaveBeenCalledWith(
      PC,
      'workspace_list',
      'chat-0123456789abcdef',
      '{}',
    );
    await askPcTool(PC, 'workspace_read', 'c', {file: 'a.md'});
    expect(tool).toHaveBeenLastCalledWith(
      PC,
      'workspace_read',
      'c',
      '{"file":"a.md"}',
    );
    await askPcTool(PC, 'pc_media', 'c', {key: 'mute'});
    expect(tool).toHaveBeenLastCalledWith(
      PC,
      'pc_media',
      'c',
      '{"key":"mute"}',
    );
    expect(
      describeEvent({n: 2, at: 0, kind: 'may-read', name: 'Pixel'}),
    ).toContain("“Pixel” may now use the PC's tools");
    expect(
      describeEvent({n: 3, at: 0, kind: 'may-act', name: 'Pixel'}),
    ).toContain('“Pixel” may now ask the PC to open or print a file');
    expect(
      describeEvent({n: 4, at: 0, kind: 'may-command', name: 'Pixel'}),
    ).toContain('“Pixel” may now ask the PC to run commands');
    expect(
      describeEvent({n: 5, at: 0, kind: 'removed-by-notice', name: 'Pixel'}),
    ).toContain('“Pixel” was removed on another of your devices');
    await askPcTool(PC, 'pc_run_command', 'c', {command: 'Get-Date'});
    expect(tool).toHaveBeenLastCalledWith(
      PC,
      'pc_run_command',
      'c',
      '{"command":"Get-Date"}',
    );
  });

  it('names a device allowed to make pictures in the pairing history', () => {
    expect(
      describeEvent({n: 1, at: 0, kind: 'may-picture', name: 'Pixel'}),
    ).toContain('“Pixel” may now make pictures on the PC');
  });

  it('the tunnel is this phone only', () => {
    expect(tunnelUrl(4321)).toBe('http://127.0.0.1:4321');
  });
});
