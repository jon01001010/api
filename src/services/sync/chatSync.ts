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
 * ids on both devices. Deleting a chat travels too, as a tombstone (id and
 * when; chatDeletes.ts): it removes the other device's copy only if that
 * copy has not changed since, and the removed copy is kept 30 days under
 * "Recently deleted" there. Pictures in messages are files on one device
 * only: their paths (and anything else naming a file) never travel; only
 * known message metadata does (`mirroredMetadata`), and only messages from
 * the user or the assistant. A copy that drops messages this device has
 * keeps the earlier version under "Recently deleted" (chatDeletes.ts).
 */
import {Q} from '@nozbe/watermelondb';

import {database} from '../../database';
import {assistantId, userId} from '../../utils/chat';
import {isMirrored, withMirrorMark} from './mirrorMark';
import {clampTime, fingerprint} from './promptSync';

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

/** A chat deleted on some device: its id, and when (ms). */
export interface Tombstone {
  id: string;
  deletedAt: number;
}

/** Chat and message ids that may come from another device. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Same as SUMMARY_AUTHOR_ID in chatSummary.ts (that module loads the stores). */
export const SUMMARY_AUTHOR = 'pocketagent-context-summary';
/** Who may have written a mirrored message: the user, the assistant, a summary. */
export const MIRRORED_AUTHORS: readonly string[] = [
  userId,
  assistantId,
  SUMMARY_AUTHOR,
];
/** Message kinds this app saves (others carry files or URIs: dropped). */
export const MIRRORED_TYPES: readonly string[] = ['text', 'assistant_turn'];

/**
 * A text that points at a file or folder on a device: never mirrored in
 * metadata (pictures and files stay on the device they are on).
 */
const PATH_LIKE =
  /file:|content:|\/data\/|\/pocketagent\/|\/storage\/|\/sdcard\//i;

const hasPath = (v: unknown): boolean => {
  if (typeof v === 'string') {
    return PATH_LIKE.test(v);
  }
  if (Array.isArray(v)) {
    return v.some(hasPath);
  }
  if (v && typeof v === 'object') {
    return Object.values(v).some(hasPath);
  }
  return false;
};

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isScalar = (v: unknown) =>
  typeof v === 'string' || typeof v === 'boolean' || isNum(v);

/** Keeps only these keys of an object, each passing its check (key order kept). */
function only(
  v: unknown,
  keys: Record<string, (x: unknown) => unknown>,
): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const check = keys[k];
    if (check) {
      const kept = check(x);
      if (kept !== undefined) {
        out[k] = kept;
      }
    }
  }
  return out;
}

const bool = (x: unknown) => (typeof x === 'boolean' ? x : undefined);
const num = (x: unknown) => (isNum(x) ? x : undefined);
const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
const scalar = (x: unknown) => (isScalar(x) ? x : undefined);
const numbers = (x: unknown) => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return undefined;
  }
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(x)) {
    if (isNum(n)) {
      out[k] = n;
    }
  }
  return out;
};
const json = (x: unknown) => {
  try {
    return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
};

const TOOL_CALL = {
  id: str,
  type: str,
  function: (x: unknown) => {
    const f = only(x, {
      name: str,
      arguments: (a: unknown) => (typeof a === 'string' ? a : json(a)),
    });
    return f && typeof f.name === 'string' ? f : undefined;
  },
  metrics: (x: unknown) => only(x, {tokens: num, durationMs: num}),
  extra_content: json,
};

/** A tool's result, as text only (an audio file's path is not mirrored). */
const toolResult = (x: unknown) => {
  const r = only(x, {
    type: str,
    summary: str,
    html: str,
    title: str,
    query: str,
    errorMessage: str,
    links: (l: unknown) =>
      Array.isArray(l) ? l.filter(i => typeof i === 'string') : undefined,
    results: (l: unknown) =>
      Array.isArray(l)
        ? l
            .map(i => only(i, {title: str, url: str, snippet: str}))
            .filter(Boolean)
        : undefined,
  });
  if (!r || typeof r.summary !== 'string') {
    return undefined;
  }
  if (!['html', 'text', 'search', 'error'].includes(String(r.type))) {
    return {type: 'text', summary: r.summary};
  }
  return r;
};

const STEP = {
  content: str,
  reasoningContent: str,
  partial: bool,
  toolCalls: (l: unknown) =>
    Array.isArray(l)
      ? l.map(c => only(c, TOOL_CALL)).filter(c => c?.function)
      : undefined,
  toolOutcomes: (l: unknown) =>
    Array.isArray(l)
      ? l
          .map(o => {
            const out = only(o, {
              callId: str,
              toolName: str,
              responseContent: str,
              result: toolResult,
            });
            return out?.result ? out : undefined;
          })
          .filter(Boolean)
      : undefined,
};

/**
 * Message metadata keys that are mirrored, each with its check. Everything
 * else (pictures' `imageUris`, anything naming a file) stays on its device.
 */
const METADATA: Record<string, (x: unknown) => unknown> = {
  contextId: scalar,
  conversationId: scalar,
  copyable: bool,
  multimodal: bool,
  system: bool,
  interrupted: bool,
  truncationLikely: bool,
  hitMaxTurns: bool,
  contextSummary: bool,
  summarizedCount: num,
  keptIds: (l: unknown) =>
    Array.isArray(l)
      ? l.filter(i => typeof i === 'string' && ID_PATTERN.test(i))
      : undefined,
  timings: numbers,
  completionResult: (x: unknown) =>
    only(x, {
      content: str,
      reasoning_content: str,
      used: num,
      contextFull: bool,
      tokensPredicted: num,
      finishReason: str,
      isRemote: bool,
    }),
  // Names only: an `id` here would replace the message's author.
  authorData: (x: unknown) =>
    only(x, {firstName: str, lastName: str, role: str}),
  steps: (l: unknown) =>
    Array.isArray(l) ? l.map(st => only(st, STEP)).filter(Boolean) : undefined,
};

/**
 * A message's metadata as it may travel: known keys only, each checked; a
 * key (other than the reply's steps, which are shown as text) that names a
 * file or folder is dropped. Unchanged text when nothing was dropped.
 */
export function mirroredMetadata(raw: unknown): string {
  let parsed: unknown;
  try {
    parsed =
      typeof raw === 'string'
        ? raw
          ? JSON.parse(raw)
          : {}
        : raw && typeof raw === 'object'
          ? raw
          : {};
  } catch {
    return '{}';
  }
  const cleaned = only(parsed, METADATA) ?? {};
  for (const k of Object.keys(cleaned)) {
    if (k !== 'steps' && hasPath(cleaned[k])) {
      delete cleaned[k];
    }
  }
  const text = JSON.stringify(cleaned);
  return text === JSON.stringify(parsed) && typeof raw === 'string'
    ? raw
    : text;
}

/** A message as it may travel, or null (unknown author or kind). */
export function mirroredMessage(
  m: any,
  sessionId: string,
  now = Date.now(),
): (Record<string, unknown> & {id: string}) | null {
  if (
    !m ||
    typeof m.id !== 'string' ||
    !ID_PATTERN.test(m.id) ||
    m.session_id !== sessionId ||
    !MIRRORED_AUTHORS.includes(m.author) ||
    !MIRRORED_TYPES.includes(m.type)
  ) {
    return null;
  }
  return {
    id: m.id,
    session_id: sessionId,
    author: m.author,
    text: typeof m.text === 'string' ? m.text : undefined,
    type: m.type,
    created_at: clampTime(isNum(m.created_at) ? m.created_at : 0, now),
    metadata: mirroredMetadata(m.metadata),
    position: isNum(m.position) ? m.position : 0,
  };
}

/**
 * Is this copy of a chat gone by a deletion? Only if it has not changed
 * since the chat was deleted (a newer edit wins over a deletion).
 */
export function deletedBy(
  v: ChatVersion,
  tombstones: Map<string, number>,
): boolean {
  const at = tombstones.get(v.id);
  return at !== undefined && v.at <= at;
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

const versions = new WeakMap<ChatRecord, ChatVersion>();

/**
 * A chat's version. Metadata counts as it travels (`mirroredMetadata`), so
 * a copy that lost its pictures' paths on the way is the same version.
 */
export function versionOf(chat: ChatRecord): ChatVersion {
  const known = versions.get(chat);
  if (known) {
    return known;
  }
  const parts = [
    String(chat.session.title ?? ''),
    String(chat.session.pinned ?? ''),
    ...chat.messages.map(
      m =>
        `${m.id}|${m.text ?? ''}|${mirroredMetadata(m.metadata)}|${m.position}`,
    ),
  ];
  const at = Math.max(
    Number(chat.session.updated_at) || 0,
    ...chat.messages.map(m => Number(m.created_at) || 0),
  );
  const v = {
    id: chat.session.id,
    at,
    print: fingerprint(parts.join('\n')),
    count: chat.messages.length,
  };
  versions.set(chat, v);
  return v;
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

/**
 * Only well-formed chats from the other device, as they may be kept here:
 * known fields of the right kind, times no later than a few minutes ahead
 * (a clock far ahead can't make a chat win forever), messages only from the
 * user or the assistant and of the kinds this app saves, metadata cleaned
 * (`mirroredMetadata`). A chat with a message from another chat is dropped.
 */
export function cleanChats(raw: unknown, now = Date.now()): ChatRecord[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ChatRecord[] = [];
  for (const c of list as any[]) {
    if (
      !c ||
      !c.session ||
      typeof c.session.id !== 'string' ||
      !ID_PATTERN.test(c.session.id) ||
      !Array.isArray(c.messages)
    ) {
      continue;
    }
    const id: string = c.session.id;
    if (
      c.messages.some(
        (m: any) =>
          !m ||
          typeof m.id !== 'string' ||
          !ID_PATTERN.test(m.id) ||
          m.session_id !== id,
      )
    ) {
      continue;
    }
    const s = c.session;
    const session: ChatRecord['session'] = {id};
    for (const f of ['title', 'date', 'active_pal_id', 'settings_source']) {
      if (typeof s[f] === 'string') {
        session[f] = s[f];
      }
    }
    if (typeof s.pinned === 'boolean') {
      session.pinned = s.pinned;
    }
    for (const f of ['created_at', 'updated_at']) {
      if (isNum(s[f])) {
        session[f] = clampTime(s[f], now);
      }
    }
    const messages = c.messages
      .map((m: any) => mirroredMessage(m, id, now))
      .filter(Boolean) as ChatRecord['messages'];
    out.push({session, messages});
  }
  return out;
}

/**
 * Writes chats here, as they are on the other device (same ids): the chat
 * itself, and its messages replaced by the other device's. With `from` (a
 * sync), each message is marked as mirrored (`mirrorMark.ts`), except one
 * that was already here unmarked with the same author and text (typed
 * here, back from the other device unchanged). Without it (restoring a
 * kept version here), messages are written as they are.
 */
export async function writeChats(
  chats: ChatRecord[],
  opts: {from?: string} = {},
): Promise<void> {
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
      const typedHere = new Map<string, {author: unknown; text: unknown}>();
      if (existing) {
        ops.push(existing.prepareUpdate(setSession));
        const old = await messagesTable
          .query(Q.where('session_id', id))
          .fetch();
        for (const m of old as any[]) {
          if (!isMirrored(m._raw?.metadata)) {
            typedHere.set(m.id, {author: m._raw?.author, text: m._raw?.text});
          }
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
        const here = typedHere.get(m.id);
        const mark =
          opts.from !== undefined &&
          !(here && here.author === m.author && here.text === m.text);
        ops.push(
          messagesTable.prepareCreate((r: any) => {
            r._raw.id = m.id;
            for (const f of MESSAGE_FIELDS) {
              if (m[f] !== undefined) {
                r._raw[f] = m[f];
              }
            }
            if (mark) {
              r._raw.metadata = withMirrorMark(m.metadata, opts.from!);
            }
          }),
        );
      }
    }
    await database.batch(...ops);
  });
}

/**
 * The PC side: take newer chats from the device, pick what to send back.
 * `known`: deletions known here (a deleted chat is taken again only if it
 * changed after it was deleted; `revived` names those); `hold`: chats not
 * to send (a deletion waiting for the user's answer).
 */
export async function mirrorOnPc(
  incoming: unknown,
  deviceVersions: unknown,
  budget: number,
  deps: {
    read: () => Promise<Map<string, ChatRecord>>;
    write: (chats: ChatRecord[]) => Promise<void>;
  } = {read: readAllChats, write: writeChats},
  known: {
    tombstones?: Tombstone[];
    hold?: Set<string>;
    /** Before writing: keeps what is replaced, returns what may be written. */
    keep?: (
      local: Map<string, ChatRecord>,
      chats: ChatRecord[],
    ) => Promise<ChatRecord[]>;
  } = {},
): Promise<{taken: number; send: ChatRecord[]; revived: string[]}> {
  const local = await deps.read();
  const gone = new Map(
    (known.tombstones ?? []).map(t => [t.id, t.deletedAt] as const),
  );
  let taken: ChatRecord[] = [];
  for (const chat of cleanChats(incoming)) {
    const here = local.get(chat.session.id);
    const v = versionOf(chat);
    if (deletedBy(v, gone)) {
      continue;
    }
    if (!here || isNewer(v, versionOf(here))) {
      taken.push(chat);
    }
  }
  if (known.keep) {
    taken = await known.keep(local, taken);
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
    if (takenIds.has(chat.session.id) || known.hold?.has(chat.session.id)) {
      continue;
    }
    const mine = versionOf(chat);
    if (deletedBy(mine, gone)) {
      continue;
    }
    const their = theirs.get(chat.session.id);
    if (!their || (their.print !== mine.print && isNewer(mine, their))) {
      send.push(chat);
    }
  }
  return {
    taken: taken.length,
    send: within(send, budget),
    revived: [...takenIds].filter(id => gone.has(id)),
  };
}

/** Room left for chats in one sync (the link carries 4 MB each way). */
export const SYNC_ROOM = 3_500_000;
