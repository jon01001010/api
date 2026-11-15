/**
 * A notification when a loop is due (TODO "Ready-made loops"), so it is
 * noticed with the app closed. It only says so: tapping it opens the app,
 * which asks Run now / Later / Skip (loopRunner). Nothing runs from a
 * notification, and a link or notification for a loop that isn't due does
 * nothing.
 *
 * Phone: one inexact alarm per loop at its next time (LoopAlarmsModule.kt;
 * may be a few minutes late), set again each time the loops are saved and
 * when the app opens (alarms don't survive a restart of the phone).
 * Desktop: a system notification when a loop comes due while DesktopAgent
 * is open but not in front (the existing `notify` command).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {NativeModules, Platform} from 'react-native';

import {isFinished, type Loop} from './loops';

const KEY = '@pocketagent/loops/notify/v1';

/** On unless the user turned it off (a loop is started by the user). */
export async function isLoopNotifyOn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'false';
  } catch {
    return true;
  }
}

export async function setLoopNotifyOn(on: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, String(on));
  const {loadLoops} = require('./loops');
  await syncLoopAlarms(await loadLoops());
}

export interface LoopAlarm {
  id: string;
  title: string;
  at: number;
}

/** A loop already due is announced this long from now (not at once). */
export const OVERDUE_DELAY_MS = 60_000;

/**
 * The alarms to set: one per running loop, at its next time. None when
 * notifications are off; none for paused or finished loops, or for a next
 * time past the loop's end.
 */
export function alarmPlan(
  loops: Loop[],
  on: boolean,
  now = Date.now(),
): LoopAlarm[] {
  if (!on) {
    return [];
  }
  return loops
    .filter(l => !l.paused && !isFinished(l, now) && l.nextAt <= l.endAt)
    .map(l => ({
      id: l.id,
      title: l.title,
      at: Math.max(l.nextAt, now + OVERDUE_DELAY_MS),
    }));
}

const native = (): any =>
  Platform.OS === 'android' ? NativeModules.LoopAlarms : undefined;

/** Sets the phone's loop alarms to match these loops (phone only). */
export async function syncLoopAlarms(
  loops: Loop[],
  now = Date.now(),
): Promise<void> {
  const mod = native();
  if (!mod?.schedule) {
    return;
  }
  try {
    await mod.schedule(alarmPlan(loops, await isLoopNotifyOn(), now));
  } catch {
    // No alarms: the app still asks while it is open.
  }
}

/** The loop whose notification opened the app, once (phone only). */
export async function takeOpenedLoop(): Promise<string | undefined> {
  const mod = native();
  if (!mod?.takeOpened) {
    return undefined;
  }
  try {
    const id = await mod.takeOpened();
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Inside DesktopAgent (Tauri), else undefined. */
const tauri = (): any => (globalThis as any).__TAURI_INTERNALS__;

export const isDesktopApp = (): boolean => Boolean(tauri()?.invoke);

/** DesktopAgent is open but not in front (minimised, or behind others). */
export function desktopInBackground(): boolean {
  const doc = (globalThis as any).document;
  if (!doc) {
    return false;
  }
  return (
    doc.visibilityState === 'hidden' ||
    (typeof doc.hasFocus === 'function' && !doc.hasFocus())
  );
}

/** Desktop: a system notification that a loop is due (if on, and behind). */
export async function notifyDesktop(loop: Loop): Promise<boolean> {
  if (!isDesktopApp() || !desktopInBackground() || !(await isLoopNotifyOn())) {
    return false;
  }
  try {
    await tauri().invoke('notify', {
      title: `Loop due: ${loop.title}`,
      body: 'Open DesktopAgent to choose: Run now, Later or Skip.',
    });
    return true;
  } catch {
    return false;
  }
}
