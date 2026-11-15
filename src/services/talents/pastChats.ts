/**
 * Memory search over earlier chats (Toolbox → What the model sees → Memory,
 * "Also search earlier chats"; off by default).
 *
 * Only the user's own typed messages are searched (not replies, tool output
 * or pages), and only those typed on this device: a message that came from
 * another device in a mirrored chat carries a local mark (mirrorMark.ts)
 * and is skipped, so a paired device can't plant "your own words" here
 * (security review 2, finding 5). Only in chats still on this device: a deleted chat is gone from
 * the database, and a chat with a deletion tombstone is skipped as well.
 * The chat being written in is left out (the model already has it).
 */
import {isMirrored} from '../sync/mirrorMark';

import {bm25Rank, tokenize, type QueryPart} from './memorySearch';

export interface PastChatMessage {
  sessionId: string;
  title: string;
  /** The chat's date (as stored). */
  date: string;
  text: string;
  createdAt: number;
}

export interface PastChatSnippet {
  sessionId: string;
  title: string;
  /** YYYY-MM-DD, or '' when unknown. */
  day: string;
  text: string;
}

export const MAX_SNIPPETS = 3;
export const SNIPPET_CHARS = 240;
/** Only the newest messages are searched, so a send stays quick. */
export const MAX_SEARCHED_MESSAGES = 2000;

const dayOf = (date: string | number): string => {
  const d = new Date(date);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

/** A short piece of the message around its first matching word. */
export function snippetAround(
  text: string,
  query: string | QueryPart[],
  max = SNIPPET_CHARS,
): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) {
    return flat;
  }
  const wanted = new Set(
    tokenize(
      typeof query === 'string' ? query : query.map(q => q.text).join(' '),
    ),
  );
  const lower = flat.toLowerCase();
  let at = -1;
  // First word of the message whose token is in the query.
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower))) {
    if (tokenize(m[0]).some(t => wanted.has(t))) {
      at = m.index;
      break;
    }
  }
  const start = Math.max(0, Math.min(at < 0 ? 0 : at - 60, flat.length - max));
  const piece = flat.slice(start, start + max).trim();
  return (
    (start > 0 ? '…' : '') + piece + (start + max < flat.length ? '…' : '')
  );
}

/** Up to `max` snippets, best first, one per chat. */
export function pickPastSnippets(
  messages: PastChatMessage[],
  query: string | QueryPart[],
  max = MAX_SNIPPETS,
): PastChatSnippet[] {
  const ranked = bm25Rank(
    messages.map(m => m.text),
    query,
  );
  const seen = new Set<string>();
  const out: PastChatSnippet[] = [];
  for (const {index} of ranked) {
    if (out.length >= max) {
      break;
    }
    const m = messages[index];
    if (seen.has(m.sessionId)) {
      continue;
    }
    seen.add(m.sessionId);
    out.push({
      sessionId: m.sessionId,
      title: m.title,
      day: dayOf(m.date) || dayOf(m.createdAt),
      text: snippetAround(m.text, query),
    });
  }
  return out;
}

/** Snippets as plain lines, labelled with the chat's title and date. */
export function formatPastSnippets(snippets: PastChatSnippet[]): string {
  return snippets
    .map(s => {
      const title =
        s.title.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled chat';
      return `From "${title}"${s.day ? ` (${s.day})` : ''}: ${s.text}`;
    })
    .join('\n');
}

/** Ids of chats deleted here or on a mirrored device (tombstones). */
async function deletedChatIds(): Promise<Set<string>> {
  try {
    const {TOMBSTONES_KEY} = require('../sync/chatDeletes');
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default;
    const raw = await AsyncStorage.getItem(TOMBSTONES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(list)
        ? list
            .map((t: any) => t?.id)
            .filter((id: any) => typeof id === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

/** The user's own messages in earlier chats still on this device, newest first. */
export async function loadPastChatMessages(
  excludeSessionId: string | null | undefined,
): Promise<PastChatMessage[]> {
  const {Q} = require('@nozbe/watermelondb');
  const {database} = require('../../database');
  const {userId} = require('../../utils/chat');
  const [sessions, deleted] = await Promise.all([
    database.collections.get('chat_sessions').query().fetch(),
    deletedChatIds(),
  ]);
  const byId = new Map<string, {title: string; date: string}>();
  for (const s of sessions as any[]) {
    if (s.id !== excludeSessionId && !deleted.has(s.id)) {
      byId.set(s.id, {
        title: String(s.title ?? ''),
        date: String(s.date ?? ''),
      });
    }
  }
  if (!byId.size) {
    return [];
  }
  const rows = await database.collections
    .get('messages')
    .query(
      Q.where('author', userId),
      Q.where('type', 'text'),
      Q.sortBy('created_at', Q.desc),
      Q.take(MAX_SEARCHED_MESSAGES),
    )
    .fetch();
  const out: PastChatMessage[] = [];
  for (const row of rows as any[]) {
    // Checked here too, not only in the query: the user's own typed text only.
    if (row.author !== userId || row.type !== 'text') {
      continue;
    }
    // Typed on this device only: not a message from a mirrored chat.
    if (isMirrored(row._raw?.metadata ?? row.metadata)) {
      continue;
    }
    const chat = byId.get(row.sessionId);
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (chat && text) {
      out.push({
        sessionId: row.sessionId,
        title: chat.title,
        date: chat.date,
        text,
        createdAt: Number(row.createdAt) || 0,
      });
    }
  }
  return out;
}
