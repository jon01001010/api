import {Alert, NativeModules, Platform} from 'react-native';

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

jest.mock('../../../store', () => ({
  chatSessionStore: {sessions: [], activeSessionId: null},
  modelStore: {activeModelId: 'm', isGenerationBusy: false},
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  alarmPlan,
  isLoopNotifyOn,
  notifyDesktop,
  OVERDUE_DELAY_MS,
  setLoopNotifyOn,
  syncLoopAlarms,
  takeOpenedLoop,
} from '../loopNotify';
import {loadLoops, startLoop, stopLoop, updateLoop, type Loop} from '../loops';
import {lookForDue, stopLoopWatch} from '../loopRunner';

const NOW = new Date(2026, 10, 13, 9, 30).getTime();
const HOUR = 3600_000;

const loop = (over: Partial<Loop> = {}): Loop => ({
  id: 'a',
  templateId: 'focus-timer',
  title: 'Focus check-in',
  prompt: 'p',
  every: 'hour',
  nextAt: NOW + HOUR,
  runs: 0,
  maxRuns: 5,
  endAt: NOW + 24 * HOUR,
  paused: false,
  log: [],
  ...over,
});

const mod = {
  schedule: jest.fn(async (_list: unknown[]) => 0),
  takeOpened: jest.fn(async (): Promise<string | null> => null),
};

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  stopLoopWatch();
  jest.restoreAllMocks();
  mod.schedule.mockClear();
  mod.takeOpened.mockReset().mockResolvedValue(null);
  jest.replaceProperty(Platform, 'OS', 'android');
  (NativeModules as any).LoopAlarms = mod;
  delete (globalThis as any).__TAURI_INTERNALS__;
});

afterAll(() => {
  delete (NativeModules as any).LoopAlarms;
});

describe('loop notifications: the plan', () => {
  it('one alarm per running loop, at its next time', () => {
    expect(alarmPlan([loop()], true, NOW)).toEqual([
      {id: 'a', title: 'Focus check-in', at: NOW + HOUR},
    ]);
  });

  it('none when off, paused, finished, or next time past the end', () => {
    expect(alarmPlan([loop()], false, NOW)).toEqual([]);
    expect(alarmPlan([loop({paused: true})], true, NOW)).toEqual([]);
    expect(alarmPlan([loop({runs: 5})], true, NOW)).toEqual([]);
    expect(alarmPlan([loop({endAt: NOW - 1})], true, NOW)).toEqual([]);
    expect(
      alarmPlan([loop({nextAt: NOW + 2 * HOUR, endAt: NOW + HOUR})], true, NOW),
    ).toEqual([]);
  });

  it('a loop already due is announced a minute from now, not at once', () => {
    expect(alarmPlan([loop({nextAt: NOW - HOUR})], true, NOW)[0].at).toBe(
      NOW + OVERDUE_DELAY_MS,
    );
  });
});

describe('loop notifications: the phone', () => {
  const start = () =>
    startLoop({
      templateId: 'focus-timer',
      values: {task: 'report'},
      every: 'hour',
      maxRuns: 3,
      days: 1,
      // The alarms are planned from the real clock.
      now: Date.now() - HOUR,
    }) as Promise<{ok: true; loop: Loop}>;

  it('every change to the loops sets the alarms again', async () => {
    const {loop: l} = await start();
    expect(mod.schedule).toHaveBeenLastCalledWith([
      {id: l.id, title: l.title, at: expect.any(Number)},
    ]);
    await updateLoop(l.id, x => ({...x, paused: true}));
    expect(mod.schedule).toHaveBeenLastCalledWith([]);
    await updateLoop(l.id, x => ({...x, paused: false}));
    expect(mod.schedule).toHaveBeenLastCalledWith([
      expect.objectContaining({id: l.id}),
    ]);
    await stopLoop(l.id);
    expect(mod.schedule).toHaveBeenLastCalledWith([]);
  });

  it('the switch: on by default; off clears every alarm', async () => {
    expect(await isLoopNotifyOn()).toBe(true);
    await start();
    await setLoopNotifyOn(false);
    expect(await isLoopNotifyOn()).toBe(false);
    expect(mod.schedule).toHaveBeenLastCalledWith([]);
    await setLoopNotifyOn(true);
    expect(mod.schedule.mock.calls.at(-1)?.[0]).toHaveLength(1);
  });

  it('titles are private whenever the PIN is on, by its marker too (review 2)', async () => {
    const {loop: l} = await start();
    expect(mod.schedule).toHaveBeenLastCalledWith([
      expect.objectContaining({title: l.title}),
    ]);
    // The key store's record not read yet (or gone): the marker decides.
    await AsyncStorage.setItem('@pocketagent/app-lock/on/v1', 'on');
    await syncLoopAlarms(await loadLoops());
    expect(mod.schedule).toHaveBeenLastCalledWith([
      expect.objectContaining({id: l.id, title: 'a loop'}),
    ]);
  });

  it('turning the PIN on sets the alarms already there again, privately', async () => {
    const Keychain = require('react-native-keychain');
    Keychain.getGenericPassword.mockResolvedValue(false);
    Keychain.setGenericPassword.mockResolvedValue(true);
    const lock = require('../../appLock/appLock');
    const {loop: l} = await start();
    mod.schedule.mockClear();
    expect((await lock.turnOnAppPin('2468')).ok).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(mod.schedule).toHaveBeenLastCalledWith([
      expect.objectContaining({id: l.id, title: 'a loop'}),
    ]);
    lock.resetAppLockForTests();
  });

  it('nothing to do where there is no native module', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    await syncLoopAlarms([loop()]);
    expect(mod.schedule).not.toHaveBeenCalled();
    expect(await takeOpenedLoop()).toBeUndefined();
  });

  it('a tapped notification only leads to the question, for a due loop', async () => {
    const {loop: l} = await start();
    const T = Date.now();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Asked once, and the question closed without an answer:
    expect((await lookForDue(T))?.id).toBe(l.id);
    const dismiss = (alert.mock.calls[0] as any)[3].onDismiss;
    dismiss();
    expect(await lookForDue(T)).toBeUndefined();
    // The notification for it was tapped: asked again.
    expect((await lookForDue(T, l.id))?.id).toBe(l.id);
    expect(alert).toHaveBeenCalledTimes(2);
    // While its question is on screen, a second tap doesn't stack another.
    expect(await lookForDue(T, l.id)).toBeUndefined();
    // Nothing ran: no run counted.
    expect((await loadLoops())[0].runs).toBe(0);
  });

  it('a tap for a loop that is not due (or not there) asks nothing', async () => {
    const {loop: l} = await start();
    const T = Date.now();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    expect(await lookForDue(T - 2 * HOUR, l.id)).toBeUndefined();
    expect(await lookForDue(T - 2 * HOUR, 'nope')).toBeUndefined();
    await updateLoop(l.id, x => ({...x, paused: true}));
    expect(await lookForDue(T, l.id)).toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
  });

  it('takes the opened loop from the phone once', async () => {
    mod.takeOpened.mockResolvedValueOnce('abc');
    expect(await takeOpenedLoop()).toBe('abc');
    expect(await takeOpenedLoop()).toBeUndefined();
  });
});

describe('loop notifications: the desktop', () => {
  const invoke = jest.fn(async (..._args: unknown[]) => undefined);
  const setFocus = (focused: boolean) => {
    (globalThis as any).document = {
      visibilityState: 'visible',
      hasFocus: () => focused,
    };
  };

  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'web');
    invoke.mockClear();
    (globalThis as any).__TAURI_INTERNALS__ = {invoke};
  });

  afterAll(() => {
    delete (globalThis as any).__TAURI_INTERNALS__;
    delete (globalThis as any).document;
  });

  it('notifies only while DesktopAgent is behind other windows', async () => {
    setFocus(true);
    expect(await notifyDesktop(loop())).toBe(false);
    setFocus(false);
    expect(await notifyDesktop(loop())).toBe(true);
    expect(invoke).toHaveBeenCalledWith('notify', {
      title: 'Loop due: Focus check-in',
      body: 'Open DesktopAgent to choose: Run now, Later or Skip.',
    });
    await setLoopNotifyOn(false);
    expect(await notifyDesktop(loop())).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('a due loop on the desktop: the question, plus a notification', async () => {
    setFocus(false);
    const r = (await startLoop({
      templateId: 'focus-timer',
      values: {task: 'x'},
      every: 'hour',
      maxRuns: 2,
      days: 1,
      now: NOW,
    })) as {ok: true; loop: Loop};
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    expect((await lookForDue(NOW))?.id).toBe(r.loop.id);
    await new Promise(res => setTimeout(res, 0));
    expect(invoke).toHaveBeenCalledWith('notify', expect.anything());
  });
});
