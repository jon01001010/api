/**
 * Deleting a chat travels with mirrored chats (TODO "Chats mirrored").
 *
 * Deleting a chat here leaves a tombstone: its id and when (the last 500,
 * 90 days at most). Syncs carry the tombstones both ways, inside the chats
 * part (so only while chats are mirrored on both devices). A tombstone
 * removes the other device's copy only if that copy has not changed since
 * the deletion (a newer edit wins, as everywhere in keeping in step); then
 * the tombstone is kept here too, so a third device doesn't bring it back.
 *
 * Nothing is lost silently: a chat removed because of another device's
 * deletion is kept 30 days under "Recently deleted" on this device (full
 * chat, its own size room; a chat that doesn't fit is not removed), and can
 * be restored (it then counts as a new edit, so it comes back on the other
 * device too). More than 20 at once are not removed without asking.
 *
 * Up to 3 versions of the same chat are kept (the first one kept, the
 * version from before any sync changed it, is never dropped for a later
 * one), so two syncs in a row can't push the original out. The list is
 * stored in parts (keptStore.ts: UTF-8 bytes, each part well under
 * Android's 2 MB read window), and a list that can't be read is never
 * saved over: nothing is then removed or replaced here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Alert} from 'react-native';

import {
  deletedBy,
  ID_PATTERN,
  mirroredMetadata,
  versionOf,
  writeChats,
  type ChatRecord,
  type Tombstone,
} from './chatSync';
import {CHUNK_BYTES, jsonBytes, loadChunked, saveChunked} from './keptStore';
import {MAX_CLOCK_SKEW} from './promptSync';

export const TOMBSTONES_KEY = '@pocketagent/sync/chat-tombstones/v1';
/** Before 2026-11-15: the whole list in one value (read until the next save). */
export const RECENT_KEY = '@pocketagent/sync/chats-recently-deleted/v1';
/** The list's index; its parts are under `${RECENT_KEY_V2}/chunk/...`. */
export const RECENT_KEY_V2 = '@pocketagent/sync/chats-recently-deleted/v2';

const DAY = 86_400_000;
export const MAX_TOMBSTONES = 500;
export const TOMBSTONE_DAYS = 90;
export const RECENT_DAYS = 30;
/** More deletions than this in one sync: ask first. */
export const DELETE_CAP = 20;
/** Room for "Recently deleted" (UTF-8 bytes, all parts together). */
export const RECENT_ROOM = 1_500_000;
/** Most versions of one chat kept at once. */
export const MAX_VERSIONS = 3;
/** Most one kept chat may take (it must fit in one stored part). */
export const MAX_ENTRY_BYTES = CHUNK_BYTES - 16;

/** A chat removed here because it was deleted on another device. */
export interface RecentlyDeleted {
  chat: ChatRecord;
  /** When it was deleted on the other device. */
  deletedAt: number;
  /** When it was removed here. */
  removedAt: number;
  /** Which device deleted it ("the PC", or the device's name). */
  from: string;
  /**
   * Not deleted: an earlier version of a chat that a mirrored copy replaced
   * (it had messages the new copy doesn't). Restoring puts it back.
   */
  replaced?: boolean;
}

/** A deletion waiting for the user's answer (too many at once). */
export interface HeldDelete {
  chat: ChatRecord;
  deletedAt: number;
}

/** Where deletions are kept and chats removed (injected in tests). */
export interface DeleteStore {
  now: () => number;
  loadTombstones: () => Promise<Tombstone[]>;
  saveTombstones: (list: Tombstone[]) => Promise<void>;
  loadRecent: () => Promise<RecentlyDeleted[]>;
  saveRecent: (list: RecentlyDeleted[]) => Promise<void>;
  removeChats: (ids: string[]) => Promise<void>;
  write: (chats: ChatRecord[]) => Promise<void>;
}

/** Only well-formed tombstones (one per id, the latest; none from the future). */
export function cleanTombstones(raw: unknown, now = Date.now()): Tombstone[] {
  const latest = new Map<string, number>();
  for (const t of Array.isArray(raw) ? raw : []) {
    if (
      t &&
      typeof t.id === 'string' &&
      ID_PATTERN.test(t.id) &&
      typeof t.deletedAt === 'number' &&
      Number.isFinite(t.deletedAt) &&
      t.deletedAt > 0 &&
      // A clock far ahead would delete every later edit: not taken.
      t.deletedAt <= now + MAX_CLOCK_SKEW
    ) {
      latest.set(t.id, Math.max(latest.get(t.id) ?? 0, t.deletedAt));
    }
  }
  return [...latest].map(([id, deletedAt]) => ({id, deletedAt}));
}

/** The newest 500, within 90 days. */
export function pruneTombstones(list: Tombstone[], now: number): Tombstone[] {
  return cleanTombstones(list, now)
    .filter(t => t.deletedAt >= now - TOMBSTONE_DAYS * DAY)
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, MAX_TOMBSTONES);
}

/** Within 30 days, newest first. */
export function pruneRecent(
  list: RecentlyDeleted[],
  now: number,
): RecentlyDeleted[] {
  return list
    .filter(
      r =>
        r &&
        r.chat?.session &&
        typeof r.removedAt === 'number' &&
        r.removedAt >= now - RECENT_DAYS * DAY,
    )
    .sort((a, b) => b.removedAt - a.removedAt);
}

/** Which kept entry (a chat can have up to 3 versions). */
export const entryKey = (r: RecentlyDeleted) =>
  `${r.chat.session.id}@${r.removedAt}${r.replaced ? 'r' : 'd'}`;

/**
 * At most MAX_VERSIONS per chat in a list: the newest ones and always the
 * oldest (the version from before the syncs changed it). Order kept.
 */
export function trimVersions(list: RecentlyDeleted[]): RecentlyDeleted[] {
  const groups = new Map<string, RecentlyDeleted[]>();
  for (const r of list) {
    const id = r.chat.session.id;
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  const keep = new Set<RecentlyDeleted>();
  for (const g of groups.values()) {
    const byAge = [...g].sort((a, b) => b.removedAt - a.removedAt);
    if (byAge.length <= MAX_VERSIONS) {
      byAge.forEach(r => keep.add(r));
    } else {
      byAge.slice(0, MAX_VERSIONS - 1).forEach(r => keep.add(r));
      keep.add(byAge[byAge.length - 1]);
    }
  }
  return list.filter(r => keep.has(r));
}

/**
 * Adds entries to the kept list, each only if the list then still fits
 * (UTF-8 bytes; versions of the same chat beyond 3 make way first).
 * Returns the new list, the entries added and the chat ids that didn't fit.
 */
function addWithinRoom(
  recent: RecentlyDeleted[],
  entries: RecentlyDeleted[],
): {list: RecentlyDeleted[]; added: RecentlyDeleted[]; refused: string[]} {
  const size = new Map<RecentlyDeleted, number>();
  const bytes = (r: RecentlyDeleted) => {
    let n = size.get(r);
    if (n === undefined) {
      n = jsonBytes(r) + 1;
      size.set(r, n);
    }
    return n;
  };
  let list = trimVersions(recent);
  const added: RecentlyDeleted[] = [];
  const refused: string[] = [];
  for (const entry of entries) {
    const next = trimVersions([entry, ...list]);
    const total = next.reduce((sum, r) => sum + bytes(r), 2);
    if (bytes(entry) > MAX_ENTRY_BYTES || total > RECENT_ROOM) {
      refused.push(entry.chat.session.id);
      continue;
    }
    list = next;
    added.push(entry);
  }
  return {list, added, refused};
}

const readJson = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(key)) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
};

/** This device: AsyncStorage (localStorage in the desktop app), its chats. */
export const deviceStore: DeleteStore = {
  now: () => Date.now(),
  loadTombstones: () => readJson<Tombstone[]>(TOMBSTONES_KEY, []),
  saveTombstones: list =>
    AsyncStorage.setItem(TOMBSTONES_KEY, JSON.stringify(list)),
  // Throws when it can't be read (never taken as empty: keptStore.ts).
  loadRecent: () => loadChunked<RecentlyDeleted>(RECENT_KEY_V2, RECENT_KEY),
  saveRecent: list => saveChunked(RECENT_KEY_V2, list, RECENT_KEY),
  removeChats: async ids => {
    // Late requires: the stores import this module.
    const {
      chatSessionRepository,
    } = require('../../repositories/ChatSessionRepository');
    await chatSessionRepository.deleteSessions(ids);
    const {chatSessionStore} = require('../../store');
    if (ids.includes(chatSessionStore.activeSessionId)) {
      chatSessionStore.resetActiveSession();
    }
  },
  write: writeChats,
};

/** Deletions known here (to send, and to keep deleted chats from coming back). */
export async function knownTombstones(
  store: DeleteStore = deviceStore,
): Promise<Tombstone[]> {
  return pruneTombstones(await store.loadTombstones(), store.now());
}

async function addTombstones(list: Tombstone[], store: DeleteStore) {
  if (!list.length) {
    return;
  }
  const now = store.now();
  const mine = await store.loadTombstones();
  await store.saveTombstones(pruneTombstones([...mine, ...list], now));
}

/** Forget deletions of these chats (they came back newer, or were kept). */
export async function forgetTombstones(
  ids: string[],
  store: DeleteStore = deviceStore,
): Promise<void> {
  if (!ids.length) {
    return;
  }
  const drop = new Set(ids);
  const mine = await store.loadTombstones();
  await store.saveTombstones(
    pruneTombstones(
      mine.filter(t => !drop.has(t.id)),
      store.now(),
    ),
  );
}

/** The user deleted these chats here (always recorded; cheap). */
export async function recordChatsDeleted(
  ids: string[],
  store: DeleteStore = deviceStore,
): Promise<void> {
  const at = store.now();
  await addTombstones(
    ids.filter(id => ID_PATTERN.test(id)).map(id => ({id, deletedAt: at})),
    store,
  );
}

/**
 * Keeps these chats under "Recently deleted", then removes them; a chat
 * that doesn't fit in the room left is not removed. Returns the removed ids.
 */
async function removeKept(
  list: HeldDelete[],
  from: string,
  store: DeleteStore,
): Promise<string[]> {
  if (!list.length) {
    return [];
  }
  const now = store.now();
  let recent: RecentlyDeleted[];
  try {
    recent = pruneRecent(await store.loadRecent(), now);
  } catch {
    // Can't be read: nothing can be kept, so nothing is removed.
    return [];
  }
  const fit = addWithinRoom(
    recent,
    list.map(h => ({
      chat: h.chat,
      deletedAt: h.deletedAt,
      removedAt: now,
      from,
    })),
  );
  const added = fit.added;
  if (!added.length) {
    return [];
  }
  await store.saveRecent(fit.list);
  const removed = added.map(r => r.chat.session.id);
  await store.removeChats(removed);
  await addTombstones(
    added.map(r => ({id: r.chat.session.id, deletedAt: r.deletedAt})),
    store,
  );
  return removed;
}

/** Messages of `here` that `next` drops or changes. */
export function messagesLost(here: ChatRecord, next: ChatRecord): number {
  const theirs = new Map(next.messages.map(m => [m.id, m] as const));
  return here.messages.filter(m => {
    const t = theirs.get(m.id);
    return (
      !t ||
      t.text !== m.text ||
      mirroredMetadata(t.metadata) !== mirroredMetadata(m.metadata)
    );
  }).length;
}

/**
 * Mirrored copies about to replace chats here: a copy that drops or changes
 * messages this device has keeps the chat as it is here under "Recently
 * deleted" (as an earlier version, 30 days, restorable; up to 3 per chat,
 * the first one always kept). A copy whose earlier version can't be kept
 * (no room left, or the list can't be read) is not taken. Returns the
 * copies that may be written.
 */
export async function keepEarlierVersions(
  local: Map<string, ChatRecord>,
  incoming: ChatRecord[],
  from: string,
  store: DeleteStore = deviceStore,
): Promise<ChatRecord[]> {
  const replacing = incoming.filter(c => {
    const here = local.get(c.session.id);
    return here && here.messages.length && messagesLost(here, c) > 0;
  });
  if (!replacing.length) {
    return incoming;
  }
  const now = store.now();
  let recent: RecentlyDeleted[];
  try {
    recent = pruneRecent(await store.loadRecent(), now);
  } catch {
    // Can't be read: the earlier versions can't be kept, so not replaced.
    const ids = new Set(replacing.map(c => c.session.id));
    return incoming.filter(c => !ids.has(c.session.id));
  }
  const fit = addWithinRoom(
    recent,
    replacing.map(c => ({
      chat: local.get(c.session.id)!,
      // When the copy that replaced it changed: a restore must be newer.
      deletedAt: Math.max(now, versionOf(c).at),
      removedAt: now,
      from,
      replaced: true,
    })),
  );
  if (fit.added.length) {
    await store.saveRecent(fit.list);
  }
  const refused = new Set(fit.refused);
  return incoming.filter(c => !refused.has(c.session.id));
}

/**
 * Deletions from another device, against the chats here: a chat that has
 * not changed since it was deleted is removed (kept under Recently
 * deleted); one changed later stays. Too many at once: held, to ask.
 */
export async function applyTombstones(
  local: Map<string, ChatRecord>,
  incoming: unknown,
  from: string,
  store: DeleteStore = deviceStore,
  cap = DELETE_CAP,
): Promise<{deleted: string[]; held: HeldDelete[]; survived: string[]}> {
  const list = cleanTombstones(incoming, store.now());
  const at = new Map(list.map(t => [t.id, t.deletedAt] as const));
  const remove: HeldDelete[] = [];
  const absent: Tombstone[] = [];
  const survived: string[] = [];
  for (const t of list) {
    const here = local.get(t.id);
    if (!here) {
      absent.push(t);
    } else if (deletedBy(versionOf(here), at)) {
      remove.push({chat: here, deletedAt: t.deletedAt});
    } else {
      survived.push(t.id);
    }
  }
  // Already gone here: remember, so this device doesn't bring it back either.
  await addTombstones(absent, store);
  if (remove.length > cap) {
    return {deleted: [], held: remove, survived};
  }
  return {deleted: await removeKept(remove, from, store), held: [], survived};
}

/** The user said yes to held deletions. */
export async function confirmHeld(
  held: HeldDelete[],
  from: string,
  store: DeleteStore = deviceStore,
): Promise<string[]> {
  return removeKept(held, from, store);
}

/**
 * The user kept held chats: they count as edited now, so they win over the
 * deletion and come back on the other device.
 */
export async function keepHeld(
  held: HeldDelete[],
  store: DeleteStore = deviceStore,
): Promise<string[]> {
  const now = store.now();
  const chats = held.map(h => ({
    ...h.chat,
    session: {...h.chat.session, updated_at: Math.max(now, h.deletedAt + 1)},
  }));
  await store.write(chats);
  const ids = chats.map(c => c.session.id);
  await forgetTombstones(ids, store);
  return ids;
}

/** Recently deleted (from another device), newest first. */
export async function recentlyDeleted(
  store: DeleteStore = deviceStore,
): Promise<RecentlyDeleted[]> {
  const now = store.now();
  const all = await store.loadRecent();
  const kept = pruneRecent(Array.isArray(all) ? all : [], now);
  if (kept.length !== all.length) {
    await store.saveRecent(kept);
  }
  return kept;
}

/**
 * Puts a recently deleted chat back (`key`: an entry's `entryKey`, or a
 * chat id for its newest kept version). It counts as edited now, so the
 * next sync brings it back on the other device too.
 */
export async function restoreDeleted(
  key: string,
  store: DeleteStore = deviceStore,
): Promise<boolean> {
  const list = await recentlyDeleted(store);
  const entry =
    list.find(r => entryKey(r) === key) ??
    list.find(r => r.chat.session.id === key);
  if (!entry) {
    return false;
  }
  await store.write([
    {
      ...entry.chat,
      session: {
        ...entry.chat.session,
        // Newer than the deletion, even within the same millisecond.
        updated_at: Math.max(store.now(), entry.deletedAt + 1),
      },
    },
  ]);
  await forgetTombstones([entry.chat.session.id], store);
  await store.saveRecent(list.filter(r => r !== entry));
  return true;
}

/** "2 chats deleted on the PC; kept 30 days under Recently deleted". */
export function describeDeletes(n: number, where: string): string {
  return `${n} chat${n === 1 ? '' : 's'} deleted on ${where}; kept ${RECENT_DAYS} days under Recently deleted`;
}

let asking = false;

/** Too many deletions at once: ask; `done` gets the ids that changed here. */
export function askAboutHeld(
  held: HeldDelete[],
  from: string,
  done: (r: {deleted: string[]; kept: string[]}) => void,
  store: DeleteStore = deviceStore,
): void {
  if (asking) {
    // Already asked; the answer covers the next sync's deletions too.
    return;
  }
  asking = true;
  const answered = () => {
    asking = false;
  };
  Alert.alert(
    'Delete chats?',
    `${held.length} chats were deleted on ${from}. Delete them here too? They are kept ${RECENT_DAYS} days under Recently deleted. If you keep them, they come back on ${from}.`,
    [
      {
        text: 'Keep them',
        style: 'cancel',
        onPress: () => {
          answered();
          keepHeld(held, store)
            .then(kept => done({deleted: [], kept}))
            .catch(() => {});
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          answered();
          confirmHeld(held, from, store)
            .then(deleted => done({deleted, kept: []}))
            .catch(() => {});
        },
      },
    ],
    {cancelable: true, onDismiss: answered},
  );
}
