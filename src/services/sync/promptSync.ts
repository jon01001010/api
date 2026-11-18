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
 * never wins over real text. Assistants and loops are the exception:
 * merged one by one, with deletions (see assistantDeletes.ts, loopSync.ts).
 *
 * Security review 2026-11-17: the phone takes from the PC's answer only
 * what differs, never an empty item over real text (deviceSync pcWins);
 * the same text sent again counts from when it was first seen (so a device
 * that always says "5 minutes from now" can't win for ever: claimedTime);
 * a new system prompt or new notes in
 * "your memory" from another device are taken only after the user says yes
 * (holdForAnswer); a system prompt is at most MAX_PROMPT.
 *
 * Security review 2 (2026-11-18): every item that reaches the model's
 * prompt or tools (the model's notes, assistants and custom tools too) is
 * asked first; "Keep mine" holds that item from that device for a day,
 * whatever it sends meanwhile, and questions are rate-limited per device
 * and item, so a device changing one character each sync can't wear the
 * user down.
 */
import {Alert} from 'react-native';
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

import type {LoopReport} from './loopSync';

export type SyncKey =
  | 'systemPrompt'
  | 'userMemory'
  | 'modelMemory'
  | 'assistants'
  | 'customTools'
  | 'loops';
export const SYNC_KEYS: SyncKey[] = [
  'systemPrompt',
  'userMemory',
  'modelMemory',
  'assistants',
  'customTools',
  'loops',
];

export const SYNC_LABEL: Record<SyncKey, string> = {
  systemPrompt: 'System prompt',
  userMemory: 'Your memory notes',
  modelMemory: "The model's memory notes",
  assistants: 'Assistants',
  customTools: 'Custom tools',
  loops: 'Loops',
};

export interface SyncItem {
  key: SyncKey;
  text: string;
  /** When it last changed on its device (ms); 0 for "nothing yet". */
  updatedAt: number;
}

/**
 * How far ahead of this device's clock another device's time may be (ms).
 * Later times are taken as this much ahead, so a clock far ahead (or a
 * forged time) can't make an edit win forever.
 */
export const MAX_CLOCK_SKEW = 5 * 60_000;

/** A time from another device, no later than now plus the allowed skew. */
export function clampTime(t: number, now = Date.now()): number {
  return Math.min(Math.max(0, t), now + MAX_CLOCK_SKEW);
}

const STATE_KEY = '@pocketagent/sync/state/v1';
const PROMPT_HISTORY_KEY = '@pocketagent/sync/prompt-history/v1';
const historyKey = (key: SyncKey) =>
  key === 'systemPrompt'
    ? PROMPT_HISTORY_KEY
    : `@pocketagent/sync/history/${key}/v1`;
/** Biggest item taken from another device. */
const MAX_TEXT = 1024 * 1024;
/**
 * Biggest system prompt (characters), set here or taken from another device
 * (security review 2026-11-17: storage, and every chat carries it).
 */
export const MAX_PROMPT = 32 * 1024;

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
    case 'loops':
      return require('./loopSync').readLoopsItem();
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
        ? // Never later than now (heals a time stored before the clamp).
          Math.min(seen.updatedAt, now)
        : now;
    state[key] = {print, updatedAt};
    items.push({key, text, updatedAt});
  }
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  return items;
}

/** Only well-formed items, one per key, within size; times clamped. */
export function cleanItems(raw: unknown, now = Date.now()): SyncItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: SyncItem[] = [];
  for (const key of SYNC_KEYS) {
    const item = list.find((i: any) => i && i.key === key);
    if (
      item &&
      typeof item.text === 'string' &&
      item.text.length <= (key === 'systemPrompt' ? MAX_PROMPT : MAX_TEXT) &&
      typeof item.updatedAt === 'number' &&
      Number.isFinite(item.updatedAt)
    ) {
      out.push({
        key,
        text: item.text,
        updatedAt: clampTime(item.updatedAt, now),
      });
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

/**
 * What this device remembers of one other device, per item: the text it
 * last sent (`seenPrint`, its fingerprint) and the time that text counts
 * from (`seenAt`: its time when first seen here, clamped, and no later than
 * this device's clock then); a text the user chose not to take
 * (`declined`, its fingerprint: not asked again); when the user last said
 * "Keep mine" (`keptAt`: nothing from that device for that item is asked
 * or taken for KEEP_MINE_MS) and when it was last asked (`askedAt`: at
 * most one question per ASK_GAP_MS).
 */
export type PeerState = Partial<
  Record<
    SyncKey,
    {
      seenPrint?: string;
      seenAt?: number;
      declined?: string;
      keptAt?: number;
      askedAt?: number;
    }
  >
>;

const peerKey = (peer: string) =>
  `@pocketagent/sync/peer/${encodeURIComponent(peer || 'a paired device')}/v1`;

export async function loadPeer(peer: string): Promise<PeerState> {
  try {
    const v = JSON.parse((await AsyncStorage.getItem(peerKey(peer))) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

async function savePeer(peer: string, state: PeerState): Promise<void> {
  try {
    await AsyncStorage.setItem(peerKey(peer), JSON.stringify(state));
  } catch {
    // At worst the next sync compares by time alone.
  }
}

/**
 * Once: what was kept under a device's old id (its name, before devices
 * were known by their key) moves to its new one, if that has nothing yet
 * (security review 2, 2026-11-18). The old record is removed, so a second
 * device with the same name can't take it.
 */
export async function movePeerOnce(from: string, to: string): Promise<void> {
  if (from === to) {
    return;
  }
  try {
    const old = await AsyncStorage.getItem(peerKey(from));
    if (old === null) {
      return;
    }
    if ((await AsyncStorage.getItem(peerKey(to))) === null) {
      await AsyncStorage.setItem(peerKey(to), old);
    }
    await AsyncStorage.removeItem(peerKey(from));
  } catch {
    // At worst the device starts as new here.
  }
}

/**
 * The other device's item with the time it may claim: the same text it
 * sent before counts from when it was first seen here (never later than
 * this device's clock then), so a device that sends the same text again
 * and again "a few minutes from now" can't win for ever; a local edit
 * made after that beats it.
 */
export function claimedTime(r: SyncItem, peer?: PeerState[SyncKey]): SyncItem {
  if (
    peer?.seenPrint !== undefined &&
    peer.seenAt !== undefined &&
    peer.seenPrint === fingerprint(r.text)
  ) {
    return {...r, updatedAt: Math.min(r.updatedAt, peer.seenAt)};
  }
  return r;
}

/** After a sync with `peer`: what it sent, and from when it counts. */
export async function rememberSync(
  peer: string,
  received: SyncItem[],
  now = Date.now(),
): Promise<void> {
  const state = await loadPeer(peer);
  for (const item of received) {
    const print = fingerprint(item.text);
    const seen = state[item.key];
    if (seen?.seenPrint === print) {
      continue;
    }
    state[item.key] = {
      ...seen,
      seenPrint: print,
      seenAt: Math.min(item.updatedAt, now),
    };
  }
  await savePeer(peer, state);
}

/**
 * Whether the other device's edit beats this one's, by time (its time as
 * claimedTime allows); the same moment: the same choice on both devices.
 */
export function remoteIsNewer(
  l: SyncItem,
  r: SyncItem,
  peer?: PeerState[SyncKey],
): boolean {
  const t = claimedTime(r, peer).updatedAt;
  if (t !== l.updatedAt) {
    return t > l.updatedAt;
  }
  return r.text > l.text;
}

/**
 * Item by item, the newer edit wins; empty never wins over real text.
 * Assistants are merged one by one (assistantDeletes.ts): both lists are
 * joined and, for each assistant, its newer edit or deletion wins.
 * `peer`: what this device remembers of the other one (remoteIsNewer).
 */
export function merge(
  local: SyncItem[],
  remote: SyncItem[],
  peer: PeerState = {},
): Merged {
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
    if (key === 'assistants' || key === 'loops') {
      // One by one: the newer edit or deletion of each one wins.
      const m = (
        key === 'loops'
          ? require('./loopSync').mergeLoops
          : require('./assistantDeletes').mergeAssistants
      )(l.text, r.text, l.updatedAt, r.updatedAt);
      if (m) {
        result.items.push({
          key,
          text: m.text,
          updatedAt: Math.max(l.updatedAt, r.updatedAt),
        });
        if (m.takenHere) {
          result.takenHere.push(key);
        }
        if (m.takenThere) {
          result.takenThere.push(key);
        }
        continue;
      }
    }
    const lEmpty = isEmpty(key, l.text);
    const rEmpty = isEmpty(key, r.text);
    const remoteWins =
      lEmpty && !rEmpty
        ? true
        : rEmpty && !lEmpty
          ? false
          : remoteIsNewer(l, r, peer[key]);
    result.items.push(remoteWins ? r : l);
    (remoteWins ? result.takenHere : result.takenThere).push(key);
  }
  return result;
}

/**
 * Most characters of one item's history in all (security review
 * 2026-11-17: ten versions of up to 1 MB each was too much to keep); the
 * newest version is always kept.
 */
export const MAX_HISTORY_CHARS = 2 * 1024 * 1024;

/** The newest 10 versions, within MAX_HISTORY_CHARS (the newest always). */
export function trimHistory<T extends {text: string}>(list: T[]): T[] {
  const out: T[] = [];
  let size = 0;
  for (const entry of list.slice(0, 10)) {
    size += entry.text.length;
    if (out.length && size > MAX_HISTORY_CHARS) {
      break;
    }
    out.push(entry);
  }
  return out;
}

async function keepHistory(key: SyncKey, previous: string) {
  try {
    const list: {at: number; text: string}[] = JSON.parse(
      (await AsyncStorage.getItem(historyKey(key))) || '[]',
    );
    list.unshift({at: Date.now(), text: previous});
    await AsyncStorage.setItem(
      historyKey(key),
      JSON.stringify(trimHistory(list)),
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
export async function applyItems(
  items: SyncItem[],
  now = Date.now(),
  opts: {
    /** Which device they came from ("the PC", or the device's name). */
    from?: string;
    /**
     * Filled in: assistants deleted here, or waiting for an answer; loops
     * added (paused), deleted or waiting.
     */
    report?: {assistantsDeleted: number; assistantsHeld: number} & LoopReport;
  } = {},
): Promise<SyncKey[]> {
  const state = await loadState();
  const changed: SyncKey[] = [];
  for (const item of cleanItems(items, now)) {
    const current = await readText(item.key);
    if (current !== item.text) {
      let wrote = true;
      if (item.key === 'systemPrompt') {
        await keepHistory('systemPrompt', current);
        await writeGlobalPrompt(item.text);
      } else if (item.key === 'userMemory') {
        await userMemoryReplace(item.text, current);
      } else if (item.key === 'modelMemory') {
        await memoryReplace(item.text, current);
      } else if (item.key === 'assistants') {
        // Only when something here changed (the same assistants under
        // another id, or held deletions, are no change).
        const did = await require('./syncSources').writeAssistants(item.text, {
          from: opts.from,
          at: Math.min(item.updatedAt, now),
          report: opts.report,
        });
        if (did === false) {
          wrote = false;
        } else {
          await keepHistory(item.key, current);
        }
      } else if (item.key === 'loops') {
        // Definitions only; new ones arrive paused and not started.
        const did = await require('./loopSync').writeLoopsItem(item.text, {
          from: opts.from,
          at: Math.min(item.updatedAt, now),
          report: opts.report,
        });
        if (did === false) {
          wrote = false;
        } else {
          await keepHistory(item.key, current);
        }
      } else {
        await keepHistory(item.key, current);
        await require('./syncSources').writeCustomTools(item.text);
      }
      if (wrote) {
        changed.push(item.key);
      }
    }
    // What it is here now (the list here may differ from what came: a
    // starter assistant under its own id, a deletion waiting for an answer).
    // Stored no later than now: what this device passes on is its own time.
    const text = await readText(item.key);
    state[item.key] = {
      print: fingerprint(text),
      updatedAt: Math.min(item.updatedAt, now),
    };
  }
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  return changed;
}

/**
 * Items taken only after the user says yes (from any other device): all
 * that reach the model's prompt or its tools (security review 2,
 * 2026-11-18: the model's notes, assistants and custom tools too). Loops
 * arrive paused and are started by the user.
 */
export const ASK_FIRST: SyncKey[] = [
  'systemPrompt',
  'userMemory',
  'modelMemory',
  'assistants',
  'customTools',
];

/** "Keep mine": that item from that device isn't asked or taken for this long. */
export const KEEP_MINE_MS = 24 * 60 * 60 * 1000;
/** At most one question per device and item in this time. */
export const ASK_GAP_MS = 30 * 60 * 1000;

/** Questions open now (one per device and item). */
const asking = new Set<string>();

/**
 * Splits the items to take: those taken now, and (ASK_FIRST) those the
 * user is asked about first, each in its own question, taken (`take`) only
 * on yes. Not asked (and not taken): a text the user said no to, anything
 * of that item from that device for KEEP_MINE_MS after "Keep mine"
 * (whatever it sends meanwhile), and more than one question per device and
 * item within ASK_GAP_MS (a time before the last question, a clock set
 * back, counts as within it). Returns the items to take now.
 */
export async function holdForAnswer(
  items: SyncItem[],
  from: string,
  take: (item: SyncItem) => Promise<void>,
  /** Where the answer is remembered (default: `from`). */
  peerId: string = from,
  clock: () => number = Date.now,
): Promise<SyncItem[]> {
  const now: SyncItem[] = [];
  const peer = await loadPeer(peerId);
  for (const item of items) {
    if (!ASK_FIRST.includes(item.key) || isEmpty(item.key, item.text)) {
      now.push(item);
      continue;
    }
    const print = fingerprint(item.text);
    const id = `${peerId}:${item.key}`;
    const seen = peer[item.key];
    const t = clock();
    if (
      seen?.declined === print ||
      (seen?.keptAt !== undefined && t < seen.keptAt + KEEP_MINE_MS) ||
      (seen?.askedAt !== undefined && t < seen.askedAt + ASK_GAP_MS) ||
      asking.has(id)
    ) {
      continue;
    }
    asking.add(id);
    peer[item.key] = {...seen, askedAt: t};
    await savePeer(peerId, peer);
    const {textView} = require('../../utils/shownText');
    const label = SYNC_LABEL[item.key];
    Alert.alert(
      `Take the ${label.toLowerCase()} from ${from}?`,
      `${textView(item.text, {name: label})}\n\nIt replaces yours here (yours is kept in history).`,
      [
        {
          text: 'Keep mine',
          style: 'cancel',
          onPress: async () => {
            asking.delete(id);
            const state = await loadPeer(peerId);
            state[item.key] = {
              ...state[item.key],
              declined: print,
              keptAt: clock(),
            };
            await savePeer(peerId, state);
          },
        },
        {
          text: 'Take it',
          onPress: async () => {
            asking.delete(id);
            // Said yes: the next change may be asked at once.
            const state = await loadPeer(peerId);
            const seenHere = state[item.key];
            if (seenHere?.askedAt !== undefined) {
              delete seenHere.askedAt;
              await savePeer(peerId, state);
            }
            await take(item);
          },
        },
      ],
      {cancelable: true, onDismiss: () => asking.delete(id)},
    );
  }
  return now;
}

/** For tests. */
export function resetAsking(): void {
  asking.clear();
}

/** "System prompt, your memory notes" for a list of keys. */
export function describeKeys(keys: SyncKey[]): string {
  return keys
    .map((k, i) => (i === 0 ? SYNC_LABEL[k] : SYNC_LABEL[k].toLowerCase()))
    .join(', ');
}
