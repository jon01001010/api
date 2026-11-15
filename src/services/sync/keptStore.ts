/**
 * Safe storage for the "Recently deleted" lists (chats, assistants, loops).
 *
 * Two rules (security review 2, finding 3):
 * - A list that can't be read is never taken as empty. Saving over it would
 *   wipe every kept version, so a failed read throws `UnreadableStore`, and
 *   the callers then keep nothing new and remove nothing (fail closed).
 * - No single stored value may come near Android's 2 MB read window
 *   (SQLite's CursorWindow): sizes are counted in UTF-8 bytes (non-Latin
 *   text takes 2-3 bytes a character), and a long list is split over
 *   several keys of at most `CHUNK_BYTES` each.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** A kept list that could not be read: never treated as empty. */
export class UnreadableStore extends Error {
  constructor(key: string) {
    super(`Couldn't read ${key}`);
    this.name = 'UnreadableStore';
  }
}

/** Most bytes (UTF-8) in one stored value: well under Android's 2 MB. */
export const CHUNK_BYTES = 900_000;

/** The size of a text in UTF-8 bytes (what Android's read window counts). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        // A surrogate pair: one 4-byte character.
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else {
      n += 3;
    }
  }
  return n;
}

/** The size of a value as stored (JSON, UTF-8 bytes). */
export const jsonBytes = (v: unknown): number => utf8Bytes(JSON.stringify(v));

/**
 * One stored JSON value: `fallback` only when nothing is stored; a failed
 * read or a value that isn't JSON (or isn't a list, when `list`) throws.
 */
export async function readStrict<T>(
  key: string,
  fallback: T,
  list = true,
): Promise<T> {
  let text: string | null;
  try {
    text = await AsyncStorage.getItem(key);
  } catch {
    throw new UnreadableStore(key);
  }
  if (text === null || text === undefined) {
    return fallback;
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new UnreadableStore(key);
  }
  if (v === null) {
    return fallback;
  }
  if (list && !Array.isArray(v)) {
    throw new UnreadableStore(key);
  }
  return v as T;
}

/** The index of a list kept over several keys. */
interface ChunkIndex {
  /** Which write (old chunks are removed only after the new index). */
  gen: number;
  chunks: number;
}

const chunkKey = (key: string, gen: number, i: number) =>
  `${key}/chunk/${gen}/${i}`;

/** Removes a stored value; a failure only leaves an unused value behind. */
async function dropValue(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Unused (the index no longer names it).
  }
}

/**
 * A list kept over several keys (`key` holds the index). A list from
 * before (one value under `legacyKey`) is read as is until the next save.
 * Throws `UnreadableStore` when any part can't be read.
 */
export async function loadChunked<T>(
  key: string,
  legacyKey?: string,
): Promise<T[]> {
  let index: ChunkIndex | null;
  try {
    const text = await AsyncStorage.getItem(key);
    index = text ? JSON.parse(text) : null;
  } catch {
    throw new UnreadableStore(key);
  }
  if (!index) {
    return legacyKey ? readStrict<T[]>(legacyKey, []) : [];
  }
  if (
    typeof index !== 'object' ||
    !Number.isInteger(index.gen) ||
    !Number.isInteger(index.chunks) ||
    index.chunks < 0 ||
    index.chunks > 1000
  ) {
    throw new UnreadableStore(key);
  }
  const out: T[] = [];
  for (let i = 0; i < index.chunks; i++) {
    const k = chunkKey(key, index.gen, i);
    const part = await readStrict<T[] | null>(k, null);
    if (!part) {
      // A missing part: the list is incomplete, so not saved over.
      throw new UnreadableStore(k);
    }
    out.push(...part);
  }
  return out;
}

/**
 * Saves a list over several keys, each at most `CHUNK_BYTES` (UTF-8). An
 * entry larger than that alone can't be kept (callers check with
 * `jsonBytes` first; one here is dropped rather than stored too big).
 * The new parts are written first, then the index, then the old parts are
 * removed: a write cut short leaves the earlier list readable.
 */
export async function saveChunked<T>(
  key: string,
  list: T[],
  legacyKey?: string,
): Promise<void> {
  const chunks: T[][] = [];
  let part: T[] = [];
  let used = 2;
  for (const entry of list) {
    const n = jsonBytes(entry) + 1;
    if (n + 2 > CHUNK_BYTES) {
      continue;
    }
    if (used + n > CHUNK_BYTES && part.length) {
      chunks.push(part);
      part = [];
      used = 2;
    }
    part.push(entry);
    used += n;
  }
  if (part.length) {
    chunks.push(part);
  }
  let old: ChunkIndex | null = null;
  try {
    const text = await AsyncStorage.getItem(key);
    old = text ? JSON.parse(text) : null;
  } catch {
    old = null;
  }
  const gen = old && Number.isInteger(old.gen) ? (old.gen + 1) % 1_000_000 : 0;
  for (let i = 0; i < chunks.length; i++) {
    await AsyncStorage.setItem(
      chunkKey(key, gen, i),
      JSON.stringify(chunks[i]),
    );
  }
  await AsyncStorage.setItem(
    key,
    JSON.stringify({gen, chunks: chunks.length} satisfies ChunkIndex),
  );
  if (old && Number.isInteger(old.gen) && Number.isInteger(old.chunks)) {
    for (let i = 0; i < Math.min(old.chunks, 1000); i++) {
      await dropValue(chunkKey(key, old.gen, i));
    }
  }
  if (legacyKey) {
    await dropValue(legacyKey);
  }
}
