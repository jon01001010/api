/**
 * App PIN (phone and PC), with an optional erase PIN in the style of
 * GrapheneOS's duress PIN. Off by default; set in Settings.
 *
 * - Asked when the app starts, before the app's own code (and with it the
 *   chats) is even loaded (components/AppLock/AppLockRoot), and again after
 *   the app was in the background / minimised / hidden in the tray for more
 *   than the chosen minutes (default 5). While locked nothing of the app is
 *   shown or acted on: the PC's questions, loop prompts, reminders, assist
 *   launch and the wake word wait (`appUnlockedNow`, `whenAppUnlocked`), and
 *   notifications say only that there is something (`privateNotice`).
 * - Only salted PBKDF2-HMAC-SHA256 hashes are kept (pinHash.ts), in the
 *   app's key store (Android Keystore; Windows Credential Manager / the
 *   Linux key store on the PC). Never a PIN.
 * - The record always holds two hashes: the app PIN's and a second one,
 *   which is the erase PIN's when it is set and a random one otherwise.
 *   Every try computes both, in the same way, and compares both in
 *   constant time; only then is the answer picked. So the time a try takes
 *   doesn't tell which PIN was entered, or whether an erase PIN exists.
 * - Wrong tries, waits and fingerprint: the same code as the Home PC PIN
 *   (pinLock/pinCore.ts). During a wait no PIN is checked at all: neither
 *   the app PIN nor the erase PIN.
 * - The erase PIN, entered wherever the app PIN is asked, erases everything
 *   the app keeps (appErase.ts) at once, without asking; the app then
 *   starts as new. Nothing is sent to paired devices.
 * - Nothing here is reachable by the model: no tool, prompt, sync or report
 *   uses this file (securityRules.test.ts).
 */
import {AppState, Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';

import {PIN_ITERATIONS, toHex} from '../homeLink/pinHash';
import {
  cleanMinutes,
  countedTry,
  DEFAULT_AWAY_MINUTES,
  fingerprintHere,
  fingerSecretMatches,
  forgetMeasured,
  hashPin,
  makeSerial,
  pinMatches,
  randomBytes,
  resetFinger,
  storeFingerSecret,
  type PinAnswer,
} from '../pinLock/pinCore';
import {eraseAvailable, eraseEverything} from './appErase';

export {
  AWAY_MINUTES_CHOICES,
  DEFAULT_AWAY_MINUTES,
  fingerprintAvailable,
  type PinAnswer,
} from '../pinLock/pinCore';
export {eraseAvailable} from './appErase';

export const APP_PIN_PATTERN = /^\d{4,16}$/;

export const FORGOT_APP_PIN =
  "The PIN can't be shown or reset. The only way back in is to start the app as new, without its chats and settings: on the phone, clear PocketAgent's storage in Android's settings (Apps → PocketAgent → Storage) or reinstall it; on the PC, uninstall DesktopAgent and remove its app folders.";

const USER = 'app-lock-v1';
const LOCK_SERVICE = 'pocketagent-app-lock';
const FINGER_SERVICE = 'pocketagent-app-lock-finger';
const FINGER_TITLE = 'Unlock PocketAgent';
const WAIT_KEY = 'app';

interface Slot {
  /** Hex salt (16 random bytes) and PBKDF2-HMAC-SHA256 hash. */
  salt: string;
  hash: string;
}

export interface AppLockRecord {
  v: 1;
  rounds: number;
  /** The app PIN. */
  a: Slot;
  /** The erase PIN when `erase`, else a random hash nothing matches. */
  b: Slot;
  erase: boolean;
  awayMinutes: number;
  fails: number;
  waitUntil: number;
  waitMs: number;
  waitFrom: number;
  waitLeft?: number;
  /** SHA-256 (hex) of the fingerprint-guarded secret, when switched on. */
  finger?: string;
}

// ---- Stored record ------------------------------------------------------

/** undefined: not read yet. null: no PIN. */
let cache: AppLockRecord | null | undefined;

const isSlot = (x: any) =>
  x && /^[0-9a-f]{32}$/.test(x.salt) && /^[0-9a-f]{64}$/.test(x.hash);

function parseRecord(text: string): AppLockRecord {
  const r = JSON.parse(text);
  const num = (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0;
  if (
    !r ||
    r.v !== 1 ||
    !Number.isSafeInteger(r.rounds) ||
    r.rounds < 1 ||
    !isSlot(r.a) ||
    !isSlot(r.b) ||
    typeof r.erase !== 'boolean' ||
    !num(r.awayMinutes) ||
    !num(r.fails) ||
    !num(r.waitUntil) ||
    !num(r.waitMs) ||
    !num(r.waitFrom) ||
    (r.waitLeft !== undefined && !num(r.waitLeft)) ||
    (r.finger !== undefined && !/^[0-9a-f]{64}$/.test(r.finger))
  ) {
    throw new Error('broken app lock record');
  }
  return r;
}

/** Throws when the key store can't be read or holds a broken record. */
async function load(): Promise<AppLockRecord | null> {
  if (cache !== undefined) {
    return cache;
  }
  const found = await Keychain.getGenericPassword({service: LOCK_SERVICE});
  const record =
    found && found.username === USER ? parseRecord(found.password) : null;
  cache = record;
  return record;
}

async function save(record: AppLockRecord): Promise<void> {
  await Keychain.setGenericPassword(USER, JSON.stringify(record), {
    service: LOCK_SERVICE,
  });
  cache = {...record};
}

const serial = makeSerial();
const one = <T>(job: () => Promise<T>) => serial('app', job);

// ---- Locked or not (memory only) -----------------------------------------

/**
 * 'unknown' until the start screen read the key store (AppLockRoot does
 * that before the app's code loads); 'error' when it couldn't (locked).
 */
type State = 'unknown' | 'off' | 'locked' | 'unlocked' | 'error';
let state: State = 'unknown';
let awaySince: number | null = null;
let listening = false;
let awayPoll: ReturnType<typeof setInterval> | undefined;

type Listener = (locked: boolean) => void;
const listeners = new Set<Listener>();
const waiters: (() => void)[] = [];

const awayMs = () => (cache?.awayMinutes ?? DEFAULT_AWAY_MINUTES) * 60 * 1000;

function setState(next: State) {
  state = next;
  const locked = isLockedState();
  listeners.forEach(l => l(locked));
  if (!locked) {
    waiters.splice(0).forEach(w => w());
  }
}

const isLockedState = () => state === 'locked' || state === 'error';

/**
 * Whether the app may show and do things now: no PIN, or unlocked and not
 * away for longer than the chosen minutes. ('unknown' only before the
 * start screen ran, when none of the app's own code is loaded yet.)
 */
export function appUnlockedNow(now = Date.now()): boolean {
  if (state === 'off' || state === 'unknown') {
    return true;
  }
  if (state !== 'unlocked') {
    return false;
  }
  return !(awaySince !== null && now - awaySince > awayMs());
}

/** Whether an app PIN is on (as last read). */
export function appLockOn(): boolean {
  return !!cache;
}

/** Resolves once the app is unlocked (at once with no PIN). */
export async function whenAppUnlocked(): Promise<void> {
  if (state === 'unknown') {
    await loadAppLock();
  }
  if (appUnlockedNow()) {
    return;
  }
  await new Promise<void>(resolve => waiters.push(resolve));
}

/** The lock screen (AppLockRoot) listens here: true while locked. */
export function subscribeAppLock(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the app is locked now (for the start screen). */
export function appLockedNow(): boolean {
  return isLockedState();
}

/**
 * The app went to the background (phone) or was minimised / hidden in the
 * tray (PC), or came back. Back after longer than the chosen minutes:
 * locked again.
 */
export function noteAppAway(away: boolean, now = Date.now()): void {
  if (away) {
    if (awaySince === null) {
      awaySince = now;
    }
    return;
  }
  if (awaySince === null) {
    return;
  }
  const gone = now - awaySince;
  awaySince = null;
  if (state === 'unlocked' && cache && gone > awayMs()) {
    setState('locked');
  }
}

/** Desktop: minimised or hidden in the tray (the window's own answer). */
async function desktopHidden(): Promise<boolean | null> {
  const tauri = (globalThis as any).__TAURI_INTERNALS__;
  if (!tauri?.invoke) {
    return null;
  }
  try {
    const [minimized, visible] = await Promise.all([
      tauri.invoke('plugin:window|is_minimized', {label: 'main'}),
      tauri.invoke('plugin:window|is_visible', {label: 'main'}),
    ]);
    return minimized === true || visible === false;
  } catch {
    return null;
  }
}

function listen() {
  if (listening) {
    return;
  }
  listening = true;
  try {
    AppState.addEventListener('change', s => noteAppAway(s !== 'active'));
  } catch {}
  // The PC: the page isn't always told when its window is minimised or
  // hidden in the tray, so the window is asked too.
  if (Platform.OS === 'web' && (globalThis as any).__TAURI_INTERNALS__) {
    awayPoll = setInterval(() => {
      desktopHidden().then(hidden => {
        if (hidden === true) {
          noteAppAway(true);
        } else if (hidden === false && AppState.currentState === 'active') {
          noteAppAway(false);
        }
      });
    }, 5000);
  }
}

/**
 * At start, before the app's code loads: reads the PIN setting. 'off' (no
 * PIN), 'locked', or 'error' (couldn't be read: stays locked; the screen
 * offers to try again).
 */
export async function loadAppLock(): Promise<'off' | 'locked' | 'error'> {
  listen();
  try {
    const record = await load();
    if (!record) {
      setState('off');
      return 'off';
    }
    if (state !== 'unlocked') {
      setState('locked');
    }
    return 'locked';
  } catch {
    cache = undefined;
    setState('error');
    return 'error';
  }
}

// ---- Checking a PIN -------------------------------------------------------

type Which = 'app' | 'erase';

/**
 * One counted try: both hashes are always computed and compared (same
 * work, constant-time compares) before the answer is picked.
 */
async function checkAppPin(
  pin: string,
  now: () => number,
): Promise<
  | {ok: true; match: Which | 'none'; record?: AppLockRecord}
  | Exclude<PinAnswer, {ok: true}>
> {
  let record: AppLockRecord | null;
  try {
    record = await load();
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: "Couldn't read the PIN setting; try again",
    };
  }
  if (!record) {
    return {ok: true, match: 'none'};
  }
  const r = record;
  const answer = await countedTry<AppLockRecord, Which>(
    WAIT_KEY,
    r,
    now,
    save,
    async () => {
      const shape = APP_PIN_PATTERN.test(pin);
      const isA = await pinMatches(pin, r.a.salt, r.a.hash, r.rounds);
      const isB = await pinMatches(pin, r.b.salt, r.b.hash, r.rounds);
      if (!shape) {
        return null;
      }
      if (isA) {
        return 'app';
      }
      return isB && r.erase ? 'erase' : null;
    },
  );
  if (!answer.ok) {
    return answer;
  }
  return {ok: true, match: answer.match, record: answer.record};
}

/** The erase PIN was entered: erase now, without asking. */
async function eraseNow(): Promise<PinAnswer> {
  cache = undefined;
  if (await eraseEverything()) {
    // The app is closed (phone) or restarts as new (PC); nothing to say.
    return {ok: false, reason: 'error', message: 'Checking…'};
  }
  // Couldn't erase here: looks like any wrong PIN.
  return {ok: false, reason: 'wrong', message: 'Wrong PIN.'};
}

/** The lock screen's Unlock. */
export function tryAppPin(
  pin: string,
  now: () => number = Date.now,
): Promise<PinAnswer> {
  return one(async () => {
    const answer = await checkAppPin(pin, now);
    if (!answer.ok) {
      return answer;
    }
    if (answer.match === 'erase') {
      return eraseNow();
    }
    setState(answer.match === 'none' ? 'off' : 'unlocked');
    return {ok: true};
  });
}

/** The lock screen's fingerprint button (never the erase). */
export function tryAppFingerprint(): Promise<PinAnswer> {
  return one(async () => {
    let record: AppLockRecord | null = null;
    try {
      record = await load();
    } catch {}
    if (!record?.finger || !fingerprintHere()) {
      return {
        ok: false,
        reason: 'error',
        message: 'Fingerprint is not on; use the PIN.',
      };
    }
    if (
      await fingerSecretMatches(
        FINGER_SERVICE,
        USER,
        FINGER_TITLE,
        record.finger,
      )
    ) {
      setState('unlocked');
      return {ok: true};
    }
    return {
      ok: false,
      reason: 'error',
      message: 'Fingerprint not accepted; use the PIN.',
    };
  });
}

/** Whether the lock screen offers the fingerprint. */
export function appFingerprintOn(): boolean {
  return !!cache?.finger && fingerprintHere();
}

// ---- Turning it on, changing it, off --------------------------------------

async function slot(pin: string, rounds: number): Promise<Slot> {
  const salt = randomBytes(16);
  return {salt: toHex(salt), hash: toHex(await hashPin(pin, salt, rounds))};
}

/** A random hash in the second slot: the same work, nothing matches it. */
async function filler(rounds: number): Promise<Slot> {
  return slot(toHex(randomBytes(32)), rounds);
}

export async function appLockSettings(): Promise<{
  on: boolean;
  awayMinutes: number;
  fingerprint: boolean;
  erase: boolean;
}> {
  try {
    const r = await load();
    return {
      on: !!r,
      awayMinutes: r?.awayMinutes ?? DEFAULT_AWAY_MINUTES,
      fingerprint: !!r?.finger,
      erase: !!r?.erase,
    };
  } catch {
    return {
      on: false,
      awayMinutes: DEFAULT_AWAY_MINUTES,
      fingerprint: false,
      erase: false,
    };
  }
}

/** Turns the app PIN on (Settings). */
export function turnOnAppPin(
  pin: string,
  awayMinutes = DEFAULT_AWAY_MINUTES,
): Promise<{ok: boolean; error?: string}> {
  return one(async () => {
    if (!APP_PIN_PATTERN.test(pin)) {
      return {ok: false, error: 'The PIN must be 4 to 16 digits.'};
    }
    try {
      if (await load()) {
        return {ok: false, error: 'A PIN is already set.'};
      }
      await save({
        v: 1,
        rounds: PIN_ITERATIONS,
        a: await slot(pin, PIN_ITERATIONS),
        b: await filler(PIN_ITERATIONS),
        erase: false,
        awayMinutes: cleanMinutes(awayMinutes),
        fails: 0,
        waitUntil: 0,
        waitMs: 0,
        waitFrom: 0,
      });
      listen();
      // The user just typed it: no need to ask again now.
      setState('unlocked');
      return {ok: true};
    } catch (e) {
      cache = undefined;
      return {ok: false, error: `Couldn't save the PIN: ${String(e)}`};
    }
  });
}

export interface AppLockChange {
  off?: boolean;
  newPin?: string;
  awayMinutes?: number;
  fingerprint?: boolean;
  /** A new erase PIN, or null to remove it. */
  erasePin?: string | null;
}

/**
 * Changes the app lock: off, a new PIN, the minutes, fingerprint, the
 * erase PIN. Always needs the current PIN, counted like any try (and the
 * erase PIN entered here erases, as anywhere the PIN is asked).
 */
export function changeAppLock(
  currentPin: string,
  change: AppLockChange,
  now: () => number = Date.now,
): Promise<PinAnswer> {
  return one(async () => {
    for (const p of [change.newPin, change.erasePin]) {
      if (typeof p === 'string' && !APP_PIN_PATTERN.test(p)) {
        return {
          ok: false,
          reason: 'error',
          message: 'A PIN must be 4 to 16 digits.',
        };
      }
    }
    const answer = await checkAppPin(currentPin, now);
    if (!answer.ok) {
      return answer;
    }
    if (answer.match === 'erase') {
      return eraseNow();
    }
    const record = answer.record;
    if (!record) {
      return {ok: true};
    }
    try {
      if (change.off) {
        await Keychain.resetGenericPassword({service: LOCK_SERVICE});
        await resetFinger(FINGER_SERVICE);
        cache = null;
        setState('off');
        return {ok: true};
      }
      const next: AppLockRecord = {...record};
      const appPin = change.newPin ?? currentPin;
      if (change.newPin !== undefined) {
        // Not the erase PIN that stays.
        if (
          change.erasePin === undefined &&
          next.erase &&
          (await pinMatches(
            change.newPin,
            next.b.salt,
            next.b.hash,
            next.rounds,
          ))
        ) {
          return {
            ok: false,
            reason: 'error',
            message: 'The app PIN and the erase PIN must differ.',
          };
        }
      }
      if (typeof change.erasePin === 'string') {
        if (!eraseAvailable()) {
          return {
            ok: false,
            reason: 'error',
            message: 'The erase PIN is not available on this device.',
          };
        }
        if (change.erasePin === appPin) {
          return {
            ok: false,
            reason: 'error',
            message: 'The app PIN and the erase PIN must differ.',
          };
        }
      }
      // Both hashes keep the record's rounds (same work for each).
      if (change.newPin !== undefined) {
        next.a = await slot(change.newPin, next.rounds);
      }
      if (typeof change.erasePin === 'string') {
        next.b = await slot(change.erasePin, next.rounds);
        next.erase = true;
      } else if (change.erasePin === null) {
        next.b = await filler(next.rounds);
        next.erase = false;
      }
      if (change.awayMinutes !== undefined) {
        next.awayMinutes = cleanMinutes(change.awayMinutes);
      }
      if (change.fingerprint === true) {
        next.finger = await storeFingerSecret(
          FINGER_SERVICE,
          USER,
          FINGER_TITLE,
        );
      } else if (change.fingerprint === false) {
        delete next.finger;
        await resetFinger(FINGER_SERVICE);
      }
      await save(next);
      setState('unlocked');
      return {ok: true};
    } catch (e) {
      cache = undefined;
      return {
        ok: false,
        reason: 'error',
        message: `Not changed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });
}

// ---- Notifications ---------------------------------------------------------

/**
 * What a notification may say: with the app PIN on, only that there is
 * something (no loop names, reminder text or chat words).
 */
export function privateNotice(
  title: string,
  body: string,
): {title: string; body: string} {
  if (!cache) {
    return {title, body};
  }
  return {title: 'PocketAgent', body: 'Open PocketAgent to see it.'};
}

/** Tests only. */
export function resetAppLockForTests(): void {
  cache = undefined;
  serial.clear();
  state = 'unknown';
  awaySince = null;
  listening = false;
  if (awayPoll) {
    clearInterval(awayPoll);
  }
  awayPoll = undefined;
  listeners.clear();
  waiters.splice(0);
  forgetMeasured(WAIT_KEY);
}
