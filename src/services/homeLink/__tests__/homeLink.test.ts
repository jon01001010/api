import {NativeModules} from 'react-native';

import {
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

  it('the tunnel is this phone only', () => {
    expect(tunnelUrl(4321)).toBe('http://127.0.0.1:4321');
  });
});
