/**
 * Phone actions in the desktop app (the phone's version is native.ts): the
 * same tools do the PC's version of the job.
 *
 * - Timers, alarms, reminders: kept by DesktopAgent, shown when due (while
 *   the app is open; pcReminders.ts).
 * - Maps, web search, e-mail drafts, Windows settings pages: opened in the
 *   PC's own apps through the native side, which asks first in a native
 *   dialog showing exactly what opens (src-tauri/src/open.rs). Maps and
 *   search use OpenStreetMap and DuckDuckGo (no Google).
 * - Share text: copied to the clipboard.
 * - Calls, texts, camera, music, other apps: need the phone.
 */
import {Alert} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import * as reminders from './pcReminders';

export type PhoneAction =
  | 'set_timer'
  | 'show_timers'
  | 'set_alarm'
  | 'show_alarms'
  | 'open_app'
  | 'navigate'
  | 'play_music'
  | 'open_camera'
  | 'open_settings'
  | 'add_reminder'
  | 'dial'
  | 'sms'
  | 'email'
  | 'share_text'
  | 'search';

export type PhoneActionResult =
  | {ok: true; note?: string}
  | {ok: false; reason: 'no_app' | 'bad_args' | 'failed' | 'unsupported'};

export interface InstalledApp {
  label: string;
  package: string;
}

export interface Contact {
  name: string;
  number: string;
}

const tauri = () =>
  (globalThis as any).__TAURI_INTERNALS__ as
    | {invoke: (cmd: string, args?: object) => Promise<unknown>}
    | undefined;

export const phoneActionsAvailable = (): boolean => !!tauri();

/** Windows settings pages for the tool's page names (Windows only). */
export const SETTINGS_URI: Record<string, string> = {
  main: 'ms-settings:',
  wifi: 'ms-settings:network-wifi',
  bluetooth: 'ms-settings:bluetooth',
  battery: 'ms-settings:batterysaver',
  display: 'ms-settings:display',
  sound: 'ms-settings:sound',
  location: 'ms-settings:privacy-location',
  apps: 'ms-settings:appsfeatures',
  notifications: 'ms-settings:notifications',
  airplane: 'ms-settings:network-airplanemode',
};

const isWindows = () =>
  typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

/**
 * Actions whose native side asks the user itself (a native dialog with the
 * exact address), so the tool doesn't ask a second time.
 */
export const actionAsksItself = (action: PhoneAction): boolean =>
  ['navigate', 'search', 'email', 'open_settings'].includes(action);

/** What each action opens (exported for tests). */
export function targetFor(
  action: PhoneAction,
  args: Record<string, any>,
): string | null {
  const enc = encodeURIComponent;
  switch (action) {
    case 'navigate':
      return args.destination
        ? `https://www.openstreetmap.org/search?query=${enc(String(args.destination))}`
        : null;
    case 'search':
      return args.query && !args.package
        ? `https://duckduckgo.com/?q=${enc(String(args.query))}`
        : null;
    case 'email': {
      const q = [
        args.subject ? `subject=${enc(String(args.subject))}` : '',
        args.body ? `body=${enc(String(args.body))}` : '',
      ].filter(Boolean);
      return `mailto:${args.to ? enc(String(args.to)).replace('%40', '@') : ''}${
        q.length ? `?${q.join('&')}` : ''
      }`;
    }
    case 'open_settings':
      return isWindows() ? (SETTINGS_URI[String(args.page)] ?? null) : null;
    default:
      return null;
  }
}

async function open(target: string): Promise<PhoneActionResult> {
  const t = tauri();
  if (!t) {
    return {ok: false, reason: 'unsupported'};
  }
  try {
    await t.invoke('open_external', {target});
    return {ok: true};
  } catch {
    // Refused in the native dialog, or the PC couldn't open it.
    return {ok: false, reason: 'failed'};
  }
}

const WHILE_OPEN = 'It goes off while DesktopAgent is open.';

export async function performPhoneAction(
  action: PhoneAction,
  args: Record<string, any> = {},
): Promise<PhoneActionResult> {
  switch (action) {
    case 'set_timer': {
      const seconds = Number(args.seconds);
      if (!(seconds > 0) || seconds * 1000 > reminders.MAX_WAIT_MS) {
        return {ok: false, reason: 'bad_args'};
      }
      reminders.add({
        kind: 'timer',
        label: String(args.label ?? ''),
        at: Date.now() + seconds * 1000,
      });
      return {ok: true, note: `Timer set in DesktopAgent. ${WHILE_OPEN}`};
    }
    case 'set_alarm': {
      const hour = Number(args.hour);
      const minute = Number(args.minutes ?? 0);
      if (!(hour >= 0 && hour < 24 && minute >= 0 && minute < 60)) {
        return {ok: false, reason: 'bad_args'};
      }
      const days = Array.isArray(args.days)
        ? // The phone's days are 1 = Sunday … 7 = Saturday.
          args.days.map((d: number) => (Number(d) - 1 + 7) % 7)
        : undefined;
      reminders.add({
        kind: 'alarm',
        label: String(args.label ?? ''),
        at: reminders.nextAlarmTime(hour, minute, days, new Date()),
        days,
      });
      return {ok: true, note: `Alarm set in DesktopAgent. ${WHILE_OPEN}`};
    }
    case 'add_reminder': {
      const at = Number(args.startMs);
      if (!(at > Date.now()) || at - Date.now() > reminders.MAX_WAIT_MS) {
        return {ok: false, reason: 'bad_args'};
      }
      reminders.add({kind: 'reminder', label: String(args.title ?? ''), at});
      return {
        ok: true,
        note: `Reminder set in DesktopAgent (not in a calendar). ${WHILE_OPEN}`,
      };
    }
    case 'show_timers':
    case 'show_alarms':
      Alert.alert('Timers, alarms and reminders', reminders.describeAll());
      return {ok: true, note: reminders.describeAll()};
    case 'share_text':
      if (args.package || !args.text) {
        return {ok: false, reason: 'unsupported'};
      }
      Clipboard.setString(String(args.text));
      return {
        ok: true,
        note: 'The text was copied; the user pastes it where they want it.',
      };
    case 'navigate':
    case 'search':
    case 'email':
    case 'open_settings': {
      const target = targetFor(action, args);
      return target ? open(target) : {ok: false, reason: 'unsupported'};
    }
    default:
      // dial, sms, open_camera, play_music, open_app: they need the phone.
      return {ok: false, reason: 'unsupported'};
  }
}

export async function canPerformPhoneAction(
  action: PhoneAction,
  _args: object = {},
): Promise<boolean> {
  return !['dial', 'sms', 'open_camera', 'play_music', 'open_app'].includes(
    action,
  );
}

/** The PC's apps aren't listed (opening other programs: not yet). */
export async function listInstalledApps(): Promise<InstalledApp[]> {
  return [];
}

export function describeFailure(
  result: PhoneActionResult,
  what: string,
): string {
  if (result.ok) {
    return '';
  }
  switch (result.reason) {
    case 'bad_args':
      return `Could not ${what}: the details were not valid.`;
    case 'unsupported':
      return `That needs the phone: DesktopAgent can't ${what} on the PC.`;
    default:
      return `Could not ${what} (or the user said no on the PC).`;
  }
}

export async function findContacts(_query: string): Promise<Contact[]> {
  return [];
}
