import {AppState, Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {pbkdf2Sync} from 'crypto';

import * as pinHash from '../../homeLink/pinHash';
import {
  appLockedNow,
  appLockMarked,
  appLockOn,
  appLockSettings,
  holdAlertsWhileLocked,
  appUnlockedNow,
  changeAppLock,
  loadAppLock,
  noteAppAway,
  privateNotice,
  resetAppLockForTests,
  tryAppPin,
  turnOnAppPin,
  whenAppUnlocked,
} from '../appLock';
import {FIRST_WAIT_MS, setMonotonicClockForTests} from '../../pinLock/pinCore';

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

const mockErase = jest.fn(async () => true);
jest.mock('../appErase', () => ({
  eraseAvailable: () => true,
  eraseEverything: () => mockErase(),
  setSecureWindow: (on: boolean) => mockSecure(on),
}));
const mockSecure = jest.fn();

const SERVICE = 'pocketagent-app-lock';
const store = new Map<string, {username: string; password: string}>();
const K = Keychain as jest.Mocked<typeof Keychain>;

jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation((() => ({remove: () => {}})) as any);

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSecure.mockClear();
  store.clear();
  mockErase.mockClear();
  resetAppLockForTests();
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
});

afterEach(() => {
  setMonotonicClockForTests();
  jest.restoreAllMocks();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((() => ({remove: () => {}})) as any);
});

/** As after a restart: memory gone, the key store kept. */
const restart = async () => {
  resetAppLockForTests();
  return loadAppLock();
};
const record = () => JSON.parse(store.get(SERVICE)!.password);
const hashOf = (pin: string, salt: string, rounds: number) =>
  pbkdf2Sync(pin, Buffer.from(salt, 'hex'), rounds, 32, 'sha256').toString(
    'hex',
  );

describe('app PIN: off by default, hash only', () => {
  it('is off until turned on, and the app is open', async () => {
    expect(await loadAppLock()).toBe('off');
    expect(appUnlockedNow()).toBe(true);
    expect(appLockOn()).toBe(false);
    await expect(whenAppUnlocked()).resolves.toBeUndefined();
    expect((await appLockSettings()).on).toBe(false);
  });

  it('keeps salted PBKDF2 hashes only, never the PIN, and two slots always', async () => {
    expect((await turnOnAppPin('48291573')).ok).toBe(true);
    const saved = store.get(SERVICE)!;
    expect(saved.password).not.toContain('48291573');
    const r = record();
    expect(r.a.hash).toBe(hashOf('48291573', r.a.salt, r.rounds));
    // The second slot is there with no erase PIN too (a random hash).
    expect(r.erase).toBe(false);
    expect(r.b.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(r.b.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.b.salt).not.toBe(r.a.salt);
  });

  it('4 to 16 digits only', async () => {
    expect((await turnOnAppPin('123')).ok).toBe(false);
    expect((await turnOnAppPin('12345678901234567')).ok).toBe(false);
    expect((await turnOnAppPin('12a4')).ok).toBe(false);
    expect(store.size).toBe(0);
    expect((await turnOnAppPin('1234567890123456')).ok).toBe(true);
    expect((await turnOnAppPin('0000')).ok).toBe(false);
  });

  it('a broken or unreadable record keeps the app locked', async () => {
    store.set(SERVICE, {username: 'app-lock-v1', password: '{"v":1}'});
    expect(await restart()).toBe('error');
    expect(appUnlockedNow()).toBe(false);
    resetAppLockForTests();
    K.getGenericPassword.mockRejectedValueOnce(new Error('keystore'));
    expect(await loadAppLock()).toBe('error');
    expect(appUnlockedNow()).toBe(false);
  });
});

describe('asked at start and after being away', () => {
  it('locked after a restart until the right PIN', async () => {
    await turnOnAppPin('2468');
    expect(await restart()).toBe('locked');
    expect(appUnlockedNow()).toBe(false);
    let opened = false;
    whenAppUnlocked().then(() => {
      opened = true;
    });
    expect(await tryAppPin('1357')).toMatchObject({ok: false, reason: 'wrong'});
    await Promise.resolve();
    expect(opened).toBe(false);
    expect(await tryAppPin('2468')).toEqual({ok: true});
    await new Promise(r => setTimeout(r, 0));
    expect(opened).toBe(true);
    expect(appUnlockedNow()).toBe(true);
  });

  it('locks again after more than the chosen minutes away, not before', async () => {
    await turnOnAppPin('2468', 5);
    const t = 1_000_000;
    noteAppAway(true, t);
    // While away: nothing acts after the minutes have passed.
    expect(appUnlockedNow(t + 4 * 60_000)).toBe(true);
    expect(appUnlockedNow(t + 6 * 60_000)).toBe(false);
    noteAppAway(false, t + 4 * 60_000);
    expect(appUnlockedNow()).toBe(true);
    noteAppAway(true, t + 10 * 60_000);
    noteAppAway(false, t + 16 * 60_000);
    expect(appUnlockedNow()).toBe(false);
    expect(await tryAppPin('2468')).toEqual({ok: true});
  });

  it('5 wrong tries, then a wait kept across a restart', async () => {
    await turnOnAppPin('2468');
    await restart();
    for (let i = 0; i < 4; i++) {
      expect((await tryAppPin('1111')).ok).toBe(false);
    }
    expect(await tryAppPin('1111')).toMatchObject({reason: 'wait'});
    expect(record().waitLeft).toBe(FIRST_WAIT_MS);
    await restart();
    // The right PIN is refused during the wait, before any hashing.
    const spy = jest.spyOn(pinHash, 'pbkdf2Sha256Async');
    expect(await tryAppPin('2468')).toMatchObject({reason: 'wait'});
    expect(spy).not.toHaveBeenCalled();
  });

  it('changing or turning it off needs the current PIN', async () => {
    await turnOnAppPin('2468');
    expect(await changeAppLock('1111', {off: true})).toMatchObject({
      ok: false,
    });
    expect(store.has(SERVICE)).toBe(true);
    expect(await changeAppLock('2468', {newPin: '97531'})).toEqual({ok: true});
    expect(record().a.hash).toBe(hashOf('97531', record().a.salt, 30000));
    expect(await changeAppLock('97531', {off: true})).toEqual({ok: true});
    expect(store.has(SERVICE)).toBe(false);
    expect(appUnlockedNow()).toBe(true);
  });

  it('notifications say nothing while it is on', async () => {
    expect(privateNotice('Loop due: Gym', 'x')).toEqual({
      title: 'Loop due: Gym',
      body: 'x',
    });
    await turnOnAppPin('2468');
    expect(privateNotice('Loop due: Gym', 'x').title).not.toContain('Gym');
  });
});

describe('erase PIN (duress style)', () => {
  it('only while the app PIN is on, with it, and different from it', async () => {
    expect(await changeAppLock('2468', {erasePin: '9999'})).toEqual({ok: true});
    // No app PIN: nothing was set.
    expect(store.has(SERVICE)).toBe(false);
    await turnOnAppPin('2468');
    expect(await changeAppLock('1111', {erasePin: '9999'})).toMatchObject({
      ok: false,
    });
    expect(await changeAppLock('2468', {erasePin: '2468'})).toMatchObject({
      ok: false,
      message: 'The app PIN and the erase PIN must differ.',
    });
    expect(await changeAppLock('2468', {erasePin: '9999'})).toEqual({ok: true});
    const r = record();
    expect(r.erase).toBe(true);
    expect(r.b.hash).toBe(hashOf('9999', r.b.salt, r.rounds));
    expect(store.get(SERVICE)!.password).not.toContain('9999');
    // A new app PIN can't be the erase PIN.
    expect(await changeAppLock('2468', {newPin: '9999'})).toMatchObject({
      ok: false,
    });
    expect((await appLockSettings()).erase).toBe(true);
    expect(mockErase).not.toHaveBeenCalled();
  });

  it('entering it erases at once, without asking', async () => {
    await turnOnAppPin('2468');
    await changeAppLock('2468', {erasePin: '9999'});
    await restart();
    await tryAppPin('9999');
    expect(mockErase).toHaveBeenCalledTimes(1);
    expect(appUnlockedNow()).toBe(false);
  });

  it('works wherever the app PIN is asked (Settings too)', async () => {
    await turnOnAppPin('2468');
    await changeAppLock('2468', {erasePin: '9999'});
    await changeAppLock('9999', {off: true});
    expect(mockErase).toHaveBeenCalledTimes(1);
    expect(store.has(SERVICE)).toBe(true);
  });

  it('every try does the same work: both hashes, whatever was entered', async () => {
    const spy = jest.spyOn(pinHash, 'pbkdf2Sha256Async');
    await turnOnAppPin('2468');
    spy.mockClear();
    const count = async (pin: string) => {
      spy.mockClear();
      await tryAppPin(pin);
      return spy.mock.calls.map(c => c[2]);
    };
    // No erase PIN set: still two hashes of the same rounds.
    expect(await count('1111')).toEqual([30000, 30000]);
    expect(await count('2468')).toEqual([30000, 30000]);
    await changeAppLock('2468', {erasePin: '9999'});
    expect(await count('1111')).toEqual([30000, 30000]);
    expect(await count('2468')).toEqual([30000, 30000]);
    expect(await count('9999')).toEqual([30000, 30000]);
    expect(mockErase).toHaveBeenCalledTimes(1);
  });

  it('a wait blocks the erase PIN like the app PIN', async () => {
    await turnOnAppPin('2468');
    await changeAppLock('2468', {erasePin: '9999'});
    await restart();
    for (let i = 0; i < 5; i++) {
      await tryAppPin('1111');
    }
    expect(await tryAppPin('9999')).toMatchObject({reason: 'wait'});
    expect(mockErase).not.toHaveBeenCalled();
    expect(await tryAppPin('2468')).toMatchObject({reason: 'wait'});
  });

  it('removing it puts a random hash back', async () => {
    await turnOnAppPin('2468');
    await changeAppLock('2468', {erasePin: '9999'});
    expect(await changeAppLock('2468', {erasePin: null})).toEqual({ok: true});
    expect(record().erase).toBe(false);
    expect(record().b.hash).not.toBe(hashOf('9999', record().b.salt, 30000));
    await restart();
    expect(await tryAppPin('9999')).toMatchObject({reason: 'wrong'});
    expect(mockErase).not.toHaveBeenCalled();
  });
});

describe('security review 2 (2026-11-18)', () => {
  const MARKER = '@pocketagent/app-lock/on/v1';

  it('a marker outside the key store: a missing record is locked, never off', async () => {
    await turnOnAppPin('2468');
    expect(await AsyncStorage.getItem(MARKER)).toBe('on');
    // The key store lost its entry (a restart on Linux, another program).
    store.delete(SERVICE);
    expect(await restart()).toBe('error');
    expect(appUnlockedNow()).toBe(false);
    expect(await tryAppPin('2468')).toMatchObject({ok: false, reason: 'error'});
    expect(appUnlockedNow()).toBe(false);
    expect(await appLockMarked()).toBe(true);
    // Unreadable is locked too.
    resetAppLockForTests();
    K.getGenericPassword.mockRejectedValueOnce(new Error('keystore'));
    expect(await loadAppLock()).toBe('error');
  });

  it('the marker goes only when the PIN is turned off with the PIN', async () => {
    await turnOnAppPin('2468');
    await changeAppLock('1111', {off: true});
    expect(await AsyncStorage.getItem(MARKER)).toBe('on');
    await changeAppLock('2468', {off: true});
    expect(await AsyncStorage.getItem(MARKER)).toBeNull();
    expect(await restart()).toBe('off');
  });

  it('a PIN from before the marker gets one at the next start', async () => {
    await turnOnAppPin('2468');
    await AsyncStorage.removeItem(MARKER);
    expect(await restart()).toBe('locked');
    expect(await AsyncStorage.getItem(MARKER)).toBe('on');
  });

  it('locks while away as soon as the minutes pass, before any return', async () => {
    // Fake timers only after the PIN is set (hashing yields to timers).
    await turnOnAppPin('2468', 1);
    jest.useFakeTimers();
    try {
      noteAppAway(true);
      jest.advanceTimersByTime(59_000);
      expect(appLockedNow()).toBe(false);
      jest.advanceTimersByTime(2_000);
      expect(appLockedNow()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('coming back early stops the timer', async () => {
    // Fake timers only after the PIN is set (hashing yields to timers).
    await turnOnAppPin('2468', 1);
    jest.useFakeTimers();
    try {
      noteAppAway(true);
      jest.advanceTimersByTime(30_000);
      noteAppAway(false);
      jest.advanceTimersByTime(5 * 60_000);
      expect(appLockedNow()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a failed erase is exactly a wrong PIN: same answer, same count', async () => {
    await turnOnAppPin('2468');
    await changeAppLock('2468', {erasePin: '9999'});
    await restart();
    mockErase.mockResolvedValue(false);
    const wrong = await tryAppPin('1111');
    const erase = await tryAppPin('9999');
    expect(mockErase).toHaveBeenCalledTimes(1);
    expect(wrong).toEqual({
      ok: false,
      reason: 'wrong',
      triesLeft: 4,
      message: 'Wrong PIN. 4 tries left before a wait.',
    });
    expect(erase).toEqual({
      ok: false,
      reason: 'wrong',
      triesLeft: 3,
      message: 'Wrong PIN. 3 tries left before a wait.',
    });
    expect(record().fails).toBe(2);
    await tryAppPin('1111');
    await tryAppPin('1111');
    // The fifth (a failed erase) starts the wait like any wrong PIN.
    expect(await tryAppPin('9999')).toMatchObject({reason: 'wait'});
    mockErase.mockResolvedValue(true);
  });

  it('the window is secure while the PIN is on (phone)', async () => {
    await turnOnAppPin('2468');
    expect(mockSecure).toHaveBeenLastCalledWith(true);
    await restart();
    expect(mockSecure).toHaveBeenLastCalledWith(true);
    await changeAppLock('2468', {off: true});
    expect(mockSecure).toHaveBeenLastCalledWith(false);
  });

  it('desktop: the native side is told on every change, and at start', async () => {
    const invoke = jest.fn(async (_cmd: string, _args?: any) => undefined);
    (globalThis as any).__TAURI_INTERNALS__ = {invoke};
    jest.replaceProperty(Platform, 'OS', 'web');
    try {
      await turnOnAppPin('2468');
      await restart();
      const told = () =>
        invoke.mock.calls.filter(c => c[0] === 'app_set_locked').map(c => c[1]);
      expect(told().at(-1)).toEqual({locked: true});
      await tryAppPin('2468');
      expect(told().at(-1)).toEqual({locked: false});
      invoke.mockRejectedValue(new Error('no such command'));
      await expect(changeAppLock('2468', {off: true})).resolves.toEqual({
        ok: true,
      });
    } finally {
      delete (globalThis as any).__TAURI_INTERNALS__;
      resetAppLockForTests();
    }
  });

  it('dialogs wait while locked and come after the unlock', async () => {
    const original = jest.fn();
    const target = {alert: original as Function};
    holdAlertsWhileLocked(target);
    await turnOnAppPin('2468');
    target.alert('Shown at once', 'unlocked');
    expect(original).toHaveBeenCalledTimes(1);
    await restart();
    target.alert('Take the system prompt?', 'x');
    await new Promise(r => setTimeout(r, 0));
    expect(original).toHaveBeenCalledTimes(1);
    await tryAppPin('2468');
    await new Promise(r => setTimeout(r, 0));
    expect(original).toHaveBeenLastCalledWith('Take the system prompt?', 'x');
  });
});
