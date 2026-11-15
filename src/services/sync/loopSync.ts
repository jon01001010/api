/**
 * Loops kept in step between paired devices (TODO "Sync phone and PC":
 * loops / plans). Part of the "keep in step" switch; no switch of its own.
 *
 * Only a loop's definition travels, exactly the parts a shared loop code
 * carries (loopShare.ts → shareableLoop): its name, what each run does (the
 * goal and steps, or the prompt), how often, the limits and the battery
 * guard. Never its runs, log, chat, next time, paused state, progress
 * fingerprints or battery readings: each device keeps its own schedule.
 *
 * A loop that arrives from another device is installed paused and not
 * started (as from a shared code): nothing runs on two devices at once
 * unless the user presses Start on each. A changed definition updates the
 * loop here and keeps its runs, chat and log (a running loop keeps running
 * with the new definition, as after Edit).
 *
 * Loops travel as one item (a JSON list) merged one by one, like assistants
 * (assistantDeletes.ts): each loop carries `editedAt`, when its definition
 * last changed on its device; stopping (deleting) one leaves a tombstone
 * (`{id, title, deletedAt}`; the last 200, 90 days at most). Matched by id
 * only. For each loop the newer of its edit and its deletion wins (a
 * deletion wins a tie). A loop removed here because of another device's
 * deletion is kept 30 days under "Loops recently deleted" and can be
 * restored (paused; it then counts as edited now, so it comes back on the
 * other device too). More than 5 deletions in one sync: asked first.
 *
 * Toolbox switches are not kept in step: a loop's run uses the Toolbox of
 * the device it runs on, and each device asks for its own actions.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Alert} from 'react-native';

import {
  addLog,
  CUSTOM_LOOP_ID,
  editLoop,
  loadLoops,
  MAX_LOOPS,
  saveLoops,
  startOf,
  type Loop,
} from '../loops/loops';
import {
  loopFromShared,
  MAX_LOOP_BYTES,
  shareableLoop,
  type SharedLoop,
} from '../loops/loopShare';
import {loopPromptOf, blankDraft} from '../loops/makeLoop';

import {jsonBytes, readStrict} from './keptStore';
import {clampTime, fingerprint, MAX_CLOCK_SKEW} from './promptSync';

export const LOOP_TOMBSTONES_KEY = '@pocketagent/sync/loop-tombstones/v1';
export const LOOP_TIMES_KEY = '@pocketagent/sync/loop-times/v1';
export const LOOP_RECENT_KEY = '@pocketagent/sync/loops-recently-deleted/v1';

const DAY = 86_400_000;
export const MAX_LOOP_TOMBSTONES = 200;
export const LOOP_TOMBSTONE_DAYS = 90;
export const LOOP_RECENT_DAYS = 30;
/** More deletions than this in one sync: ask first. */
export const LOOP_DELETE_CAP = 5;
/** Room for "Loops recently deleted" (UTF-8 bytes, one stored value). */
export const LOOP_RECENT_ROOM = 500_000;
/** Most live loops taken from one list (a device keeps at most MAX_LOOPS). */
const MAX_LIVE = 50;
/** Loop ids (as made by buildLoop: time and random, base 36). */
export const LOOP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TITLE = 200;

/** A loop in the synced list: its definition, and when it last changed. */
export type LoopEntry = SharedLoop & {id: string; editedAt: number};

export interface LoopTombstone {
  id: string;
  /** Its name, to say what was deleted. */
  title?: string;
  deletedAt: number;
}

/** A loop removed here because it was stopped on another device. */
export interface RecentlyDeletedLoop {
  loop: Loop;
  deletedAt: number;
  removedAt: number;
  from: string;
}

/** Counts a sync fills in (shown to the user). */
export interface LoopReport {
  /** New loops installed here (paused, not started). */
  loopsAdded?: number;
  /** Loops stopped elsewhere, removed here (kept under Recently deleted). */
  loopsDeleted?: number;
  /** Deletions waiting for the user's answer (too many at once). */
  loopsHeld?: number;
  /** New loops not installed: this device already has MAX_LOOPS. */
  loopsNoRoom?: number;
}

/** Where loops, times and deletions are kept (injected in tests). */
export interface LoopSyncStore {
  now: () => number;
  load: <T>(key: string, fallback: T) => Promise<T>;
  save: (key: string, value: unknown) => Promise<void>;
  loadLoops: () => Promise<Loop[]>;
  saveLoops: (loops: Loop[]) => Promise<void>;
}

const readJson = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(key)) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

export const deviceLoopStore: LoopSyncStore = {
  now: () => Date.now(),
  // Recently deleted: a failed read throws (never taken as empty).
  load: (key, fallback) =>
    key === LOOP_RECENT_KEY
      ? readStrict(key, fallback)
      : readJson(key, fallback),
  save: (key, value) => AsyncStorage.setItem(key, JSON.stringify(value)),
  loadLoops,
  saveLoops,
};

// ------------------------------------------------------------ definitions

/**
 * A definition (any shape) cleaned exactly as a shared loop code is (same
 * cleaning and hard limits), so the same loop reads the same on both
 * devices. Null when it is not a loop that could be installed.
 */
export function cleanDefinition(
  raw: unknown,
  now = Date.now(),
): SharedLoop | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  // Only the definition's own fields are read (nothing of run state).
  const def: Record<string, unknown> = {};
  for (const k of [
    'title',
    'goal',
    'steps',
    'prompt',
    'every',
    'at',
    'maxRuns',
    'days',
    'battery',
  ]) {
    if (r[k] !== undefined) {
      def[k] = r[k];
    }
  }
  const built = loopFromShared(def, now);
  return built.ok ? shareableLoop(built.loop, now) : null;
}

/** The definition of a loop here (cleaned as one that came would be). */
export function definitionOf(loop: Loop, now = Date.now()): SharedLoop | null {
  return cleanDefinition(shareableLoop(loop, now), now);
}

const defText = (d: SharedLoop | null) => JSON.stringify(d ?? null);
const defPrint = (d: SharedLoop | null) => fingerprint(defText(d));
/** An entry's definition (without its id and time). */
const entryDef = (e: LoopEntry): SharedLoop => {
  const def: Partial<LoopEntry> = {...e};
  delete def.id;
  delete def.editedAt;
  return def as SharedLoop;
};

// ------------------------------------------------------------ the list

const validTime = (t: unknown, now: number): t is number =>
  typeof t === 'number' &&
  Number.isFinite(t) &&
  t > 0 &&
  // A clock far ahead would delete every later edit: not taken.
  t <= now + MAX_CLOCK_SKEW;

/** Only well-formed tombstones (one per id, the latest; none from the future). */
export function cleanLoopTombstones(
  raw: unknown,
  now = Date.now(),
): LoopTombstone[] {
  const latest = new Map<string, LoopTombstone>();
  for (const t of Array.isArray(raw) ? raw : []) {
    if (
      t &&
      typeof t.id === 'string' &&
      LOOP_ID.test(t.id) &&
      validTime(t.deletedAt, now)
    ) {
      const seen = latest.get(t.id);
      if (!seen || seen.deletedAt < t.deletedAt) {
        latest.set(t.id, {
          id: t.id,
          ...(typeof t.title === 'string' &&
          t.title &&
          t.title.length <= MAX_TITLE
            ? {title: t.title}
            : {}),
          deletedAt: t.deletedAt,
        });
      }
    }
  }
  return [...latest.values()];
}

/** The newest 200, within 90 days. */
export function pruneLoopTombstones(
  list: LoopTombstone[],
  now: number,
): LoopTombstone[] {
  return cleanLoopTombstones(list, now)
    .filter(t => t.deletedAt >= now - LOOP_TOMBSTONE_DAYS * DAY)
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, MAX_LOOP_TOMBSTONES);
}

/**
 * A synced list: live loops (definition and `editedAt`) and tombstones.
 * Malformed or oversize entries are ignored; definitions are cleaned and
 * held to the hard limits; times are clamped; an entry without a time takes
 * `fallback`. Not a list: null.
 */
export function parseLoops(
  text: string,
  fallback: number,
  now = Date.now(),
): {live: LoopEntry[]; dead: LoopTombstone[]} | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const live = new Map<string, LoopEntry>();
  const dead: unknown[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') {
      continue;
    }
    if (!('title' in e && ('prompt' in e || 'goal' in e)) && 'deletedAt' in e) {
      dead.push(e);
      continue;
    }
    if (!LOOP_ID.test(e.id) || live.has(e.id) || live.size >= MAX_LIVE) {
      continue;
    }
    let size = Infinity;
    try {
      size = JSON.stringify(e).length;
    } catch {
      // Not plain data: ignored.
    }
    if (size > MAX_LOOP_BYTES) {
      continue;
    }
    const def = cleanDefinition(e, now);
    if (!def) {
      continue;
    }
    const at =
      typeof e.editedAt === 'number' && Number.isFinite(e.editedAt)
        ? e.editedAt
        : fallback;
    live.set(e.id, {id: e.id, ...def, editedAt: clampTime(at, now)});
  }
  return {
    live: [...live.values()],
    // An id both live and deleted in one list: the live one stands.
    dead: cleanLoopTombstones(dead, now).filter(t => !live.has(t.id)),
  };
}

type Side = {kind: 'live'; e: LoopEntry} | {kind: 'dead'; t: LoopTombstone};

const sideAt = (s: Side) => (s.kind === 'live' ? s.e.editedAt : s.t.deletedAt);
const sideText = (s: Side) =>
  s.kind === 'live' ? defText(entryDef(s.e)) : '\u0000deleted';

function pick(
  l: Side,
  r: Side,
): {side: Side; from: 'local' | 'remote' | 'same'} {
  if (l.kind === 'live' && r.kind === 'live' && sideText(l) === sideText(r)) {
    return {side: l.e.editedAt >= r.e.editedAt ? l : r, from: 'same'};
  }
  if (l.kind === 'dead' && r.kind === 'dead') {
    return {side: sideAt(r) > sideAt(l) ? r : l, from: 'same'};
  }
  const la = sideAt(l);
  const ra = sideAt(r);
  const remoteWins =
    la !== ra
      ? ra > la
      : l.kind !== r.kind
        ? // An edit and a deletion at the same moment: the deletion.
          r.kind === 'dead'
        : // Same moment: the same choice on both devices.
          sideText(r) > sideText(l);
  return {side: remoteWins ? r : l, from: remoteWins ? 'remote' : 'local'};
}

/**
 * Two synced lists joined loop by loop (by id): the newer edit or deletion
 * of each wins. Null when either isn't a list.
 */
export function mergeLoops(
  localText: string,
  remoteText: string,
  localAt: number,
  remoteAt: number,
  now = Date.now(),
): {text: string; takenHere: boolean; takenThere: boolean} | null {
  const l = parseLoops(localText, localAt, now);
  const r = parseLoops(remoteText, remoteAt, now);
  if (!l || !r) {
    return null;
  }
  const toSides = (x: NonNullable<typeof l>) =>
    new Map<string, Side>([
      ...x.live.map(e => [e.id, {kind: 'live', e}] as [string, Side]),
      ...x.dead.map(t => [t.id, {kind: 'dead', t}] as [string, Side]),
    ]);
  const local = toSides(l);
  const remote = toSides(r);
  const out: Side[] = [];
  let takenHere = false;
  let takenThere = false;
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const ls = local.get(id);
    const rs = remote.get(id);
    if (ls && rs) {
      const p = pick(ls, rs);
      out.push(p.side);
      takenHere ||= p.from === 'remote';
      takenThere ||= p.from === 'local';
    } else if (ls) {
      out.push(ls);
      takenThere ||= ls.kind === 'live';
    } else if (rs) {
      out.push(rs);
      takenHere ||= rs.kind === 'live';
    }
  }
  const kept = new Set(
    pruneLoopTombstones(
      out.filter(s => s.kind === 'dead').map(s => (s as any).t),
      now,
    ).map(t => t.id),
  );
  const list = out
    .filter(s => s.kind === 'live' || kept.has(s.t.id))
    .map(s => (s.kind === 'live' ? s.e : s.t))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {text: JSON.stringify(list), takenHere, takenThere};
}

// ------------------------------------------------------------ times

type Times = Record<string, {print: string; at: number}>;

/** When a loop's definition last changed here, first look (its start or last edit). */
function firstLook(loop: Loop, now: number): number {
  const edited = loop.log
    .filter(e => e && e.what === 'Edited' && Number.isFinite(e.at))
    .reduce((max, e) => Math.max(max, e.at), 0);
  return Math.min(Math.max(startOf(loop, now), edited), now);
}

/** When each loop's definition last changed here (id → time). */
export async function loopEditTimes(
  loops: Loop[],
  store: LoopSyncStore = deviceLoopStore,
): Promise<Map<string, number>> {
  const now = store.now();
  const state = await store.load<Times>(LOOP_TIMES_KEY, {});
  const next: Times = {};
  const out = new Map<string, number>();
  for (const loop of loops) {
    const print = defPrint(definitionOf(loop, now));
    const seen = state[loop.id];
    const at =
      seen && seen.print === print
        ? Math.min(seen.at, now)
        : seen
          ? now
          : firstLook(loop, now);
    next[loop.id] = {print, at};
    out.set(loop.id, at);
  }
  await store.save(LOOP_TIMES_KEY, next);
  return out;
}

async function setLoopTimes(
  list: {loop: Loop; at: number}[],
  store: LoopSyncStore,
): Promise<void> {
  if (!list.length) {
    return;
  }
  const now = store.now();
  const state = await store.load<Times>(LOOP_TIMES_KEY, {});
  for (const {loop, at} of list) {
    state[loop.id] = {
      print: defPrint(definitionOf(loop, now)),
      at: Math.min(at, now),
    };
  }
  await store.save(LOOP_TIMES_KEY, state);
}

// ------------------------------------------------------------ tombstones

export async function knownLoopTombstones(
  store: LoopSyncStore = deviceLoopStore,
): Promise<LoopTombstone[]> {
  return pruneLoopTombstones(
    await store.load<LoopTombstone[]>(LOOP_TOMBSTONES_KEY, []),
    store.now(),
  );
}

async function addLoopTombstones(
  list: LoopTombstone[],
  store: LoopSyncStore,
): Promise<void> {
  if (!list.length) {
    return;
  }
  const mine = await store.load<LoopTombstone[]>(LOOP_TOMBSTONES_KEY, []);
  await store.save(
    LOOP_TOMBSTONES_KEY,
    pruneLoopTombstones([...mine, ...list], store.now()),
  );
}

async function forgetLoopTombstones(
  ids: string[],
  store: LoopSyncStore,
): Promise<void> {
  if (!ids.length) {
    return;
  }
  const drop = new Set(ids);
  const mine = await store.load<LoopTombstone[]>(LOOP_TOMBSTONES_KEY, []);
  if (mine.some(t => t && drop.has(t.id))) {
    await store.save(
      LOOP_TOMBSTONES_KEY,
      pruneLoopTombstones(
        mine.filter(t => !drop.has(t.id)),
        store.now(),
      ),
    );
  }
}

/** The user stopped (deleted) a loop here (always recorded; cheap). */
export async function recordLoopDeleted(
  loop: Pick<Loop, 'id' | 'title'>,
  store: LoopSyncStore = deviceLoopStore,
): Promise<void> {
  if (!loop || !LOOP_ID.test(loop.id)) {
    return;
  }
  await addLoopTombstones(
    [{id: loop.id, title: loop.title, deletedAt: store.now()}],
    store,
  );
}

// ------------------------------------------------------------ read / write

/** This device's loops as a synced list (definitions and deletions). */
export async function readLoopsItem(
  store: LoopSyncStore = deviceLoopStore,
): Promise<string> {
  const now = store.now();
  const loops = await store.loadLoops();
  const times = await loopEditTimes(loops, store);
  const live = new Set(loops.map(l => l.id));
  const list: Record<string, unknown>[] = [];
  for (const loop of loops) {
    const def = definitionOf(loop, now);
    if (def && LOOP_ID.test(loop.id)) {
      list.push({id: loop.id, ...def, editedAt: times.get(loop.id) ?? 0});
    }
  }
  for (const t of await knownLoopTombstones(store)) {
    if (!live.has(t.id)) {
      list.push({...t});
    }
  }
  return JSON.stringify(
    list.sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
}

/** A definition that came, as a new loop here: paused and not started. */
function installedFrom(
  e: LoopEntry,
  from: string,
  now: number,
): Loop | undefined {
  const r = loopFromShared(e, now);
  if (!r.ok) {
    return undefined;
  }
  return {
    ...r.loop,
    id: e.id,
    paused: true,
    notStarted: true,
    runs: 0,
    sessionId: undefined,
    progress: undefined,
    pausedWhy: undefined,
    log: [{at: now, what: `Came from ${from} (not started here)`}],
  };
}

/** A loop here with a changed definition: its runs, chat and log kept. */
function updatedFrom(
  here: Loop,
  e: LoopEntry,
  from: string,
  now: number,
): Loop | undefined {
  const plan = e.steps?.length && e.goal ? {goal: e.goal, steps: e.steps} : 0;
  const prompt = plan
    ? loopPromptOf({...blankDraft(''), prompt: plan.goal, steps: plan.steps})
    : (e.prompt ?? '');
  if (!here.notStarted) {
    const r = editLoop(
      {...here, templateId: plan ? CUSTOM_LOOP_ID : here.templateId},
      {
        title: e.title,
        prompt,
        ...(plan ? {plan} : {}),
        every: e.every,
        at: e.at,
        maxRuns: e.maxRuns,
        days: e.days,
        battery: e.battery,
      },
      now,
    );
    if (r.ok) {
      return addLog(r.loop, `Changed on ${from}`, now);
    }
  }
  // Not started here, or the change doesn't fit what ran here (its end
  // would be past): the new definition, paused and not started here.
  const fresh = installedFrom(e, from, now);
  return fresh
    ? addLog(
        {...fresh, sessionId: here.sessionId, log: here.log},
        `Changed on ${from}; not started here`,
        now,
      )
    : undefined;
}

export interface LoopWriteOptions {
  /** Which device it came from ("the PC", or the device's name). */
  from?: string;
  /** The item's time, for entries without their own. */
  at?: number;
  report?: LoopReport;
}

/**
 * Writes an agreed list here: adds new loops (paused, not started), updates
 * changed definitions, removes loops stopped elsewhere that haven't changed
 * here since. Returns whether anything here changed.
 */
export async function writeLoopsItem(
  text: string,
  opts: LoopWriteOptions = {},
  store: LoopSyncStore = deviceLoopStore,
): Promise<boolean> {
  const now = store.now();
  const parsed = parseLoops(text, opts.at ?? now, now);
  if (!parsed) {
    return false;
  }
  const from = opts.from ?? 'another device';
  const loops = await store.loadLoops();
  const times = await loopEditTimes(loops, store);
  const taken: {loop: Loop; at: number}[] = [];
  let added = 0;
  let noRoom = 0;
  let changed = false;
  for (const e of parsed.live) {
    const i = loops.findIndex(l => l.id === e.id);
    if (i >= 0) {
      const here = loops[i];
      if (defText(definitionOf(here, now)) === defText(entryDef(e))) {
        // The same definition: only its agreed time.
        taken.push({
          loop: here,
          at: Math.max(times.get(e.id) ?? 0, e.editedAt),
        });
        continue;
      }
      if ((times.get(e.id) ?? 0) > e.editedAt) {
        // Changed here since (after the merge): this device's edit stands.
        continue;
      }
      const next = updatedFrom(here, e, from, now);
      if (next) {
        loops[i] = next;
        taken.push({loop: next, at: e.editedAt});
        changed = true;
      }
      continue;
    }
    if (loops.length >= MAX_LOOPS) {
      noRoom++;
      continue;
    }
    const loop = installedFrom(e, from, now);
    if (loop) {
      loops.push(loop);
      taken.push({loop, at: e.editedAt});
      added++;
      changed = true;
    }
  }
  if (changed) {
    await store.saveLoops(loops);
  }
  await setLoopTimes(taken, store);
  // Back again (edited after a deletion): no longer deleted here.
  await forgetLoopTombstones(
    taken.map(t => t.loop.id),
    store,
  );
  const keep = new Set(taken.map(t => t.loop.id));
  const del = await applyLoopTombstones(parsed.dead, keep, from, store);
  if (opts.report) {
    const r = opts.report;
    r.loopsAdded = (r.loopsAdded ?? 0) + added;
    r.loopsDeleted = (r.loopsDeleted ?? 0) + del.deleted.length;
    r.loopsHeld = (r.loopsHeld ?? 0) + del.held.length;
    r.loopsNoRoom = (r.loopsNoRoom ?? 0) + noRoom;
  }
  if (del.held.length) {
    askAboutHeldLoops(del.held, from, undefined, store);
  }
  return changed || del.deleted.length > 0;
}

// ------------------------------------------------------------ deletions

export interface HeldLoopDelete {
  loop: Loop;
  deletedAt: number;
}

/** Within 30 days, newest first. */
export function pruneRecentLoops(
  list: RecentlyDeletedLoop[],
  now: number,
): RecentlyDeletedLoop[] {
  return (Array.isArray(list) ? list : [])
    .filter(
      r =>
        r &&
        r.loop &&
        typeof r.loop.id === 'string' &&
        typeof r.removedAt === 'number' &&
        r.removedAt >= now - LOOP_RECENT_DAYS * DAY,
    )
    .sort((a, b) => b.removedAt - a.removedAt);
}

/**
 * Keeps these loops under Recently deleted, then removes them here; one
 * that doesn't fit in the room left (or when the list can't be read) is
 * not removed.
 */
async function removeKept(
  wanted: HeldLoopDelete[],
  from: string,
  store: LoopSyncStore,
): Promise<string[]> {
  if (!wanted.length) {
    return [];
  }
  const now = store.now();
  let kept: RecentlyDeletedLoop[];
  try {
    kept = await store.load<RecentlyDeletedLoop[]>(LOOP_RECENT_KEY, []);
  } catch {
    // Can't be read: nothing can be kept, so nothing is removed.
    return [];
  }
  const wantedIds = new Set(wanted.map(h => h.loop.id));
  const recent = pruneRecentLoops(kept, now).filter(
    r => !wantedIds.has(r.loop.id),
  );
  let used = jsonBytes(recent);
  const added: RecentlyDeletedLoop[] = [];
  for (const h of wanted) {
    const entry = {loop: h.loop, deletedAt: h.deletedAt, removedAt: now, from};
    const n = jsonBytes(entry) + 1;
    if (used + n > LOOP_RECENT_ROOM) {
      continue;
    }
    added.push(entry);
    used += n;
  }
  if (!added.length) {
    return [];
  }
  const list = added.map(r => ({loop: r.loop, deletedAt: r.deletedAt}));
  const ids = new Set(list.map(h => h.loop.id));
  await store.save(LOOP_RECENT_KEY, [...added, ...recent]);
  // Saved without going through Stop: not this device's own deletion.
  await store.saveLoops((await store.loadLoops()).filter(l => !ids.has(l.id)));
  await addLoopTombstones(
    list.map(h => ({
      id: h.loop.id,
      title: h.loop.title,
      deletedAt: h.deletedAt,
    })),
    store,
  );
  return [...ids];
}

/**
 * Deletions in an agreed list, against the loops here: one that has not
 * changed here since it was deleted (and that the list doesn't keep) is
 * removed and kept under Recently deleted. Too many at once: held, to ask.
 */
export async function applyLoopTombstones(
  dead: LoopTombstone[],
  keep: Set<string>,
  from: string,
  store: LoopSyncStore = deviceLoopStore,
  cap = LOOP_DELETE_CAP,
): Promise<{deleted: string[]; held: HeldLoopDelete[]}> {
  if (!dead.length) {
    return {deleted: [], held: []};
  }
  const loops = await store.loadLoops();
  const times = await loopEditTimes(loops, store);
  const remove: HeldLoopDelete[] = [];
  for (const t of dead) {
    const here = loops.find(l => l.id === t.id && !keep.has(l.id));
    if (here && (times.get(here.id) ?? Infinity) <= t.deletedAt) {
      remove.push({loop: here, deletedAt: t.deletedAt});
    }
  }
  // Remembered, so this device passes them on (and doesn't bring them back).
  await addLoopTombstones(dead, store);
  if (remove.length > cap) {
    return {deleted: [], held: remove};
  }
  return {deleted: await removeKept(remove, from, store), held: []};
}

/** The user said yes to held deletions. */
export function confirmHeldLoops(
  held: HeldLoopDelete[],
  from: string,
  store: LoopSyncStore = deviceLoopStore,
): Promise<string[]> {
  return removeKept(held, from, store);
}

/** The user kept held loops: they count as edited now and come back there. */
export async function keepHeldLoops(
  held: HeldLoopDelete[],
  store: LoopSyncStore = deviceLoopStore,
): Promise<string[]> {
  const now = store.now();
  await setLoopTimes(
    held.map(h => ({loop: h.loop, at: Math.max(now, h.deletedAt + 1)})),
    store,
  );
  const ids = held.map(h => h.loop.id);
  await forgetLoopTombstones(ids, store);
  return ids;
}

/** Recently deleted loops (stopped on another device), newest first. */
export async function recentlyDeletedLoops(
  store: LoopSyncStore = deviceLoopStore,
): Promise<RecentlyDeletedLoop[]> {
  const all = await store.load<RecentlyDeletedLoop[]>(LOOP_RECENT_KEY, []);
  const list = Array.isArray(all) ? all : [];
  const kept = pruneRecentLoops(list, store.now());
  if (kept.length !== list.length) {
    await store.save(LOOP_RECENT_KEY, kept);
  }
  return kept;
}

/**
 * Puts a recently deleted loop back (same id), paused: the user resumes it.
 * It counts as edited now, so it comes back on the other device too.
 * Returns why not, or true.
 */
export async function restoreLoop(
  id: string,
  store: LoopSyncStore = deviceLoopStore,
): Promise<true | string> {
  const list = await recentlyDeletedLoops(store);
  const entry = list.find(r => r.loop.id === id);
  if (!entry) {
    return 'That loop is no longer kept';
  }
  const now = store.now();
  const loops = await store.loadLoops();
  let loop = loops.find(l => l.id === id);
  if (!loop) {
    if (loops.length >= MAX_LOOPS) {
      return `At most ${MAX_LOOPS} loops; stop one first`;
    }
    loop = addLog(
      {...entry.loop, paused: true, pausedWhy: undefined},
      'Restored (paused)',
      now,
    );
    await store.saveLoops([...loops, loop]);
  }
  await setLoopTimes([{loop, at: Math.max(now, entry.deletedAt + 1)}], store);
  await forgetLoopTombstones([id], store);
  await store.save(
    LOOP_RECENT_KEY,
    list.filter(r => r !== entry),
  );
  return true;
}

// ------------------------------------------------------------ words

const loopsWord = (n: number) => `${n} loop${n === 1 ? '' : 's'}`;

/** "2 loops from the PC; start them under Toolbox → Loops". */
export function describeLoopsAdded(n: number, where: string): string {
  return `${loopsWord(n)} from ${where}; start ${n === 1 ? 'it' : 'them'} under Toolbox → Loops`;
}

/** "1 loop stopped on the PC; kept 30 days under Recently deleted". */
export function describeLoopDeletes(n: number, where: string): string {
  return `${loopsWord(n)} stopped on ${where}; kept ${LOOP_RECENT_DAYS} days under Recently deleted`;
}

/** Every line a sync's loop counts make (empty when nothing happened). */
export function describeLoopReport(r: LoopReport, where: string): string[] {
  return [
    r.loopsAdded ? describeLoopsAdded(r.loopsAdded, where) : '',
    r.loopsNoRoom
      ? `${loopsWord(r.loopsNoRoom)} from ${where} not added: at most ${MAX_LOOPS} loops here`
      : '',
    r.loopsDeleted ? describeLoopDeletes(r.loopsDeleted, where) : '',
    r.loopsHeld
      ? `${loopsWord(r.loopsHeld)} stopped on ${where} wait for your answer`
      : '',
  ].filter(Boolean);
}

let asking = false;

/** Too many deletions at once: ask (never removed without an answer). */
export function askAboutHeldLoops(
  held: HeldLoopDelete[],
  from: string,
  done: (r: {deleted: string[]; kept: string[]}) => void = () => {},
  store: LoopSyncStore = deviceLoopStore,
): void {
  if (asking) {
    return;
  }
  asking = true;
  const answered = () => {
    asking = false;
  };
  Alert.alert(
    'Remove loops?',
    `${held.length} of your loops were stopped on ${from}: ${held
      .map(h => h.loop.title)
      .join(
        ', ',
      )}. Remove them here too? They are kept ${LOOP_RECENT_DAYS} days under Recently deleted. If you keep them, they come back on ${from} (not started there).`,
    [
      {
        text: 'Keep them',
        style: 'cancel',
        onPress: () => {
          answered();
          keepHeldLoops(held, store)
            .then(kept => done({deleted: [], kept}))
            .catch(() => {});
        },
      },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          answered();
          confirmHeldLoops(held, from, store)
            .then(deleted => done({deleted, kept: []}))
            .catch(() => {});
        },
      },
    ],
    {cancelable: true, onDismiss: answered},
  );
}

/** For tests. */
export function resetAskingLoops(): void {
  asking = false;
}
