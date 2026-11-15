/**
 * Deleting one of your own assistants travels with keeping in step (TODO
 * "deleting an assistant on one device").
 *
 * Assistants travel as one item (a JSON list), but they are merged one by
 * one: each assistant carries `editedAt`, when it last changed on its
 * device, and deleting one leaves a tombstone in the same list
 * (`{id, name, deletedAt}`; the last 200, 90 days at most). When two
 * devices meet, the lists are joined by id (then by name: each device makes
 * its own starter assistants), and for each assistant the newer of its edit
 * and its deletion wins (a deletion wins a tie, as for chats). So a deletion
 * removes the other device's copy only if that copy hasn't changed since,
 * and an edit made after the deletion brings it back.
 *
 * Nothing is lost silently: an assistant removed here because of another
 * device's deletion is kept 30 days under "Recently deleted" (with its
 * picture and model choice) and can be restored (it then counts as edited
 * now, so it comes back on the other device too). More than 5 at once are
 * not removed without asking. Downloaded (store) assistants are never
 * deleted (or matched) by a sync.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Alert} from 'react-native';

import type {Pal} from '../../types/pal';

import {jsonBytes, readStrict} from './keptStore';
import {clampTime, fingerprint, MAX_CLOCK_SKEW} from './promptSync';

export const TOMBSTONES_KEY = '@pocketagent/sync/assistant-tombstones/v1';
export const TIMES_KEY = '@pocketagent/sync/assistant-times/v1';
export const RECENT_KEY = '@pocketagent/sync/assistants-recently-deleted/v1';

const DAY = 86_400_000;
export const MAX_TOMBSTONES = 200;
export const TOMBSTONE_DAYS = 90;
export const RECENT_DAYS = 30;
/** More deletions than this in one sync: ask first. */
export const DELETE_CAP = 5;
/** Room for "Recently deleted" assistants (UTF-8 bytes, one stored value). */
export const RECENT_ROOM = 500_000;
/** Assistant ids (the database's own, or a synced one kept as is). */
export const ASSISTANT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME = 200;

/** The parts of an assistant that mean the same on every device. */
export const PORTABLE = [
  'id',
  'name',
  'description',
  'systemPrompt',
  'originalSystemPrompt',
  'isSystemPromptChanged',
  'useAIPrompt',
  'color',
  'capabilities',
  'parameters',
  'parameterSchema',
  'completionSettings',
  'pact',
  'greeting',
] as const;

export function portablePal(p: Partial<Pal>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PORTABLE) {
    if ((p as any)[k] !== undefined) {
      out[k] = (p as any)[k];
    }
  }
  return out;
}

/** What an assistant says, without its id (same on every device). */
export const contentPrint = (p: Partial<Pal> | Record<string, unknown>) =>
  fingerprint(JSON.stringify(portablePal({...(p as any), id: undefined})));

/** One of your own assistants (not downloaded from the store). */
export const isOwn = (p: Pal) => (p.source ?? 'local') === 'local';

export interface AssistantTombstone {
  id: string;
  /** Its name, to find the same starter assistant on another device. */
  name?: string;
  deletedAt: number;
}

/** An assistant in the synced list, with when it last changed. */
export type LiveEntry = Record<string, unknown> & {
  id: string;
  name: string;
  systemPrompt: string;
  editedAt: number;
};

/** An assistant removed here because it was deleted on another device. */
export interface RecentlyDeletedAssistant {
  pal: Pal;
  deletedAt: number;
  removedAt: number;
  from: string;
}

export interface HeldAssistantDelete {
  pal: Pal;
  deletedAt: number;
}

/** Counts a sync fills in (shown to the user). */
export interface AssistantReport {
  assistantsDeleted: number;
  assistantsHeld: number;
}

/** Where deletions, edit times and removed assistants are kept (injected in tests). */
export interface AssistantDeleteStore {
  now: () => number;
  load: <T>(key: string, fallback: T) => Promise<T>;
  save: (key: string, value: unknown) => Promise<void>;
  /** Your own assistants here. */
  ownPals: () => Pal[];
  /** Removes an assistant here (no tombstone of its own; picture kept). */
  remove: (id: string) => Promise<void>;
  /** Puts an assistant back with its id. */
  recreate: (pal: Pal) => Promise<void>;
  /** A picture no longer needed (a recently deleted one that expired). */
  dropPicture: (file: string) => Promise<void>;
}

const readJson = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(key)) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

// Late requires: the stores import this module.
const palStore = () => require('../../store').palStore;

export const deviceAssistantStore: AssistantDeleteStore = {
  now: () => Date.now(),
  // Recently deleted: a failed read throws (never taken as empty).
  load: (key, fallback) =>
    key === RECENT_KEY ? readStrict(key, fallback) : readJson(key, fallback),
  save: (key, value) => AsyncStorage.setItem(key, JSON.stringify(value)),
  ownPals: () => (palStore().pals as Pal[]).filter(isOwn),
  remove: id => palStore().deletePal(id, {bySync: true}),
  recreate: async pal => {
    const data: Partial<Pal> = {...pal, source: 'local'};
    delete data.id;
    delete data.created_at;
    delete data.updated_at;
    await require('../../repositories/PalRepository').palRepository.createPal(
      data,
      pal.id,
    );
    await palStore().reloadFromDatabase();
  },
  dropPicture: async file => {
    await require('../../utils/imageUtils').deletePalThumbnail(file);
  },
};

const validTime = (t: unknown, now: number): t is number =>
  typeof t === 'number' &&
  Number.isFinite(t) &&
  t > 0 &&
  // A clock far ahead would delete every later edit: not taken.
  t <= now + MAX_CLOCK_SKEW;

/** Only well-formed tombstones (one per id, the latest; none from the future). */
export function cleanAssistantTombstones(
  raw: unknown,
  now = Date.now(),
): AssistantTombstone[] {
  const latest = new Map<string, AssistantTombstone>();
  for (const t of Array.isArray(raw) ? raw : []) {
    if (
      t &&
      typeof t.id === 'string' &&
      ASSISTANT_ID.test(t.id) &&
      validTime(t.deletedAt, now)
    ) {
      const seen = latest.get(t.id);
      if (!seen || seen.deletedAt < t.deletedAt) {
        latest.set(t.id, {
          id: t.id,
          ...(typeof t.name === 'string' && t.name && t.name.length <= MAX_NAME
            ? {name: t.name}
            : {}),
          deletedAt: t.deletedAt,
        });
      }
    }
  }
  return [...latest.values()];
}

/** The newest 200, within 90 days. */
export function pruneAssistantTombstones(
  list: AssistantTombstone[],
  now: number,
): AssistantTombstone[] {
  return cleanAssistantTombstones(list, now)
    .filter(t => t.deletedAt >= now - TOMBSTONE_DAYS * DAY)
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, MAX_TOMBSTONES);
}

/**
 * A synced list: live assistants (portable parts and `editedAt`) and
 * tombstones. Malformed entries are ignored; times are clamped; a live
 * entry without a time (an older app) takes `fallback`. Not a list: null.
 */
export function parseAssistants(
  text: string,
  fallback: number,
  now = Date.now(),
): {live: LiveEntry[]; dead: AssistantTombstone[]} | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const live = new Map<string, LiveEntry>();
  const dead: unknown[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') {
      continue;
    }
    if (typeof e.systemPrompt !== 'string' && 'deletedAt' in e) {
      dead.push(e);
      continue;
    }
    if (
      !ASSISTANT_ID.test(e.id) ||
      typeof e.name !== 'string' ||
      typeof e.systemPrompt !== 'string' ||
      live.has(e.id)
    ) {
      continue;
    }
    const at =
      typeof e.editedAt === 'number' && Number.isFinite(e.editedAt)
        ? e.editedAt
        : fallback;
    live.set(e.id, {
      ...(portablePal(e) as any),
      editedAt: clampTime(at, now),
    });
  }
  return {
    live: [...live.values()],
    // An id both live and deleted in one list: the live one stands.
    dead: cleanAssistantTombstones(dead, now).filter(t => !live.has(t.id)),
  };
}

type Side =
  | {kind: 'live'; e: LiveEntry}
  | {kind: 'dead'; t: AssistantTombstone};

const sideId = (s: Side) => (s.kind === 'live' ? s.e.id : s.t.id);
const sideName = (s: Side) => (s.kind === 'live' ? s.e.name : s.t.name);
const sideAt = (s: Side) => (s.kind === 'live' ? s.e.editedAt : s.t.deletedAt);
const sideText = (s: Side) =>
  s.kind === 'live'
    ? JSON.stringify(portablePal({...s.e, id: undefined}))
    : '\u0000deleted';

/** The same assistant on both sides: which one stands. */
function pick(
  l: Side,
  r: Side,
): {side: Side; from: 'local' | 'remote' | 'same'} {
  if (l.kind === 'live' && r.kind === 'live') {
    if (sideText(l) === sideText(r)) {
      // Same content: the later time (the lower id on a tie), nothing taken.
      const lFirst =
        l.e.editedAt !== r.e.editedAt
          ? l.e.editedAt > r.e.editedAt
          : l.e.id <= r.e.id;
      return {side: lFirst ? l : r, from: 'same'};
    }
  }
  if (l.kind === 'dead' && r.kind === 'dead') {
    return {side: sideAt(r) > sideAt(l) ? r : l, from: 'same'};
  }
  const la = sideAt(l);
  const ra = sideAt(r);
  let remoteWins: boolean;
  if (la !== ra) {
    remoteWins = ra > la;
  } else if (l.kind !== r.kind) {
    // An edit and a deletion at the same moment: the deletion (as for chats).
    remoteWins = r.kind === 'dead';
  } else {
    // Same moment: the same choice on both devices.
    remoteWins = sideText(r) > sideText(l);
  }
  return {side: remoteWins ? r : l, from: remoteWins ? 'remote' : 'local'};
}

/**
 * Two synced lists joined assistant by assistant (by id, then by name): the
 * newer edit or deletion of each wins. Null when either isn't a list (the
 * caller then falls back to the whole-item rule).
 */
export function mergeAssistants(
  localText: string,
  remoteText: string,
  localAt: number,
  remoteAt: number,
  now = Date.now(),
): {text: string; takenHere: boolean; takenThere: boolean} | null {
  const l = parseAssistants(localText, localAt, now);
  const r = parseAssistants(remoteText, remoteAt, now);
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
  const take = (ls: Side | undefined, rs: Side | undefined) => {
    if (ls && rs) {
      const p = pick(ls, rs);
      out.push(p.side);
      if (p.from === 'remote') {
        takenHere = true;
      } else if (p.from === 'local') {
        takenThere = true;
      }
    } else if (ls) {
      out.push(ls);
      takenThere ||= ls.kind === 'live';
    } else if (rs) {
      out.push(rs);
      takenHere ||= rs.kind === 'live';
    }
  };
  for (const [id, ls] of local) {
    const rs = remote.get(id);
    if (rs) {
      take(ls, rs);
      local.delete(id);
      remote.delete(id);
    }
  }
  // Not the same id: the same name is the same assistant (the starter ones),
  // as long as one of the two is a live one.
  const byId = (a: Side, b: Side) => sideId(a).localeCompare(sideId(b));
  const leftLocal = [...local.values()].sort(byId);
  for (const rs of [...remote.values()].sort(byId)) {
    const name = sideName(rs);
    const i = name
      ? leftLocal.findIndex(
          ls =>
            sideName(ls) === name && (ls.kind === 'live' || rs.kind === 'live'),
        )
      : -1;
    if (i >= 0) {
      take(leftLocal.splice(i, 1)[0], rs);
    } else {
      take(undefined, rs);
    }
  }
  for (const ls of leftLocal) {
    take(ls, undefined);
  }
  const kept = new Set(
    pruneAssistantTombstones(
      out.filter(s => s.kind === 'dead').map(s => (s as any).t),
      now,
    ).map(t => t.id),
  );
  const list = out
    .filter(s => s.kind === 'live' || kept.has(s.t.id))
    .sort(byId)
    .map(s => (s.kind === 'live' ? s.e : s.t));
  return {text: JSON.stringify(list), takenHere, takenThere};
}

/** When each of your assistants last changed here (id → time). */
export async function editTimes(
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<Map<string, number>> {
  const now = store.now();
  const state = await store.load<Record<string, {print: string; at: number}>>(
    TIMES_KEY,
    {},
  );
  const next: Record<string, {print: string; at: number}> = {};
  const out = new Map<string, number>();
  for (const p of store.ownPals()) {
    const print = contentPrint(p);
    const seen = state[p.id];
    const known = Date.parse(p.updated_at ?? '');
    const at =
      seen && seen.print === print
        ? Math.min(seen.at, now)
        : !seen && Number.isFinite(known) && known > 0
          ? // First look (just updated): the database's own time.
            Math.min(known, now)
          : now;
    next[p.id] = {print, at};
    out.set(p.id, at);
  }
  await store.save(TIMES_KEY, next);
  return out;
}

/** This assistant now says this, as of `at` (taken from a sync, or restored). */
export async function setEditTime(
  pal: Partial<Pal> & {id: string},
  at: number,
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<void> {
  const state = await store.load<Record<string, {print: string; at: number}>>(
    TIMES_KEY,
    {},
  );
  state[pal.id] = {print: contentPrint(pal), at: Math.min(at, store.now())};
  await store.save(TIMES_KEY, state);
}

/** Deletions known here (sent with the assistants). */
export async function knownAssistantTombstones(
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<AssistantTombstone[]> {
  return pruneAssistantTombstones(
    await store.load<AssistantTombstone[]>(TOMBSTONES_KEY, []),
    store.now(),
  );
}

export async function addAssistantTombstones(
  list: AssistantTombstone[],
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<void> {
  if (!list.length) {
    return;
  }
  const mine = await store.load<AssistantTombstone[]>(TOMBSTONES_KEY, []);
  await store.save(
    TOMBSTONES_KEY,
    pruneAssistantTombstones([...mine, ...list], store.now()),
  );
}

/** Forget deletions of these assistants (they came back newer, or were kept). */
export async function forgetAssistantTombstones(
  ids: string[],
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<void> {
  if (!ids.length) {
    return;
  }
  const drop = new Set(ids);
  const mine = await store.load<AssistantTombstone[]>(TOMBSTONES_KEY, []);
  if (mine.some(t => t && drop.has(t.id))) {
    await store.save(
      TOMBSTONES_KEY,
      pruneAssistantTombstones(
        mine.filter(t => !drop.has(t.id)),
        store.now(),
      ),
    );
  }
}

/** The user deleted one of their own assistants here (always recorded; cheap). */
export async function recordAssistantDeleted(
  pal: Pal,
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<void> {
  if (!isOwn(pal) || !ASSISTANT_ID.test(pal.id)) {
    return;
  }
  await addAssistantTombstones(
    [{id: pal.id, name: pal.name, deletedAt: store.now()}],
    store,
  );
}

/** Within 30 days, newest first. */
export function pruneRecentAssistants(
  list: RecentlyDeletedAssistant[],
  now: number,
): RecentlyDeletedAssistant[] {
  return (Array.isArray(list) ? list : [])
    .filter(
      r =>
        r &&
        r.pal &&
        typeof r.pal.id === 'string' &&
        typeof r.removedAt === 'number' &&
        r.removedAt >= now - RECENT_DAYS * DAY,
    )
    .sort((a, b) => b.removedAt - a.removedAt);
}

/**
 * Keeps these assistants under "Recently deleted", then removes them; one
 * that doesn't fit in the room left is not removed. Returns the removed ids.
 */
async function removeKept(
  list: HeldAssistantDelete[],
  from: string,
  store: AssistantDeleteStore,
): Promise<string[]> {
  if (!list.length) {
    return [];
  }
  const now = store.now();
  const ids = new Set(list.map(h => h.pal.id));
  let kept: RecentlyDeletedAssistant[];
  try {
    kept = await store.load<RecentlyDeletedAssistant[]>(RECENT_KEY, []);
  } catch {
    // Can't be read: nothing can be kept, so nothing is removed.
    return [];
  }
  const recent = pruneRecentAssistants(kept, now).filter(
    r => !ids.has(r.pal.id),
  );
  let used = jsonBytes(recent);
  const added: RecentlyDeletedAssistant[] = [];
  for (const h of list) {
    const entry = {pal: h.pal, deletedAt: h.deletedAt, removedAt: now, from};
    const n = jsonBytes(entry) + 1;
    if (used + n > RECENT_ROOM) {
      continue;
    }
    added.push(entry);
    used += n;
  }
  if (!added.length) {
    return [];
  }
  await store.save(RECENT_KEY, [...added, ...recent]);
  for (const r of added) {
    await store.remove(r.pal.id);
  }
  await addAssistantTombstones(
    added.map(r => ({id: r.pal.id, name: r.pal.name, deletedAt: r.deletedAt})),
    store,
  );
  return added.map(r => r.pal.id);
}

/**
 * Deletions in an agreed list, against your own assistants here: one that
 * has not changed since it was deleted (matched by id, then by name; never
 * one the same list keeps) is removed and kept under Recently deleted; one
 * changed later stays. Too many at once: held, to ask.
 */
export async function applyAssistantTombstones(
  dead: AssistantTombstone[],
  /** Assistants here that the same list keeps (matched by a live entry). */
  keep: Set<string>,
  from: string,
  store: AssistantDeleteStore = deviceAssistantStore,
  cap = DELETE_CAP,
): Promise<{deleted: string[]; held: HeldAssistantDelete[]}> {
  if (!dead.length) {
    return {deleted: [], held: []};
  }
  const times = await editTimes(store);
  const own = store.ownPals().filter(p => !keep.has(p.id));
  const remove: HeldAssistantDelete[] = [];
  const taken = new Set<string>();
  for (const t of dead) {
    const here =
      own.find(p => p.id === t.id && !taken.has(p.id)) ??
      (t.name
        ? own.find(p => p.name === t.name && !taken.has(p.id))
        : undefined);
    if (!here) {
      continue;
    }
    taken.add(here.id);
    if ((times.get(here.id) ?? Infinity) <= t.deletedAt) {
      remove.push({pal: here, deletedAt: t.deletedAt});
    }
  }
  // Remembered, so this device passes them on (and doesn't bring them back).
  await addAssistantTombstones(dead, store);
  if (remove.length > cap) {
    return {deleted: [], held: remove};
  }
  return {deleted: await removeKept(remove, from, store), held: []};
}

/** The user said yes to held deletions. */
export function confirmHeldAssistants(
  held: HeldAssistantDelete[],
  from: string,
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<string[]> {
  return removeKept(held, from, store);
}

/**
 * The user kept held assistants: they count as edited now, so they win
 * over the deletion and come back on the other device.
 */
export async function keepHeldAssistants(
  held: HeldAssistantDelete[],
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<string[]> {
  const now = store.now();
  for (const h of held) {
    await setEditTime(h.pal, Math.max(now, h.deletedAt + 1), store);
  }
  const ids = held.map(h => h.pal.id);
  await forgetAssistantTombstones(ids, store);
  return ids;
}

/** Recently deleted assistants (from another device), newest first. */
export async function recentlyDeletedAssistants(
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<RecentlyDeletedAssistant[]> {
  const all = await store.load<RecentlyDeletedAssistant[]>(RECENT_KEY, []);
  const list = Array.isArray(all) ? all : [];
  const kept = pruneRecentAssistants(list, store.now());
  if (kept.length !== list.length) {
    await store.save(RECENT_KEY, kept);
    // Expired: its picture file is no longer needed (unless still in use).
    const inUse = new Set([
      ...store.ownPals().map(p => p.thumbnail_url),
      ...kept.map(r => r.pal.thumbnail_url),
    ]);
    for (const r of list) {
      const file = r?.pal?.thumbnail_url;
      if (file && !kept.includes(r) && !inUse.has(file)) {
        await store.dropPicture(file).catch(() => {});
      }
    }
  }
  return kept;
}

/**
 * Puts a recently deleted assistant back (same id). It counts as edited
 * now, so the next sync brings it back on the other device too.
 */
export async function restoreAssistant(
  id: string,
  store: AssistantDeleteStore = deviceAssistantStore,
): Promise<boolean> {
  const list = await recentlyDeletedAssistants(store);
  const entry = list.find(r => r.pal.id === id);
  if (!entry) {
    return false;
  }
  if (!store.ownPals().some(p => p.id === id)) {
    await store.recreate(entry.pal);
  }
  // Newer than the deletion, even within the same millisecond.
  await setEditTime(
    entry.pal,
    Math.max(store.now(), entry.deletedAt + 1),
    store,
  );
  await forgetAssistantTombstones([id], store);
  await store.save(
    RECENT_KEY,
    list.filter(r => r !== entry),
  );
  return true;
}

/** "2 assistants deleted on the PC; kept 30 days under Recently deleted". */
export function describeAssistantDeletes(n: number, where: string): string {
  return `${n} assistant${n === 1 ? '' : 's'} deleted on ${where}; kept ${RECENT_DAYS} days under Recently deleted`;
}

let asking = false;

/** Too many deletions at once: ask (never removed without an answer). */
export function askAboutHeldAssistants(
  held: HeldAssistantDelete[],
  from: string,
  done: (r: {deleted: string[]; kept: string[]}) => void = () => {},
  store: AssistantDeleteStore = deviceAssistantStore,
): void {
  if (asking) {
    // Already asked; the next sync asks again for what is still held.
    return;
  }
  asking = true;
  const answered = () => {
    asking = false;
  };
  Alert.alert(
    'Delete assistants?',
    `${held.length} of your assistants were deleted on ${from}: ${held
      .map(h => h.pal.name)
      .join(
        ', ',
      )}. Delete them here too? They are kept ${RECENT_DAYS} days under Recently deleted. If you keep them, they come back on ${from}.`,
    [
      {
        text: 'Keep them',
        style: 'cancel',
        onPress: () => {
          answered();
          keepHeldAssistants(held, store)
            .then(kept => done({deleted: [], kept}))
            .catch(() => {});
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          answered();
          confirmHeldAssistants(held, from, store)
            .then(deleted => done({deleted, kept: []}))
            .catch(() => {});
        },
      },
    ],
    {cancelable: true, onDismiss: answered},
  );
}

/** For tests. */
export function resetAskingAssistants(): void {
  asking = false;
}
