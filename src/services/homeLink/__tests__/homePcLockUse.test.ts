/**
 * The Home PC PIN where the app uses the PC: chat requests, Load, model
 * lists, removing the PC, pairing again.
 */
import {AppState, NativeModules} from 'react-native';
import * as Keychain from 'react-native-keychain';

import {serverStore} from '../../../store/ServerStore';
import {homeLinkReady, resetHomeLinkKeeper} from '../keepLink';
import {
  homePcGate,
  LOCKED,
  resetHomePcLockForTests,
  subscribePinRequests,
  tryPin,
  turnOnPin,
} from '../homePcLock';
import {pairHomePc} from '../pairHomePc';
import * as openai from '../../../api/openai';

const PC = 'f'.repeat(64);
const store = new Map<string, {username: string; password: string}>();
const K = Keychain as jest.Mocked<typeof Keychain>;

jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation((() => ({remove: () => {}})) as any);

let native: Record<string, jest.Mock>;
let homeId: string;

beforeEach(() => {
  store.clear();
  resetHomePcLockForTests();
  resetHomeLinkKeeper();
  K.setGenericPassword.mockImplementation((async (
    username: string,
    password: string,
    options?: {service?: string},
  ) => {
    store.set(options?.service ?? 'default', {username, password});
    return {service: options?.service, storage: 'test'};
  }) as any);
  K.getGenericPassword.mockImplementation(
    (async (options?: {service?: string}) =>
      store.get(options?.service ?? 'default') ?? false) as any,
  );
  K.resetGenericPassword.mockImplementation((async (options?: {
    service?: string;
  }) => store.delete(options?.service ?? 'default')) as any);
  const status = JSON.stringify({ok: true, running: true, apiKey: 'k'});
  native = {
    pair: jest.fn(async () => JSON.stringify({ok: true, pc: PC})),
    status: jest.fn(async () => status),
    startModel: jest.fn(async () => JSON.stringify({ok: true})),
    openTunnel: jest.fn(async () => JSON.stringify({ok: true, port: 4321})),
    closeTunnel: jest.fn(async () => JSON.stringify({ok: true})),
  };
  (NativeModules as any).HomeLink = native;
  serverStore.servers
    .filter(s => s.homeLinkPc === PC)
    .forEach(s => serverStore.removeServer(s.id));
  homeId = serverStore.addServer({
    name: 'Home PC',
    url: 'http://127.0.0.1:1',
    homeLinkPc: PC,
  });
});

afterEach(() => {
  delete (NativeModules as any).HomeLink;
  jest.restoreAllMocks();
});

const signal = () => new AbortController().signal;
const locked = async () => {
  await turnOnPin(PC, '2468');
  resetHomePcLockForTests(); // as after a restart
};

it('a chat message asks for the PIN first; cancelled, nothing is sent', async () => {
  await locked();
  let asked = 0;
  subscribePinRequests(r => {
    if (r) {
      asked++;
      // The user presses Cancel.
      setTimeout(() => require('../homePcLock').cancelPinRequest(r.pc), 0);
    }
  });
  const ready = homeLinkReady(homeId, {}, false, () => true);
  await expect(ready(signal())).rejects.toThrow(LOCKED);
  expect(asked).toBe(1);
  expect(native.openTunnel).not.toHaveBeenCalled();
  expect(native.status).not.toHaveBeenCalled();
});

it('a chat message goes on once the PIN is entered', async () => {
  await locked();
  subscribePinRequests(r => {
    if (r) {
      setTimeout(() => tryPin(r.pc, '2468'), 0);
    }
  });
  const ready = homeLinkReady(homeId, {}, false, () => true);
  await expect(ready(signal())).resolves.toBeUndefined();
  expect(native.openTunnel).toHaveBeenCalled();
});

it('Load asks for the PIN; a model list read by the app itself does not, and sends nothing', async () => {
  await locked();
  const fetchList = jest.spyOn(openai, 'fetchModelsWithHeaders');
  const result = await serverStore.fetchModelsForServer(homeId);
  expect(result).toEqual({ok: false, error: LOCKED});
  expect(fetchList).not.toHaveBeenCalled();
  expect(native.openTunnel).not.toHaveBeenCalled();

  let asked = 0;
  subscribePinRequests(r => {
    if (r) {
      asked++;
      setTimeout(() => tryPin(r.pc, '2468'), 0);
    }
  });
  expect(await serverStore.prepareHomeLink(homeId, {start: true})).toEqual({
    ok: true,
  });
  expect(asked).toBe(1);
});

it('removing the PC from this device clears its PIN', async () => {
  await locked();
  serverStore.removeServer(homeId);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([...store.keys()].some(k => k.includes(PC))).toBe(false);
  expect(await homePcGate(PC)).toEqual({ok: true});
});

it('pairing again (the PC approved) clears a forgotten PIN', async () => {
  await locked();
  jest.spyOn(serverStore, 'fetchModelsForServer').mockResolvedValue({ok: true});
  const before = Date.now();
  const r = await pairHomePc(`PA1:P:${PC}:${'0'.repeat(32)}`);
  expect(r.ok).toBe(true);
  expect(await homePcGate(PC)).toEqual({ok: true});
  // "Your devices" shows when it was paired (pairing again: the new date).
  expect(
    serverStore.servers.find(s => s.homeLinkPc === PC)?.homeLinkPairedAt,
  ).toBeGreaterThanOrEqual(before);
  // A refused pairing clears nothing.
  await turnOnPin(PC, '1357');
  resetHomePcLockForTests();
  native.pair.mockResolvedValueOnce(
    JSON.stringify({ok: false, error: 'This device is already paired'}),
  );
  expect((await pairHomePc('x')).ok).toBe(false);
  expect(await homePcGate(PC)).toMatchObject({ok: false, locked: true});
});
