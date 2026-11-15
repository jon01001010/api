/**
 * Memory search: find the memory notes that match a message, so only those
 * are sent instead of every note (Toolbox → What the model sees → Memory).
 *
 * Plain word matching (BM25), no new native code and no model: it runs the
 * same on the phone and the desktop, with any model, local or remote.
 *
 * Embeddings were considered (2026-11-15) and left for later: llama.rn can
 * embed only with a context loaded with `embedding: true`, so the chat model
 * would have to be loaded a second time (memory and seconds on a phone),
 * and a chat model's embeddings rank notes poorly. Remote servers' `/v1/embeddings`
 * would send every note to the server on each message. A small separate
 * embedding model (e.g. on the desktop NPU, TODO) is the better way later.
 *
 * Tokens: letters and digits in any script (`\p{L}`), lower-cased, accents
 * removed; scripts written without spaces (Chinese, Japanese, Thai, …) are
 * split into single characters and pairs of characters, so they match too.
 * Latin words get a light English stemming (plurals, -ing, -ed, -ly).
 */

/** One note: a line of memory, with the heading above it (if any) for matching. */
export interface MemoryNote {
  /** Which memory it comes from. */
  source: 'user' | 'model';
  /** The line as written (what is sent). */
  text: string;
  /** Heading lines above it (used for matching only). */
  context: string;
  /** Position in its memory (to keep the original order when sending). */
  index: number;
}

/** A weighted piece of the query: the message (1) and, lightly, the one before. */
export interface QueryPart {
  text: string;
  weight: number;
}

export interface PickOptions {
  /** At most this many notes (default 8). */
  topN?: number;
  /** At most this many characters of notes in total (default 2000). */
  budget?: number;
}

export const DEFAULT_TOP_N = 8;
export const DEFAULT_BUDGET = 2000;

// Common words in a few languages: they match everything and mean little.
// Short on purpose; BM25 already gives frequent words little weight.
const STOP_WORDS = new Set(
  // English
  (
    'a an and are as at be been but by can could did do does for from had has have he her ' +
    'hers him his how i if in into is it its just me my no not of on or our ours she so ' +
    'than that the their them then there these they this those to too was we were what ' +
    'when where which who whom why will with would you your yours am about any all also ' +
    'some please tell know remember thing things ' +
    // German
    'der die das und ist ein eine nicht ich du er sie es wir ihr mit von zu den dem auf ' +
    // French
    'le la les et est un une des du je tu il elle nous vous ils de en que qui ' +
    // Spanish / Portuguese / Italian
    'el los las y es una por con para que se lo o um uma os e il di che non'
  ).split(' '),
);

/** Code points of scripts written without spaces between words. */
function isNoSpaceScript(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x30ff) || // Hiragana, Katakana
    (code >= 0x3400 && code <= 0x4dbf) || // Han extension A
    (code >= 0x4e00 && code <= 0x9fff) || // Han
    (code >= 0xf900 && code <= 0xfaff) || // Han compatibility
    (code >= 0x0e00 && code <= 0x0eff) || // Thai, Lao
    (code >= 0x1000 && code <= 0x109f) || // Myanmar
    (code >= 0x1780 && code <= 0x17ff) // Khmer
  );
}

const isLatinWord = (word: string) => /^[a-z0-9]+$/.test(word);

/** Light English stemming: enough that "dogs" finds "dog" and "running" finds "run". */
export function stem(word: string): string {
  if (!isLatinWord(word) || word.length <= 3) {
    return word;
  }
  let w = word;
  if (w.endsWith('ies') && w.length > 4) {
    w = w.slice(0, -3) + 'y';
  } else if (/(ss|sh|ch|x|z)es$/.test(w)) {
    w = w.slice(0, -2);
  } else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) {
    w = w.slice(0, -1);
  }
  if (w.endsWith('ing') && w.length > 5) {
    w = w.slice(0, -3);
  } else if (w.endsWith('ed') && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith('ly') && w.length > 4) {
    w = w.slice(0, -2);
  }
  // "running" -> "runn" -> "run"; "stopped" -> "stopp" -> "stop".
  if (
    w.length > 3 &&
    /([b-df-hj-np-tv-z])\1$/.test(w) &&
    !/(ll|ss|zz)$/.test(w)
  ) {
    w = w.slice(0, -1);
  }
  // "liked" / "like" -> "lik"; "hoping" / "hope" -> "hop".
  if (w.length > 3 && w.endsWith('e')) {
    w = w.slice(0, -1);
  }
  return w;
}

function foldAccents(text: string): string {
  try {
    return text.normalize('NFD').replace(/\p{M}+/gu, '');
  } catch {
    return text;
  }
}

/** Search tokens of a text (any script). Stop words are dropped. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const chunks = foldAccents(String(text ?? '').toLowerCase()).split(
    /[^\p{L}\p{N}]+/u,
  );
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }
    let word = '';
    let run = '';
    const flushWord = () => {
      if (
        word &&
        !STOP_WORDS.has(word) &&
        (word.length > 1 || /\d/.test(word))
      ) {
        out.push(stem(word));
      }
      word = '';
    };
    const flushRun = () => {
      const chars = Array.from(run);
      for (let i = 0; i < chars.length; i++) {
        out.push(chars[i]);
        if (i + 1 < chars.length) {
          out.push(chars[i] + chars[i + 1]);
        }
      }
      run = '';
    };
    for (const ch of Array.from(chunk)) {
      if (isNoSpaceScript(ch.codePointAt(0) ?? 0)) {
        flushWord();
        run += ch;
      } else {
        flushRun();
        word += ch;
      }
    }
    flushWord();
    flushRun();
  }
  return out;
}

const isHeading = (line: string) => /^\s*#/.test(line) || /:\s*$/.test(line);

/**
 * A memory as notes: one per non-empty line. A heading line (ending in ":"
 * or starting with "#") is not a note itself; it helps the lines under it
 * match, until the next blank line or heading.
 */
export function splitNotes(
  memory: string,
  source: 'user' | 'model',
): MemoryNote[] {
  const notes: MemoryNote[] = [];
  let heading = '';
  const lines = String(memory ?? '').split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    if (!line.trim()) {
      heading = '';
      return;
    }
    if (isHeading(line)) {
      // A heading with nothing under it is still a note.
      const next = lines[index + 1];
      const hasChildren =
        next !== undefined && next.trim() !== '' && !isHeading(next);
      if (hasChildren) {
        heading = line.trim();
        return;
      }
    }
    notes.push({source, text: line, context: heading, index});
  });
  return notes;
}

/** Joins the weighted query parts into token -> weight (the highest wins). */
function queryWeights(query: string | QueryPart[]): Map<string, number> {
  const parts = typeof query === 'string' ? [{text: query, weight: 1}] : query;
  const weights = new Map<string, number>();
  for (const part of parts) {
    if (!part?.text || !(part.weight > 0)) {
      continue;
    }
    for (const token of tokenize(part.text)) {
      weights.set(token, Math.max(weights.get(token) ?? 0, part.weight));
    }
  }
  return weights;
}

/**
 * BM25 scores of documents for a query (k1 = 1.2, b = 0.75). Returns the
 * indexes of documents with a score above zero, best first (ties keep the
 * original order).
 */
export function bm25Rank(
  documents: string[],
  query: string | QueryPart[],
): {index: number; score: number}[] {
  const weights = queryWeights(query);
  if (!weights.size || !documents.length) {
    return [];
  }
  const docs = documents.map(d => tokenize(d));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const token of new Set(doc)) {
      if (weights.has(token)) {
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }
  }
  const k1 = 1.2;
  const b = 0.75;
  const n = docs.length;
  const scored: {index: number; score: number}[] = [];
  docs.forEach((doc, index) => {
    const tf = new Map<string, number>();
    for (const token of doc) {
      if (weights.has(token)) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }
    }
    let score = 0;
    tf.forEach((count, token) => {
      const d = df.get(token) ?? 0;
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      const norm = count + k1 * (1 - b + (b * doc.length) / avg);
      score += (weights.get(token) ?? 0) * idf * ((count * (k1 + 1)) / norm);
    });
    if (score > 0) {
      scored.push({index, score});
    }
  });
  return scored.sort((x, y) => y.score - x.score || x.index - y.index);
}

/**
 * The notes that match the query: best first, at most `topN`, within
 * `budget` characters (a note that doesn't fit is skipped, a shorter one
 * after it may still go). No match: nothing.
 */
export function pickNotes(
  notes: MemoryNote[],
  query: string | QueryPart[],
  options: PickOptions = {},
): MemoryNote[] {
  const topN = options.topN ?? DEFAULT_TOP_N;
  const budget = options.budget ?? DEFAULT_BUDGET;
  const ranked = bm25Rank(
    notes.map(n => (n.context ? n.context + '\n' : '') + n.text),
    query,
  );
  const picked: MemoryNote[] = [];
  let used = 0;
  for (const {index} of ranked) {
    if (picked.length >= topN) {
      break;
    }
    const note = notes[index];
    const size = note.text.length + 1;
    if (used + size > budget) {
      continue;
    }
    picked.push(note);
    used += size;
  }
  return picked;
}
