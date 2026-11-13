/**
 * Mirrored chats between paired devices (TODO "Chats mirrored"), over the
 * same link as keeping in step. Off until switched on: the PC's "Mirror
 * chats" and the device's "Mirror chats with this PC".
 *
 * Each chat's version is a fingerprint of its messages plus the time of its
 * newest change. The device sends the versions of all its chats and the
 * chats that changed since it last synced with this PC; the PC takes the
 * newer ones and sends back what the device is missing or has older (newest
 * first, within a size budget; the rest comes next time). Chats keep their
 * ids on both devices. Not (yet): deleting a chat on one device deletes it
 * on the other; pictures in messages are files on one device only.
 */
import {Q} from '@nozbe/watermelondb';

import {database} from '../../database';
import {fingerprint} from './promptSync';

const SESSION_FIELDS = [
  'title',
  'date',
  'active_pal_id',
  'settings_source',
  'pinned',
  'created_at',
  'updated_at',
] as const;
const MESSAGE_FIELDS = [
  'session_id',
  'author',
  'text',
  'type',
  'created_at',
  'metadata',
  'position',
] as const;

export interface ChatRecord {
  session: Record<string, unknown> & {id: string};
  messages: (Record<string, unknown> & {id: string})[];
}

export interface ChatVersion {
  id: string;
  /** Newest change (ms). */
  at: number;
  print: string;
  count: number;
}

const pick = (raw: any, fields: readonly string[]) => {
  const out: Record<string, unknown> = {id: raw.id};
  for (const f of fields) {
    out[f] = raw[f];
  }
  return out as Record<string, unknown> & {id: string};
};

/** Every chat on this device, with its messages (in order). */
export async function readAllChats(): Promise<Map<string, ChatRecord>> {
  const sessions = await database.collections
    .get('chat_sessions')
    .query()
    .fetch();
  const messages = await database.collections.get('messages').query().fetch();
  const chats = new Map<string, ChatRecord>();
  for (const s of sessions as any[]) {
    chats.set(s.id, {session: pick(s._raw, SESSION_FIELDS), messages: []});
  }
  for (const m of messages as any[]) {
    const chat = chats.get(m._raw.session_id);
    if (chat) {
      chat.messages.push(pick(m._raw, MESSAGE_FIELDS));
    }
  }
  for (const chat of chats.values()) {
    chat.messages.sort(
      (a, b) =>
        Number(a.position) - Number(b.position) || a.id.localeCompare(b.id),
    );
  }
  return chats;
}

export function versionOf(chat: ChatRecord): ChatVersion {
  const parts = [
    String(chat.session.title ?? ''),
    String(chat.session.pinned ?? ''),
    ...chat.messages.map(
      m => `${m.id}|${m.text ?? ''}|${m.metadata ?? ''}|${m.position}`,
    ),
  ];
  const at = Math.max(
    Number(chat.session.updated_at) || 0,
    ...chat.messages.map(m => Number(m.created_at) || 0),
  );
  return {
    id: chat.session.id,
    at,
    print: fingerprint(parts.join('\n')),
    count: chat.messages.length,
  };
}

/** Is `a` newer than `b` (same answer on both devices)? */
export function isNewer(a: ChatVersion, b: ChatVersion): boolean {
  if (a.at !== b.at) {
    return a.at > b.at;
  }
  if (a.count !== b.count) {
    return a.count > b.count;
  }
  return a.print > b.print;
}

const size = (c: ChatRecord) => JSON.stringify(c).length;

/** Newest first, as many as fit in `budget` characters. */
export function within(chats: ChatRecord[], budget: number): ChatRecord[] {
  const sorted = [...chats].sort((a, b) =>
    isNewer(versionOf(a), versionOf(b)) ? -1 : 1,
  );
  const out: ChatRecord[] = [];
  let used = 0;
  for (const c of sorted) {
    const n = size(c);
    if (used + n > budget) {
      continue;
    }
    out.push(c);
    used += n;
  }
  return out;
}

/** Only well-formed chats from the other device. */
export function cleanChats(raw: unknown): ChatRecord[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter(
    (c: any) =>
      c &&
      c.session &&
      typeof c.session.id === 'string' &&
      /^[A-Za-z0-9_-]{1,64}$/.test(c.session.id) &&
      Array.isArray(c.messages) &&
      c.messages.every(
        (m: any) =>
          m &&
          typeof m.id === 'string' &&
          /^[A-Za-z0-9_-]{1,64}$/.test(m.id) &&
          m.session_id === c.session.id,
      ),
  );
}

/**
 * Writes chats here, as they are on the other device (same ids): the chat
 * itself, and its messages replaced by the other device's.
 */
export async function writeChats(chats: ChatRecord[]): Promise<void> {
  if (!chats.length) {
    return;
  }
  const sessionsTable = database.collections.get('chat_sessions');
  const messagesTable = database.collections.get('messages');
  await database.write(async () => {
    const ops: any[] = [];
    for (const chat of chats) {
      const id = chat.session.id;
      const existing: any = await sessionsTable.find(id).catch(() => null);
      const setSession = (r: any) => {
        for (const f of SESSION_FIELDS) {
          if (chat.session[f] !== undefined) {
            r._raw[f] = chat.session[f];
          }
        }
      };
      if (existing) {
        ops.push(existing.prepareUpdate(setSession));
        const old = await messagesTable
          .query(Q.where('session_id', id))
          .fetch();
        for (const m of old as any[]) {
          ops.push(m.prepareDestroyPermanently());
        }
      } else {
        ops.push(
          sessionsTable.prepareCreate((r: any) => {
            r._raw.id = id;
            setSession(r);
          }),
        );
      }
      for (const m of chat.messages) {
        ops.push(
          messagesTable.prepareCreate((r: any) => {
            r._raw.id = m.id;
            for (const f of MESSAGE_FIELDS) {
              if (m[f] !== undefined) {
                r._raw[f] = m[f];
              }
            }
          }),
        );
      }
    }
    await database.batch(...ops);
  });
}

/** The PC side: take newer chats from the device, pick what to send back. */
export async function mirrorOnPc(
  incoming: unknown,
  deviceVersions: unknown,
  budget: number,
  deps: {
    read: () => Promise<Map<string, ChatRecord>>;
    write: (chats: ChatRecord[]) => Promise<void>;
  } = {read: readAllChats, write: writeChats},
): Promise<{taken: number; send: ChatRecord[]}> {
  const local = await deps.read();
  const taken: ChatRecord[] = [];
  for (const chat of cleanChats(incoming)) {
    const here = local.get(chat.session.id);
    if (!here || isNewer(versionOf(chat), versionOf(here))) {
      taken.push(chat);
    }
  }
  await deps.write(taken);
  const takenIds = new Set(taken.map(c => c.session.id));
  const theirs = new Map<string, ChatVersion>();
  for (const v of Array.isArray(deviceVersions) ? deviceVersions : []) {
    if (v && typeof v.id === 'string') {
      theirs.set(v.id, v as ChatVersion);
    }
  }
  const send: ChatRecord[] = [];
  for (const chat of local.values()) {
    if (takenIds.has(chat.session.id)) {
      continue;
    }
    const mine = versionOf(chat);
    const their = theirs.get(chat.session.id);
    if (!their || (their.print !== mine.print && isNewer(mine, their))) {
      send.push(chat);
    }
  }
  return {taken: taken.length, send: within(send, budget)};
}

/** Room left for chats in one sync (the link carries 4 MB each way). */
export const SYNC_ROOM = 3_500_000;
