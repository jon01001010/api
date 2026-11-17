/**
 * Text from the model (or another device) as a question shows it: hidden
 * characters made visible, and, when it is long, its start AND its end with
 * what was left out counted in the middle (never cut silently), under a
 * size line the app writes itself. Shared by the PC's questions on the phone
 * (homeLink/pcQuestions.ts) and the phone's own approvals (security review
 * 2026-11-17).
 */

/**
 * Characters that change how text looks without showing themselves: the
 * same set as the PC's `remote_ask::hidden_char` (a test pins both), except
 * a newline and a tab, which show as themselves. Control characters, the
 * soft hyphen (U+00AD), the combining grapheme joiner (U+034F), direction
 * controls (U+061C, U+202A–U+202E, U+2066–U+2069), Hangul fillers (U+115F,
 * U+1160, U+3164, U+FFA0), Mongolian variation selectors and vowel
 * separator (U+180B–U+180E), wide and narrow spaces (U+2000–U+200A, U+3000),
 * zero-width and marks (U+200B–U+200F, U+2060–U+206F, U+FEFF), line and
 * paragraph separators, the blank Braille pattern (U+2800), variation
 * selectors (U+FE00–U+FE0F), interlinear annotation marks (U+FFF9–U+FFFB)
 * and the tag characters (U+E0000–U+E007F).
 */
export const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0008],
  [0x000b, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x180b, 0x180e],
  [0x2000, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x2800, 0x2800],
  [0x3000, 0x3000],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe007f],
];

const codePoint = (n: number) => `\\u{${n.toString(16)}}`;
const HIDDEN = new RegExp(
  `[${HIDDEN_RANGES.map(([a, b]) =>
    a === b ? codePoint(a) : `${codePoint(a)}-${codePoint(b)}`,
  ).join('')}]`,
  'gu',
);
/** Half of a surrogate pair on its own (a long text cut inside one). */
const LONE_HALF =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

const marker = (n: number) =>
  `⟦U+${n.toString(16).toUpperCase().padStart(4, '0')}⟧`;

/** Each hidden character as a visible marker, e.g. ⟦U+202E⟧. */
export function showHidden(text: string): string {
  return text
    .replace(HIDDEN, c => marker(c.codePointAt(0) ?? 0))
    .replace(LONE_HALF, c => marker(c.charCodeAt(0)));
}

export interface ViewLimits {
  /** Longest text shown whole (characters, and lines). */
  maxChars: number;
  maxLines: number;
  headChars: number;
  tailChars: number;
  headLines: number;
  tailLines: number;
}

/** For the phone's own approvals: short enough for a dialog. */
export const APPROVAL_LIMITS: ViewLimits = {
  maxChars: 1500,
  maxLines: 30,
  headChars: 900,
  tailChars: 400,
  headLines: 18,
  tailLines: 8,
};

/**
 * For the phone's approval window (it scrolls): whole up to here, then its
 * start and end.
 */
export const DIALOG_LIMITS: ViewLimits = {
  maxChars: 20000,
  maxLines: 400,
  headChars: 12000,
  tailChars: 4000,
  headLines: 240,
  tailLines: 80,
};

/**
 * Hidden characters made visible and, past the limits (characters or
 * lines), its start and its end with how many characters were left out.
 */
export function headTailView(
  all: string,
  limits: ViewLimits = APPROVAL_LIMITS,
): {text: string; shortened: boolean} {
  const lines = all.split('\n');
  if (all.length <= limits.maxChars && lines.length <= limits.maxLines) {
    return {text: showHidden(all), shortened: false};
  }
  let head = lines
    .slice(0, limits.headLines)
    .join('\n')
    .slice(0, limits.headChars);
  let tail = lines.slice(-limits.tailLines).join('\n').slice(-limits.tailChars);
  if (head.length + tail.length > all.length) {
    // Few, very long lines: plain character counts.
    head = all.slice(0, limits.headChars);
    tail = all.slice(-limits.tailChars);
  }
  const left = all.length - head.length - tail.length;
  return {
    text: `${showHidden(head)}\n… (${left} characters not shown) …\n${showHidden(tail)}`,
    shortened: true,
  };
}

/** "1,234 characters, 12 lines": counted by the app, never by the model. */
export function sizeLine(text: string): string {
  const chars = [...text].length;
  const lines = text === '' ? 0 : text.split('\n').length;
  return `${chars.toLocaleString('en-US')} character${chars === 1 ? '' : 's'}, ${lines} line${lines === 1 ? '' : 's'}`;
}

/**
 * Text as an approval shows it: the app's own size line first ("Text (the
 * app counted): …"), then the text (headTailView).
 */
export function textView(
  text: string,
  opts: {name?: string; limits?: ViewLimits} = {},
): string {
  const view = headTailView(text, opts.limits);
  return `${opts.name ?? 'Text'} (the app counted ${sizeLine(text)}${view.shortened ? '; start and end shown' : ''}):\n${view.text}`;
}
