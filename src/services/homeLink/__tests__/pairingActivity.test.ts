import {Alert, NativeModules} from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const store = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    clear: jest.fn(async () => values.clear()),
  };
  return {__esModule: true, default: store, ...store};
});

import {serverStore} from '../../../store/ServerStore';
import {
  describeEvent,
  newPairingEvents,
  noticePairingActivity,
} from '../homeLink';

let pcCount = 0;
/** A different PC in each test, so nothing carries over. */
const nextPc = () => String(++pcCount).padStart(64, 'd');
const code = (n: number) => ({n, at: 1700000000 + n, kind: 'code'});

describe('pairing activity on the PC reaches the phone', () => {
  let PC = '';
  beforeEach(() => {
    PC = nextPc();
    jest.spyOn(Alert, 'alert').mockClear();
  });
  afterEach(() => {
    delete (NativeModules as any).HomeLink;
  });

  it('shows each history line once', async () => {
    expect(await newPairingEvents(PC, [code(1), code(2)])).toHaveLength(2);
    expect(await newPairingEvents(PC, [code(1), code(2)])).toHaveLength(0);
    const later = await newPairingEvents(PC, [code(1), code(2), code(3)]);
    expect(later.map(e => e.n)).toEqual([3]);
  });

  it("right after pairing, the phone's own pairing is not news", async () => {
    await newPairingEvents(
      PC,
      [code(1), {n: 2, at: 1, kind: 'paired', name: 'Me'}],
      true,
    );
    expect(await newPairingEvents(PC, [code(1), code(2)])).toHaveLength(0);
  });

  it('a code made while away shows an alert with what to do', async () => {
    const spy = jest.spyOn(Alert, 'alert');
    await noticePairingActivity(PC, [code(5)]);
    expect(spy).toHaveBeenCalledTimes(1);
    const [title, body] = spy.mock.calls[0];
    expect(title).toBe('Pairing activity on your PC');
    expect(body).toContain('a pairing code was made');
    expect(body).toContain("If this wasn't you");
    await noticePairingActivity(PC, [code(5)]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('describes every kind of line', () => {
    expect(
      describeEvent({n: 1, at: 0, kind: 'paired', name: 'Pixel'}),
    ).toContain('phone “Pixel” was paired');
    expect(
      describeEvent({n: 1, at: 0, kind: 'removed', name: 'Old'}),
    ).toContain('was removed');
  });

  it('checking the Home PC before use passes the history on', async () => {
    (NativeModules as any).HomeLink = {
      openTunnel: jest.fn(async () => JSON.stringify({ok: true, port: 6001})),
      status: jest.fn(async () =>
        JSON.stringify({
          ok: true,
          running: true,
          apiKey: 'k',
          events: [code(9)],
        }),
      ),
    };
    const spy = jest.spyOn(Alert, 'alert');
    const id = serverStore.addServer({
      name: 'Home PC',
      url: 'http://127.0.0.1:1',
      homeLinkPc: PC,
    });
    await serverStore.prepareHomeLink(id);
    expect(spy).toHaveBeenCalledWith(
      'Pairing activity on your PC',
      expect.stringContaining('a pairing code was made'),
    );
  });
});
