/**
 * Keeping the system prompt and memory in step between paired devices
 * (TODO "Sync phone and PC"). Off until switched on, on both devices. Runs
 * over the home link only (encrypted, paired devices only).
 *
 * Each item (the system prompt, your memory notes, the model's notes) has
 * the time it last changed on that device. When two devices meet, for each
 * item the newer one wins and the other is kept in history (memory keeps
 * every earlier version already; the system prompt keeps its last 10). An
 * empty item (or memory's starting template) counts as "nothing yet" and
 * never wins over real text.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  readGlobalPrompt,
  writeGlobalPrompt,
} from '../../utils/globalToolSettings';
import {
  DEFAULT_MEMORY,
  memoryGet,
  memoryReplace,
  userMemoryGet,
  userMemoryReplace,
} from '../talents/agentMemory';

export type SyncKey =
  | 'systemPrompt'
  | 'userMemory'
  | 'modelMemory'
  | 'assistants'
  | 'customTools';
export const SYNC_KEYS: SyncKey[] = [
  'systemPrompt',
  'userMemory',
  'modelMemory',
  'assistants',
  'customTools',
];

export const SYNC_LABEL: Record<SyncKey, string> = {
  systemPrompt: 'System prompt',
  userMemory: 'Your memory notes',
  modelMemory: "The model's memory notes",
  assistants: 'Assistants',
  customTools: 'Custom tools',
};

export interface SyncItem {
  key: SyncKey;
  text: string;
  /** When it last changed on its device (ms); 0 for "nothing yet". */
  updatedAt: number;
}

const STATE_KEY = '@pocketagent/sync/state/v1';
const PROMPT_HISTORY_KEY = '@pocketagent/sync/prompt-history/v1';
const historyKey = (key: SyncKey) =>
  key === 'systemPrompt'
    ? PROMPT_HISTORY_KEY
    : `@pocketagent/sync/history/${key}/v1`;
/** Biggest item taken from another device. */
const MAX_TEXT = 1024 * 1024;

/** A short fingerprint of a text (FNV-1a), to notice local edits. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${text.length}`;
}

/** Nothing written yet (empty, or memory's starting template). */
export function isEmpty(key: SyncKey, text: string): boolean {
  const t = text.trim();
  return (
    t === '' ||
    t === '[]' ||
    (key === 'modelMemory' && t === DEFAULT_MEMORY.trim())
  );
}

type State = Partial<Record<SyncKey, {print: string; updatedAt: number}>>;

async function loadState(): Promise<State> {
  try {
    return JSON.parse((await AsyncStorage.getItem(STATE_KEY)) || '{}');
  } catch {
    return {};
  }
}

async function readText(key: SyncKey): Promise<string> {
  switch (key) {
    case 'systemPrompt':
      return readGlobalPrompt();
    case 'userMemory':
      return userMemoryGet();
    case 'modelMemory':
      return memoryGet();
    case 'assistants':
      return require('./syncSources').readAssistants();
    case 'customTools':
      return require('./syncSources').readCustomTools();
  }
}

/**
 * This device's items, each with when it last changed here. A change made
 * since the last look (any edit, by the user or the model) counts from now.
 */
export async function readItems(now = Date.now()): Promise<SyncItem[]> {
  const state = await loadState();
  const items: SyncItem[] = [];
  for (const key of SYNC_KEYS) {
    const text = await readText(key);
    const print = fingerprint(text);
    const seen = state[key];
    const updatedAt = isEmpty(key, text)
      ? 0
      : seen && seen.print === print
        ? seen.updatedAt
        : now;
    state[key] = {print, updatedAt};
    items.push({key, text, updatedAt});
  }
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  return items;
}

/** Only well-formed items, one per key, within size. */
export function cleanItems(raw: unknown): SyncItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: SyncItem[] = [];
  for (const key of SYNC_KEYS) {
    const item = list.find((i: any) => i && i.key === key);
    if (
      item &&
      typeof item.text === 'string' &&
      item.text.length <= MAX_TEXT &&
      typeof item.updatedAt === 'number' &&
      Number.isFinite(item.updatedAt)
    ) {
      out.push({key, text: item.text, updatedAt: Math.max(0, item.updatedAt)});
    }
  }
  return out;
}

export interface Merged {
  /** The agreed items: both devices end up with these. */
  items: SyncItem[];
  /** Items this device takes from the other one. */
  takenHere: SyncKey[];
  /** Items the other device takes from this one. */
  takenThere: SyncKey[];
}

/** Item by item, the newer edit wins; empty never wins over real text. */
export function merge(local: SyncItem[], remote: SyncItem[]): Merged {
  const result: Merged = {items: [], takenHere: [], takenThere: []};
  for (const key of SYNC_KEYS) {
    const l = local.find(i => i.key === key);
    const r = remote.find(i => i.key === key);
    if (!l || !r) {
      if (l) {
        result.items.push(l);
      }
      continue;
    }
    if (l.text === r.text) {
      result.items.push({...l, updatedAt: Math.max(l.updatedAt, r.updatedAt)});
      continue;
    }
    const lEmpty = isEmpty(key, l.text);
    const rEmpty = isEmpty(key, r.text);
    const remoteWins =
      lEmpty && !rEmpty
        ? true
        : rEmpty && !lEmpty
          ? false
          : r.updatedAt !== l.updatedAt
            ? r.updatedAt > l.updatedAt
            : // Same moment: the same choice on both devices.
              r.text > l.text;
    result.items.push(remoteWins ? r : l);
    (remoteWins ? result.takenHere : result.takenThere).push(key);
  }
  return result;
}

async function keepHistory(key: SyncKey, previous: string) {
  try {
    const list: {at: number; text: string}[] = JSON.parse(
      (await AsyncStorage.getItem(historyKey(key))) || '[]',
    );
    list.unshift({at: Date.now(), text: previous});
    await AsyncStorage.setItem(
      historyKey(key),
      JSON.stringify(list.slice(0, 10)),
    );
  } catch {
    // History is a courtesy; the sync still goes on.
  }
}

/** Earlier versions of an item replaced by a sync (newest first). */
export async function syncHistory(
  key: SyncKey,
): Promise<{at: number; text: string}[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(historyKey(key))) || '[]');
  } catch {
    return [];
  }
}

/** Earlier system prompts replaced by a sync (newest first). */
export async function promptHistory(): Promise<{at: number; text: string}[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(PROMPT_HISTORY_KEY)) || '[]');
  } catch {
    return [];
  }
}

/**
 * Writes the agreed items here (only those that differ), keeping what they
 * replace in history, and remembers them as seen (so they don't count as
 * local edits next time).
 */
export async function applyItems(items: SyncItem[]): Promise<SyncKey[]> {
  const state = await loadState();
  const changed: SyncKey[] = [];
  for (const item of cleanItems(items)) {
    const current = await readText(item.key);
    if (current !== item.text) {
      if (item.key === 'systemPrompt') {
        await keepHistory('systemPrompt', current);
        await writeGlobalPrompt(item.text);
      } else if (item.key === 'userMemory') {
        await userMemoryReplace(item.text, current);
      } else if (item.key === 'modelMemory') {
        await memoryReplace(item.text, current);
      } else {
        await keepHistory(item.key, current);
        const sources = require('./syncSources');
        await (item.key === 'assistants'
          ? sources.writeAssistants(item.text)
          : sources.writeCustomTools(item.text));
      }
      changed.push(item.key);
    }
    // What it is here now (assistants are added, never deleted: the list
    // here may hold more than what came).
    const now = await readText(item.key);
    state[item.key] = {print: fingerprint(now), updatedAt: item.updatedAt};
  }
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  return changed;
}

/** "System prompt, your memory notes" for a list of keys. */
export function describeKeys(keys: SyncKey[]): string {
  return keys
    .map((k, i) => (i === 0 ? SYNC_LABEL[k] : SYNC_LABEL[k].toLowerCase()))
    .join(', ');
}
