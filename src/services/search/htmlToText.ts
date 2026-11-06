/**
 * HTML → readable plain text for read_url, on the phone. Not a full browser:
 * drops scripts, styles and page furniture, keeps headings, paragraphs,
 * list items and table rows on their own lines, decodes common entities.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000
        ? String.fromCodePoint(n)
        : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): {title?: string; text: string} {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch
    ? decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) || undefined
    : undefined;
  // Prefer the main content when the page marks it.
  const main =
    /<main[\s>][\s\S]*?<\/main>/i.exec(html)?.[0] ??
    /<article[\s>][\s\S]*?<\/article>/i.exec(html)?.[0] ??
    /<body[\s>][\s\S]*<\/body>/i.exec(html)?.[0] ??
    html;
  const text = decodeEntities(
    main
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(
        /<(script|style|noscript|svg|template|iframe|head|nav|footer|form)[\s>][\s\S]*?<\/\1>/gi,
        ' ',
      )
      .replace(/<br\s*\/?>/gi, '\n')
      // A line break before each block (lookahead: the tag itself is kept
      // whole, so stripping tags below can't swallow text).
      .replace(/<(?=li[\s>])/gi, '\n• <')
      .replace(
        /<(?=\/?(p|div|section|article|header|h[1-6]|ul|ol|tr|table|blockquote|pre|dd|dt)[\s>/])/gi,
        '\n<',
      )
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {title, text};
}
