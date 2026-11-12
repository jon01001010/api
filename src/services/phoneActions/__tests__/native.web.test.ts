/**
 * The phone's actions in the desktop app: the PC's version of each, through
 * the native side's one "open" door (src-tauri/src/open.rs), which asks.
 */
import {Alert} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import {
  actionAsksItself,
  describeFailure,
  performPhoneAction,
  targetFor,
} from '../native.web';
import * as reminders from '../pcReminders';

const invoke = jest.fn(async () => null);

const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
};

beforeEach(() => {
  invoke.mockClear();
  (globalThis as any).__TAURI_INTERNALS__ = {invoke};
  reminders.cancelAll();
});
afterEach(() => {
  delete (globalThis as any).__TAURI_INTERNALS__;
  jest.useRealTimers();
});

it('opens maps, search and e-mail drafts without Google', () => {
  expect(targetFor('navigate', {destination: 'Stanley Park'})).toBe(
    'https://www.openstreetmap.org/search?query=Stanley%20Park',
  );
  expect(targetFor('search', {query: 'weather & rain'})).toBe(
    'https://duckduckgo.com/?q=weather%20%26%20rain',
  );
  expect(
    targetFor('email', {to: 'a@b.com', subject: 'Hi', body: 'See you'}),
  ).toBe('mailto:a@b.com?subject=Hi&body=See%20you');
  // Searching inside an app (a phone thing): not on the PC.
  expect(targetFor('search', {query: 'x', package: 'com.app'})).toBeNull();
});

it('goes through the native "open" door, which asks itself', async () => {
  await expect(
    performPhoneAction('navigate', {destination: 'Victoria'}),
  ).resolves.toEqual({ok: true});
  expect(invoke).toHaveBeenCalledWith('open_external', {
    target: 'https://www.openstreetmap.org/search?query=Victoria',
  });
  expect(actionAsksItself('navigate')).toBe(true);
  // Timers are kept by the app: the tool asks, as on the phone.
  expect(actionAsksItself('set_timer')).toBe(false);
  invoke.mockRejectedValueOnce('The user said no. Nothing was opened.');
  await expect(performPhoneAction('email', {to: 'a@b.com'})).resolves.toEqual({
    ok: false,
    reason: 'failed',
  });
});

it('timers go off in the app with a dialog', async () => {
  jest.useFakeTimers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const r = await performPhoneAction('set_timer', {seconds: 60, label: 'Tea'});
  expect(r).toEqual({
    ok: true,
    note: expect.stringMatching(/pops up on the PC when due/),
  });
  expect(reminders.describeAll()).toMatch(/Tea, in 1 min/);
  jest.advanceTimersByTime(60_000);
  expect(alert).toHaveBeenCalledWith('Timer done', 'Tea');
  expect(reminders.list()).toEqual([]);
});

it('a weekday alarm finds its next day', () => {
  // Wednesday 2026-11-11 10:00; alarm 7:30 on Monday (phone day 2).
  const now = new Date(2026, 10, 11, 10, 0);
  const at = new Date(reminders.nextAlarmTime(7, 30, [1], now));
  expect(at.getDay()).toBe(1);
  expect(at.getHours()).toBe(7);
  expect(at.getDate()).toBe(16);
});

it('share copies; calls, texts, camera and apps need the phone', async () => {
  await expect(
    performPhoneAction('share_text', {text: 'hello'}),
  ).resolves.toMatchObject({ok: true});
  expect(Clipboard.setString).toHaveBeenCalledWith('hello');
  for (const action of [
    'dial',
    'sms',
    'open_camera',
    'play_music',
    'open_app',
  ] as const) {
    const r = await performPhoneAction(action, {});
    expect(r).toEqual({ok: false, reason: 'unsupported'});
    expect(describeFailure(r, 'call')).toMatch(/needs the phone/);
  }
  expect(invoke).not.toHaveBeenCalled();
});

it('timers survive closing the app; missed ones show at the next start', () => {
  jest.useFakeTimers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const now = Date.now();
  reminders.add({kind: 'reminder', label: 'Call mum', at: now + 60_000});
  reminders.add({kind: 'timer', label: 'Tea', at: now + 3_600_000});
  const saved = (globalThis as any).localStorage.getItem(
    'pa-desktop-reminders-v1',
  );
  // The app closes (nothing pending in memory) and opens 2 minutes later.
  reminders.cancelAll();
  (globalThis as any).localStorage.setItem('pa-desktop-reminders-v1', saved);
  reminders.restore(now + 120_000);
  expect(alert).toHaveBeenCalledWith(
    'Reminder (missed while closed)',
    expect.stringContaining('Call mum'),
  );
  expect(reminders.list().map(r => r.label)).toEqual(['Tea']);
});
