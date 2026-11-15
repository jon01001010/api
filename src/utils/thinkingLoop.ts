/**
 * Loop guard for thinking: notices when a model's reasoning goes round in
 * circles ("Wait, I should say hello. Wait, I should say hello…") so the
 * thinking can end early, before the thinking budget (utils/thinkingBudget)
 * runs out. Seen 2026-11-08 with a 2B model that never answered "hi".
 *
 * Pure text checks, cheap enough to run on the tail while streaming:
 * 1. The end of the text is one block of words repeated back to back
 *    (3+ times, at least 24 words in all).
 * 2. One sentence (6+ words, small openers like "wait," / "but" / "hmm"
 *    ignored) said 3+ times.
 * 3. One run of 10 words said 3+ times.
 * Normal reasoning hardly ever repeats 10 words in a row three times.
 */

/** Only the last part of the reasoning is checked (words). */
const WINDOW_WORDS = 1500;
const MIN_CYCLE_REPEATS = 3;
const MIN_CYCLE_WORDS = 24;
const MAX_CYCLE_LENGTH = 200;
const NGRAM = 10;
const MIN_SENTENCE_WORDS = 6;
const MIN_REPEATS = 3;

/** Openers that loops vary while the rest stays the same. */
const OPENERS = new Set([
  'wait',
  'but',
  'so',
  'hmm',
  'okay',
  'ok',
  'alright',
  'actually',
  'oh',
  'well',
  'no',
  'and',
  'then',
  'now',
  'again',
  'also',
]);

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** The end of `w` is one block repeated back to back. */
function endsInCycle(w: string[]): boolean {
  const n = w.length;
  for (let p = 1; p <= MAX_CYCLE_LENGTH && p * MIN_CYCLE_REPEATS <= n; p++) {
    let repeats = 1;
    while ((repeats + 1) * p <= n) {
      const start = n - (repeats + 1) * p;
      let same = true;
      for (let i = 0; i < p; i++) {
        if (w[start + i] !== w[n - p + i]) {
          same = false;
          break;
        }
      }
      if (!same) {
        break;
      }
      repeats++;
    }
    if (repeats >= MIN_CYCLE_REPEATS && repeats * p >= MIN_CYCLE_WORDS) {
      return true;
    }
  }
  return false;
}

function repeatedSentence(text: string): boolean {
  const counts = new Map<string, number>();
  for (const raw of text.split(/[.!?\n]+/)) {
    const w = words(raw);
    while (w.length > 0 && OPENERS.has(w[0])) {
      w.shift();
    }
    if (w.length < MIN_SENTENCE_WORDS) {
      continue;
    }
    const key = w.join(' ');
    const seen = (counts.get(key) ?? 0) + 1;
    if (seen >= MIN_REPEATS) {
      return true;
    }
    counts.set(key, seen);
  }
  return false;
}

function repeatedRun(w: string[]): boolean {
  const counts = new Map<string, number>();
  for (let i = 0; i + NGRAM <= w.length; i++) {
    const key = w.slice(i, i + NGRAM).join(' ');
    const seen = (counts.get(key) ?? 0) + 1;
    if (seen >= MIN_REPEATS) {
      return true;
    }
    counts.set(key, seen);
  }
  return false;
}

/** True when the reasoning is going round in circles. */
export function isThinkingLoop(reasoning: string): boolean {
  if (!reasoning) {
    return false;
  }
  const all = words(reasoning);
  if (all.length < MIN_CYCLE_WORDS) {
    return false;
  }
  const tail = all.slice(-WINDOW_WORDS);
  if (endsInCycle(tail) || repeatedRun(tail)) {
    return true;
  }
  // Sentences: the tail of the text, about the same size as the word window.
  const chars = reasoning.length > 12000 ? reasoning.slice(-12000) : reasoning;
  return repeatedSentence(chars);
}

/**
 * Checks while streaming, every `step` new characters, so a long reasoning
 * is not scanned on every token.
 */
export function makeLoopWatcher(step = 160): (reasoning: string) => boolean {
  let checkedAt = 0;
  return (reasoning: string) => {
    if (reasoning.length - checkedAt < step) {
      return false;
    }
    checkedAt = reasoning.length;
    return isThinkingLoop(reasoning);
  };
}
