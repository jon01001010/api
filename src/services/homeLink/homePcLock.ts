/**
 * Optional PIN (and, on Android, fingerprint) before a paired Home PC is
 * used from this device (TODO "Stolen, unlocked phone"). Off by default; set
 * per PC in its server sheet.
 *
 * - Only a salted PBKDF2 hash of the PIN is kept (pinHash.ts), in the app's
 *   key store (react-native-keychain: the Android Keystore; on the desktop
 *   Windows Credential Manager / the Linux secret file), like servers' API
 *   keys. Never the PIN itself.
 * - While the lock is on, every request of the home link (homeLink.ts `ask`:
 *   status, start model, tunnel, sync, questions, answers, pictures) is
 *   refused until the PIN was entered (`homePcGate`). The things a user does
 *   (a chat message, Load, Sync now, a picture, answering a question) ask
 *   for the PIN first (`unlockHomePc`); things the app does by itself (model
 *   lists at start, question polling, mirroring after a reply) are just
 *   refused while locked. The local tunnel is closed when the lock comes
 *   back, so nothing reaches the PC through an open port either.
 * - Unlocked lasts until the app was in the background for more than the
 *   chosen minutes (default 5), and never past a restart of the app.
 * - Wrong PIN: 5 tries, then a 5-minute wait, doubling with each further 5
 *   wrong tries (at most a day). The count and the wait are kept in the key
 *   store too, so a restart doesn't reset them. The wait left is kept (not
 *   only its end time), and it counts down only by time the app measured
 *   itself with a clock that can't be set (performance.now, while the app
 *   runs), never more than the wall clock moved: setting the date forward
 *   (or back) doesn't shorten it, and a restart doesn't count as waiting.
 * - Forgot the PIN: the only way back is to pair again, which the PC must
 *   approve (FORGOT_PIN). Pairing again clears the old lock.
 */
import 'react-native-get-random-values';
import {AppState, Platform} from 'react-native';
import * as Keychain from 'react-native-keychain';

import {
  fromHex,
  pbkdf2Sha256Async,
  PIN_ITERATIONS,
  sameBytes,
  sha256,
  toHex,
  utf8,
} from './pinHash';

export const PIN_PATTERN = /^\d{4,8}$/;
export const TRIES_BEFORE_WAIT = 5;
export const FIRST_WAIT_MS = 5 * 60 * 1000;
export const LONGEST_WAIT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_AWAY_MINUTES = 5;
export const AWAY_MINUTES_CHOICES = [1, 5, 15, 30, 60];

export const LOCKED =
  "This PC is locked on this device: enter its PIN to use it (it's asked when you use the PC)";

export const FORGOT_PIN =
  "The PIN can't be shown or reset here. The only way back is to pair again, which your PC must approve:\n\n1. On your PC: Settings → Use this PC's model from your phone → remove this device.\n2. Here: open the Home PC server and remove it.\n3. Pair again with a new code from the PC (the PC asks before it pairs; after removing a device it waits an hour before that device can pair again).\n\nPairing again clears the old PIN.";

const USER = 'homepc-lock-v1';
const lockService = (pc: string) => `pocketagent-homepc-lock-${pc}`;
const fingerService = (pc: string) => `pocketagent-homepc-finger-${pc}`;

export interface LockRecord {
  v: 1;
  /** Hex salt (16 random bytes) and PBKDF2-HMAC-SHA256 hash of the PIN. */
  salt: string;
  hash: string;
  rounds: number;
  awayMinutes: number;
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
  /** SHA-256 (hex) of the fingerprint-guarded secret, when switched on. */
  finger?: string;
}

// ---- Stored record ------------------------------------------------------

const cache = new Map<string, LockRecord | null>();

function parseRecord(text: string): LockRecord {
  const r = JSON.parse(text);
  const num = (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0;
  if (
    !r ||
    r.v !== 1 ||
    !/^[0-9a-f]{32}$/.test(r.salt) ||
    !/^[0-9a-f]{64}$/.test(r.hash) ||
    !Number.isSafeInteger(r.rounds) ||
    r.rounds < 1 ||
    !num(r.awayMinutes) ||
    !num(r.fails) ||
    !num(r.waitUntil) ||
    !num(r.waitMs) ||
    !num(r.waitFrom) ||
    (r.waitLeft !== undefined && !num(r.waitLeft)) ||
    (r.finger !== undefined && !/^[0-9a-f]{64}$/.test(r.finger))
  ) {
    throw new Error('broken lock record');
  }
  return r;
}

/**
 * This PC's lock, or null when none is set. Throws when the key store
 * can't be read, or holds a broken record: callers then refuse (a lock that
 * can't be read is not taken as "no lock").
 */
async function load(pc: string): Promise<LockRecord | null> {
  if (cache.has(pc)) {
    return cache.get(pc)!;
  }
  const found = await Keychain.getGenericPassword({service: lockService(pc)});
  // Only our own entry counts (written with USER); nothing else is there.
  const record =
    found && found.username === USER ? parseRecord(found.password) : null;
  cache.set(pc, record);
  return record;
}

async function save(pc: string, record: LockRecord): Promise<void> {
  await Keychain.setGenericPassword(USER, JSON.stringify(record), {
    service: lockService(pc),
  });
  cache.set(pc, {...record});
}

/** One change at a time per PC (two quick taps can't both count once). */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(pc: string, job: () => Promise<T>): Promise<T> {
  const before = queues.get(pc) ?? Promise.resolve();
  const run = before.then(job, job);
  queues.set(
    pc,
    run.catch(() => {}),
  );
  return run;
}

// ---- Unlocked state (memory only) --------------------------------------

const unlocked = new Set<string>();
let awaySince: number | null = null;
let listening = false;

const awayMs = (pc: string) =>
  (cache.get(pc)?.awayMinutes ?? DEFAULT_AWAY_MINUTES) * 60 * 1000;

/** Whether this PC is unlocked right now (memory only). */
export function unlockedNow(pc: string, now = Date.now()): boolean {
  if (!unlocked.has(pc)) {
    return false;
  }
  return !(awaySince !== null && now - awaySince > awayMs(pc));
}

/**
 * The app went to the background or came back. Back after longer than a
 * PC's chosen minutes: that PC is locked again and the tunnel is closed.
 */
export function noteAppState(state: string, now = Date.now()): void {
  if (state !== 'active') {
    if (awaySince === null) {
      awaySince = now;
    }
    return;
  }
  if (awaySince === null) {
    return;
  }
  const away = now - awaySince;
  awaySince = null;
  let relocked = false;
  for (const pc of [...unlocked]) {
    if (away > awayMs(pc)) {
      unlocked.delete(pc);
      relocked = true;
    }
  }
  if (relocked) {
    closeLinkTunnel();
  }
}

function closeLinkTunnel() {
  try {
    // Lazy: homeLink.ts uses this file for its gate.
    require('./homeLink')
      .closeTunnel()
      .catch(() => {});
  } catch {}
}

function listen() {
  if (listening) {
    return;
  }
  listening = true;
  AppState.addEventListener('change', state => noteAppState(state));
}

function markUnlocked(pc: string) {
  listen();
  unlocked.add(pc);
}

// ---- The gate -----------------------------------------------------------

export type Gate = {ok: true} | {ok: false; locked: boolean; error: string};

/** Whether a PIN is set for this PC (false when it can't be read). */
export async function homePcLockOn(pc: string): Promise<boolean> {
  try {
    return !!(await load(pc));
  } catch {
    return false;
  }
}

/** The PC's chosen minutes and fingerprint choice (for the settings). */
export async function homePcLockSettings(
  pc: string,
): Promise<{on: boolean; awayMinutes: number; fingerprint: boolean}> {
  try {
    const r = await load(pc);
    return {
      on: !!r,
      awayMinutes: r?.awayMinutes ?? DEFAULT_AWAY_MINUTES,
      fingerprint: !!r?.finger,
    };
  } catch {
    return {on: false, awayMinutes: DEFAULT_AWAY_MINUTES, fingerprint: false};
  }
}

/**
 * Every home link request passes here first: no PIN set, or unlocked, or
 * refused. Asks nothing (see unlockHomePc).
 */
export async function homePcGate(pc: string): Promise<Gate> {
  let record: LockRecord | null;
  try {
    record = await load(pc);
  } catch {
    return {
      ok: false,
      locked: false,
      error: "Couldn't read this PC's PIN setting on this device; try again",
    };
  }
  if (!record || unlockedNow(pc)) {
    return {ok: true};
  }
  return {ok: false, locked: true, error: LOCKED};
}

// ---- Asking for the PIN --------------------------------------------------

export interface PinRequest {
  pc: string;
  fingerprint: boolean;
}

type Listener = (request: PinRequest | null) => void;
const listeners = new Set<Listener>();
const waiting: {request: PinRequest; done: (ok: boolean) => void}[] = [];
const pending = new Map<string, Promise<boolean>>();

const showFirst = () => {
  const first = waiting[0]?.request ?? null;
  listeners.forEach(l => l(first));
};

/** The PIN window (HomePcPinPrompt) listens here. */
export function subscribePinRequests(listener: Listener): () => void {
  listeners.add(listener);
  listener(waiting[0]?.request ?? null);
  return () => {
    listeners.delete(listener);
  };
}

function finish(pc: string, ok: boolean) {
  const i = waiting.findIndex(w => w.request.pc === pc);
  if (i >= 0) {
    const [entry] = waiting.splice(i, 1);
    entry.done(ok);
  }
  showFirst();
}

/** Cancel on the PIN window: the use that asked is refused. */
export function cancelPinRequest(pc: string): void {
  finish(pc, false);
}

/**
 * Before something the user does with the PC: unlocked (or no PIN) at
 * once; otherwise the PIN window opens and this waits for it. False when
 * cancelled, or when there is no window to ask in.
 */
export async function unlockHomePc(pc: string): Promise<boolean> {
  const gate = await homePcGate(pc);
  if (gate.ok) {
    return true;
  }
  if (!gate.locked || listeners.size === 0) {
    return false;
  }
  const already = pending.get(pc);
  if (already) {
    return already;
  }
  const record = cache.get(pc);
  const asked = new Promise<boolean>(resolve => {
    waiting.push({
      request: {pc, fingerprint: !!record?.finger && fingerprintHere()},
      done: resolve,
    });
  }).finally(() => pending.delete(pc));
  pending.set(pc, asked);
  showFirst();
  return asked;
}

// ---- Checking a PIN -------------------------------------------------------

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

async function hashPin(
  pin: string,
  salt: Uint8Array,
  rounds: number,
): Promise<Uint8Array> {
  return pbkdf2Sha256Async(utf8(pin), salt, rounds);
}

// ---- Waiting: time the app measured itself --------------------------------

/** Said with every wait: only time with the app open counts. */
export const WAIT_NOTE = '(the wait counts down while PocketAgent is open)';

/** A clock that can't be set (ms; NaN when there is none). */
type Mono = () => number;
const defaultMono: Mono = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : NaN;
let monoClock: Mono = defaultMono;

/** When each PC's wait was last measured, in this run of the app. */
const measured = new Map<string, {wall: number; mono: number}>();

/**
 * The wait left now. It goes down by the time since it was last measured
 * in this run of the app: the smaller of the wall clock's and the
 * monotonic clock's, so moving the date (either way) doesn't count. After
 * a restart nothing has been measured yet: the wait left stays as saved,
 * and counts down from now. Without a monotonic clock: the wall clock,
 * never backwards.
 */
function waitLeftNow(pc: string, r: LockRecord, now: number): number {
  let left =
    r.waitLeft ??
    (r.waitUntil > 0
      ? // A record from before: what its end time says, at most its length.
        Math.min(r.waitMs || LONGEST_WAIT_MS, Math.max(0, r.waitUntil - now))
      : 0);
  const mono = monoClock();
  const last = measured.get(pc);
  if (left > 0 && last) {
    const wall = Math.max(0, now - last.wall);
    const ran = Number.isFinite(mono - last.mono)
      ? Math.max(0, Math.min(wall, mono - last.mono))
      : wall;
    left = Math.max(0, left - ran);
  }
  measured.set(pc, {wall: now, mono});
  return left;
}

/** Tests only: the clock that can't be set. */
export function setMonotonicClockForTests(clock?: Mono): void {
  monoClock = clock ?? defaultMono;
}

async function checkPin(
  pc: string,
  pin: string,
  now: () => number,
): Promise<PinAnswer & {record?: LockRecord}> {
  let record: LockRecord | null;
  try {
    record = await load(pc);
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: "Couldn't read this PC's PIN setting; try again",
    };
  }
  if (!record) {
    return {ok: true};
  }
  const r = {...record};
  const waitLeft = waitLeftNow(pc, r, now());
  if (waitLeft !== (r.waitLeft ?? 0) || (!waitLeft && r.waitUntil > 0)) {
    r.waitLeft = waitLeft;
    r.waitUntil = waitLeft ? now() + waitLeft : 0;
    await save(pc, r);
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
  await save(pc, r);
  const hash = await hashPin(pin, fromHex(r.salt), r.rounds);
  if (PIN_PATTERN.test(pin) && sameBytes(hash, fromHex(r.hash))) {
    r.fails = 0;
    r.waitUntil = 0;
    r.waitMs = 0;
    r.waitFrom = 0;
    r.waitLeft = 0;
    await save(pc, r);
    return {ok: true, record: r};
  }
  const wait = waitAfter(r.fails);
  if (wait) {
    r.waitMs = wait;
    r.waitFrom = now();
    r.waitUntil = r.waitFrom + wait;
    r.waitLeft = wait;
    measured.set(pc, {wall: now(), mono: monoClock()});
    await save(pc, r);
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

/** The PIN window's Unlock: checks the PIN (counted), unlocks on success. */
export function tryPin(
  pc: string,
  pin: string,
  now: () => number = Date.now,
): Promise<PinAnswer> {
  return serial(pc, async () => {
    const answer = await checkPin(pc, pin, now);
    if (answer.ok) {
      markUnlocked(pc);
      finish(pc, true);
      return {ok: true};
    }
    delete (answer as {record?: LockRecord}).record;
    return answer;
  });
}

// ---- Turning it on, changing it, off --------------------------------------

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** Turns the PIN on for a PC that has none (this device only). */
export function turnOnPin(
  pc: string,
  pin: string,
  awayMinutes = DEFAULT_AWAY_MINUTES,
): Promise<{ok: boolean; error?: string}> {
  return serial(pc, async () => {
    if (!PIN_PATTERN.test(pin)) {
      return {ok: false, error: 'The PIN must be 4 to 8 digits.'};
    }
    try {
      if (await load(pc)) {
        return {ok: false, error: 'A PIN is already set for this PC.'};
      }
      const salt = randomBytes(16);
      const hash = await hashPin(pin, salt, PIN_ITERATIONS);
      await save(pc, {
        v: 1,
        salt: toHex(salt),
        hash: toHex(hash),
        rounds: PIN_ITERATIONS,
        awayMinutes: cleanMinutes(awayMinutes),
        fails: 0,
        waitUntil: 0,
        waitMs: 0,
        waitFrom: 0,
      });
      // The user just typed it: no need to ask again now.
      markUnlocked(pc);
      return {ok: true};
    } catch (e) {
      cache.delete(pc);
      return {ok: false, error: `Couldn't save the PIN: ${String(e)}`};
    }
  });
}

const cleanMinutes = (m: number) =>
  Number.isFinite(m) ? Math.min(24 * 60, Math.max(1, Math.round(m))) : 5;

export interface LockChange {
  off?: boolean;
  newPin?: string;
  awayMinutes?: number;
  fingerprint?: boolean;
}

/**
 * Changes this PC's lock: off, a new PIN, the minutes, fingerprint on or
 * off. Always needs the current PIN (counted like any try), so someone with
 * the unlocked phone can't quietly switch it off.
 */
export function changeLock(
  pc: string,
  currentPin: string,
  change: LockChange,
  now: () => number = Date.now,
): Promise<PinAnswer> {
  return serial(pc, async () => {
    if (change.newPin !== undefined && !PIN_PATTERN.test(change.newPin)) {
      return {
        ok: false,
        reason: 'error',
        message: 'The new PIN must be 4 to 8 digits.',
      };
    }
    const answer = await checkPin(pc, currentPin, now);
    if (!answer.ok) {
      return answer;
    }
    const record = answer.record;
    if (!record) {
      return {ok: true};
    }
    try {
      if (change.off) {
        await forgetLock(pc);
        return {ok: true};
      }
      const next = {...record};
      if (change.newPin !== undefined) {
        const salt = randomBytes(16);
        next.salt = toHex(salt);
        next.hash = toHex(await hashPin(change.newPin, salt, PIN_ITERATIONS));
        next.rounds = PIN_ITERATIONS;
      }
      if (change.awayMinutes !== undefined) {
        next.awayMinutes = cleanMinutes(change.awayMinutes);
      }
      if (change.fingerprint === true) {
        next.finger = await storeFingerSecret(pc);
      } else if (change.fingerprint === false) {
        delete next.finger;
        await resetFinger(pc);
      }
      await save(pc, next);
      markUnlocked(pc);
      return {ok: true};
    } catch (e) {
      cache.delete(pc);
      return {
        ok: false,
        reason: 'error',
        message: `Not changed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });
}

async function resetFinger(pc: string) {
  try {
    await Keychain.resetGenericPassword({service: fingerService(pc)});
  } catch {}
}

async function forgetLock(pc: string) {
  await Keychain.resetGenericPassword({service: lockService(pc)});
  await resetFinger(pc);
  cache.set(pc, null);
  unlocked.delete(pc);
}

/**
 * Removes this PC's lock without the PIN: only when the PC is removed from
 * this device, or after pairing again (which the PC approved).
 */
export async function forgetHomePcLock(pc: string): Promise<void> {
  await serial(pc, async () => {
    try {
      await forgetLock(pc);
    } catch {
      cache.delete(pc);
    }
  });
  finish(pc, false);
}

// ---- Fingerprint (Android only) --------------------------------------------

/**
 * Fingerprint goes through react-native-keychain, already in the app: a
 * random secret is kept in the Android Keystore under a key that only opens
 * after the system's fingerprint check (androidx.biometric's prompt; no
 * Google Play services), and is invalidated when a new fingerprint is added
 * to the phone. Not on the desktop (its key store has no such check).
 */
function fingerprintHere(): boolean {
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

const fingerOptions = {
  accessControl: Keychain.ACCESS_CONTROL?.BIOMETRY_CURRENT_SET,
  storage: Keychain.STORAGE_TYPE?.AES_GCM,
  authenticationPrompt: {
    title: 'Unlock your Home PC',
    cancel: 'Use the PIN',
  },
};

async function storeFingerSecret(pc: string): Promise<string> {
  if (!(await fingerprintAvailable())) {
    throw new Error('No fingerprint is set up on this device');
  }
  const secret = toHex(randomBytes(32));
  const saved = await Keychain.setGenericPassword(USER, secret, {
    service: fingerService(pc),
    ...fingerOptions,
  });
  if (!saved) {
    throw new Error('The fingerprint key could not be made');
  }
  return toHex(sha256(utf8(secret)));
}

/** The PIN window's fingerprint button. */
export function tryFingerprint(pc: string): Promise<PinAnswer> {
  return serial(pc, async () => {
    let record: LockRecord | null = null;
    try {
      record = await load(pc);
    } catch {}
    if (!record?.finger || !fingerprintHere()) {
      return {
        ok: false,
        reason: 'error',
        message: 'Fingerprint is not on for this PC; use the PIN.',
      };
    }
    try {
      const found = await Keychain.getGenericPassword({
        service: fingerService(pc),
        ...fingerOptions,
      });
      if (
        found &&
        found.username === USER &&
        sameBytes(sha256(utf8(found.password)), fromHex(record.finger))
      ) {
        markUnlocked(pc);
        finish(pc, true);
        return {ok: true};
      }
    } catch {
      // Cancelled, too many tries (Android's own limit), or the key was
      // invalidated by a new fingerprint: the PIN still works.
    }
    return {
      ok: false,
      reason: 'error',
      message: 'Fingerprint not accepted; use the PIN.',
    };
  });
}

/** Tests only. */
export function resetHomePcLockForTests(): void {
  cache.clear();
  queues.clear();
  unlocked.clear();
  awaySince = null;
  listening = false;
  listeners.clear();
  waiting.splice(0);
  pending.clear();
  measured.clear();
}
