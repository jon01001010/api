/**
 * The JS side of PhoneActionsModule (android/.../PhoneActionsModule.kt):
 * Android's own intents for timers, alarms, apps, maps, music, camera,
 * settings pages, calendar events and pre-filled call / text / e-mail
 * screens. Approval is asked by the tools before anything here runs.
 */
import {NativeModules, Platform} from 'react-native';

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
  | 'email';

export type PhoneActionResult =
  | {ok: true}
  | {ok: false; reason: 'no_app' | 'bad_args' | 'failed' | 'unsupported'};

export interface InstalledApp {
  label: string;
  package: string;
}

interface NativePhoneActions {
  perform(action: PhoneAction, args: object): Promise<PhoneActionResult>;
  canPerform(action: PhoneAction, args: object): Promise<boolean>;
  listApps(): Promise<InstalledApp[]>;
}

const native = (): NativePhoneActions | undefined =>
  Platform.OS === 'android'
    ? (NativeModules.PhoneActions as NativePhoneActions | undefined)
    : undefined;

/** False on iOS, or in an APK built before the module existed. */
export const phoneActionsAvailable = (): boolean => !!native();

export async function performPhoneAction(
  action: PhoneAction,
  args: object = {},
): Promise<PhoneActionResult> {
  const mod = native();
  if (!mod) {
    return {ok: false, reason: 'unsupported'};
  }
  try {
    return await mod.perform(action, args);
  } catch {
    return {ok: false, reason: 'failed'};
  }
}

export async function canPerformPhoneAction(
  action: PhoneAction,
  args: object = {},
): Promise<boolean> {
  const mod = native();
  return mod ? mod.canPerform(action, args).catch(() => false) : false;
}

export async function listInstalledApps(): Promise<InstalledApp[]> {
  const mod = native();
  return mod ? mod.listApps().catch(() => []) : [];
}

/** What a failed action means, in words a model can pass on. */
export function describeFailure(
  result: PhoneActionResult,
  what: string,
): string {
  if (result.ok) {
    return '';
  }
  switch (result.reason) {
    case 'no_app':
      return `No app on this phone can ${what}.`;
    case 'bad_args':
      return `Could not ${what}: the details were not valid.`;
    case 'unsupported':
      return 'Phone actions need the Android app.';
    default:
      return `Could not ${what}.`;
  }
}
