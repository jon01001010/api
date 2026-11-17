/**
 * What the app's two PINs share: the Home PC PIN (homeLink/homePcLock.ts)
 * and the app PIN with its erase PIN (appLock/appLock.ts).
 *
 * - Wrong tries: 5, then a 5-minute wait that doubles with each further 5
 *   (at most a day). The count is written before each check, so stopping
 *   the app mid-check gives no free try, and it is kept in the key store,
 *   so a restart doesn't reset it.
 * - The wait left is kept (not only its end time), and it counts down only
 *   by time the app measured itself with a clock that can't be set
 *   (performance.now, while the app runs), never more than the wall clock
 *   moved: setting the date forward (or back) doesn't shorten it, and a
 *   restart doesn't count as waiting.
 * - Fingerprint (Android only): a random secret in the Android Keystore
 *   under a key that opens only after the system's fingerprint check
 *   (react-native-keychain BIOMETRY_CURRENT_SET, androidx.biometric; no
 *   Google Play services). Adding a fingerprint to the phone invalidates it.
 *   The PIN always still works.
 */
import 'react-native-get-random-values';
import {Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';

import {
  fromHex,
  pbkdf2Sha256Async,
  sameBytes,
  sha256,
  toHex,
  utf8,
} from '../homeLink/pinHash';

export const TRIES_BEFORE_WAIT = 5;
export const FIRST_WAIT_MS = 5 * 60 * 1000;
export const LONGEST_WAIT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AWAY_MINUTES = 5;
export const AWAY_MINUTES_CHOICES = [1, 5, 15, 30, 60];

/** Said with every wait: only time with the app open counts. */
export const WAIT_NOTE = '(the wait counts down while PocketAgent is open)';

/** The wait after `fails` wrong tries (0 while tries are left). */
export function waitAfter(fails: number): number {
  if (fails <= 0 || fails % TRIES_BEFORE_WAIT !== 0) {
    return 0;
  }
  const round = fails / TRIES_BEFORE_WAIT - 1;
  return Math.min(LONGEST_WAIT_MS, FIRST_WAIT_MS * 2 ** Math.min(round, 20));
}

export function describeWait(until: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((until - now) / 60000));
  if (minutes >= 120) {
    return `about ${Math.round(minutes / 60)} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export const cleanMinutes = (m: number) =>
  Number.isFinite(m) ? Math.min(24 * 60, Math.max(1, Math.round(m))) : 5;

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function hashPin(
  pin: string,
  salt: Uint8Array,
  rounds: number,
): Promise<Uint8Array> {
  return pbkdf2Sha256Async(utf8(pin), salt, rounds);
}

/** One change at a time per key (two quick taps can't both count once). */
export function makeSerial() {
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const before = queues.get(key) ?? Promise.resolve();
    const run = before.then(job, job);
    queues.set(
      key,
      run.catch(() => {}),
    );
    return run;
  };
  serial.clear = () => queues.clear();
  return serial;
}

// ---- Waiting: time the app measured itself --------------------------------

/** The try count and wait, as kept in a lock record. */
export interface WaitState {
  /** Wrong tries in a row (kept across restarts). */
  fails: number;
  /** No PIN is checked before this time (ms); 0 = no wait. */
  waitUntil: number;
  /** How long the current wait is, and when it started (clock checks). */
  waitMs: number;
  waitFrom: number;
  /**
   * The wait still left (ms) when it was last measured; it goes down only
   * by time the app measured itself (see `waitLeftNow`). Missing in records
   * from before: worked out from `waitUntil` once.
   */
  waitLeft?: number;
}

/** A clock that can't be set (ms; NaN when there is none). */
type Mono = () => number;
const defaultMono: Mono = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : NaN;
let monoClock: Mono = defaultMono;

/** When each lock's wait was last measured, in this run of the app. */
const measured = new Map<string, {wall: number; mono: number}>();

/**
 * The wait left now. It goes down by the time since it was last measured
 * in this run of the app: the smaller of the wall clock's and the
 * monotonic clock's, so moving the date (either way) doesn't count. After
 * a restart nothing has been measured yet: the wait left stays as saved,
 * and counts down from now. Without a monotonic clock: the wall clock,
 * never backwards.
 */
export function waitLeftNow(key: string, r: WaitState, now: number): number {
  let left =
    r.waitLeft ??
    (r.waitUntil > 0
      ? // A record from before: what its end time says, at most its length.
        Math.min(r.waitMs || LONGEST_WAIT_MS, Math.max(0, r.waitUntil - now))
      : 0);
  const mono = monoClock();
  const last = measured.get(key);
  if (left > 0 && last) {
    const wall = Math.max(0, now - last.wall);
    const ran = Number.isFinite(mono - last.mono)
      ? Math.max(0, Math.min(wall, mono - last.mono))
      : wall;
    left = Math.max(0, left - ran);
  }
  measured.set(key, {wall: now, mono});
  return left;
}

/** Tests only: the clock that can't be set. */
export function setMonotonicClockForTests(clock?: Mono): void {
  monoClock = clock ?? defaultMono;
}

/** Forgets what was measured for keys starting with `prefix` (restart). */
export function forgetMeasured(prefix: string): void {
  for (const key of [...measured.keys()]) {
    if (key.startsWith(prefix)) {
      measured.delete(key);
    }
  }
}

export type PinAnswer =
  | {ok: true}
  | {
      ok: false;
      reason: 'wrong' | 'wait' | 'error';
      message: string;
      /** Tries left before a wait (wrong), or when the wait ends (wait). */
      triesLeft?: number;
      waitUntil?: number;
    };

/**
 * One counted try against a lock record: refused during a wait (before any
 * hashing), else counted as wrong before `check` runs, and reset when
 * `check` says the PIN was right (any non-null answer). `save` writes the
 * record to the key store.
 */
export async function countedTry<R extends WaitState, M>(
  key: string,
  record: R,
  now: () => number,
  save: (r: R) => Promise<void>,
  check: () => Promise<M | null>,
): Promise<
  | {ok: true; match: M; record: R}
  | (Exclude<PinAnswer, {ok: true}> & {record?: undefined})
> {
  const r = {...record};
  const waitLeft = waitLeftNow(key, r, now());
  if (waitLeft !== (r.waitLeft ?? 0) || (!waitLeft && r.waitUntil > 0)) {
    r.waitLeft = waitLeft;
    r.waitUntil = waitLeft ? now() + waitLeft : 0;
    await save(r);
  } else if (waitLeft) {
    r.waitUntil = now() + waitLeft;
  }
  if (waitLeft > 0) {
    return {
      ok: false,
      reason: 'wait',
      waitUntil: r.waitUntil,
      message: `Too many wrong PINs. Try again in ${describeWait(r.waitUntil, now())} ${WAIT_NOTE}.`,
    };
  }
  // Counted as wrong before the check, so stopping the app mid-check
  // doesn't give a free try; a right PIN resets it.
  r.fails += 1;
  await save(r);
  const match = await check();
  if (match !== null) {
    r.fails = 0;
    r.waitUntil = 0;
    r.waitMs = 0;
    r.waitFrom = 0;
    r.waitLeft = 0;
    await save(r);
    return {ok: true, match, record: r};
  }
  const wait = waitAfter(r.fails);
  if (wait) {
    r.waitMs = wait;
    r.waitFrom = now();
    r.waitUntil = r.waitFrom + wait;
    r.waitLeft = wait;
    measured.set(key, {wall: now(), mono: monoClock()});
    await save(r);
    return {
      ok: false,
      reason: 'wait',
      waitUntil: r.waitUntil,
      message: `Wrong PIN. Too many wrong PINs: try again in ${describeWait(r.waitUntil, now())} ${WAIT_NOTE}.`,
    };
  }
  const left = TRIES_BEFORE_WAIT - (r.fails % TRIES_BEFORE_WAIT);
  return {
    ok: false,
    reason: 'wrong',
    triesLeft: left,
    message: `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before a wait.`,
  };
}

/** Whether a stored hash (hex) matches this PIN (constant-time compare). */
export async function pinMatches(
  pin: string,
  saltHex: string,
  hashHex: string,
  rounds: number,
): Promise<boolean> {
  const hash = await hashPin(pin, fromHex(saltHex), rounds);
  return sameBytes(hash, fromHex(hashHex));
}

// ---- Fingerprint (Android only) --------------------------------------------

/** Not on the desktop (its key store has no fingerprint check). */
export function fingerprintHere(): boolean {
  return (
    Platform.OS === 'android' &&
    typeof (Keychain as any).getSupportedBiometryType === 'function'
  );
}

export async function fingerprintAvailable(): Promise<boolean> {
  if (!fingerprintHere()) {
    return false;
  }
  try {
    return !!(await Keychain.getSupportedBiometryType());
  } catch {
    return false;
  }
}

const fingerOptions = (title: string) => ({
  accessControl: Keychain.ACCESS_CONTROL?.BIOMETRY_CURRENT_SET,
  storage: Keychain.STORAGE_TYPE?.AES_GCM,
  authenticationPrompt: {
    title,
    cancel: 'Use the PIN',
  },
});

/**
 * Makes a new fingerprint-guarded secret; returns its SHA-256 (hex), which
 * the lock record keeps to check it later.
 */
export async function storeFingerSecret(
  service: string,
  user: string,
  title: string,
): Promise<string> {
  if (!(await fingerprintAvailable())) {
    throw new Error('No fingerprint is set up on this device');
  }
  const secret = toHex(randomBytes(32));
  const saved = await Keychain.setGenericPassword(user, secret, {
    service,
    ...fingerOptions(title),
  });
  if (!saved) {
    throw new Error('The fingerprint key could not be made');
  }
  return toHex(sha256(utf8(secret)));
}

/**
 * Asks for the fingerprint (Android's own prompt) and checks the secret
 * against the record's hash. False when cancelled, refused, or the key was
 * invalidated by a new fingerprint.
 */
export async function fingerSecretMatches(
  service: string,
  user: string,
  title: string,
  expectedHex: string,
): Promise<boolean> {
  try {
    const found = await Keychain.getGenericPassword({
      service,
      ...fingerOptions(title),
    });
    return (
      !!found &&
      found.username === user &&
      sameBytes(sha256(utf8(found.password)), fromHex(expectedHex))
    );
  } catch {
    // Cancelled, too many tries (Android's own limit), or invalidated.
    return false;
  }
}

export async function resetFinger(service: string): Promise<void> {
  try {
    await Keychain.resetGenericPassword({service});
  } catch {}
}

export {toHex};
