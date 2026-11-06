import type {SearchProvider, SearchHit, SearchOptions} from '../types';
import {fetchText} from './http';
import {decodeEntities} from '../htmlToText';

/**
 * Web search with no key or sign-up: the phone fetches DuckDuckGo's plain
 * HTML results page and reads the links off it. Not an official API, so the
 * page can change or rate-limit; results are titles, links and snippets.
 */
const ENDPOINT = 'https://html.duckduckgo.com/html/';

const strip = (html: string) =>
  decodeEntities(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded>. */
export function unwrapResultLink(href: string): string | null {
  const raw = decodeEntities(href);
  try {
    const u = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
    const target = u.searchParams.get('uddg');
    const url = new URL(target ?? u.toString());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    // Ads point back to DuckDuckGo itself.
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Results from DuckDuckGo's HTML page: links, titles and snippets. */
export function parseResults(html: string, max: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.split(/class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    const link =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(
        block,
      ) ??
      /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(
        block,
      );
    if (!link) {
      continue;
    }
    const url = unwrapResultLink(link[1]);
    if (!url || hits.some(h => h.url === url)) {
      continue;
    }
    const snippet =
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div|td)>/i.exec(
        block,
      )?.[1] ?? '';
    hits.push({title: strip(link[2]), url, snippet: strip(snippet)});
    if (hits.length >= max) {
      break;
    }
  }
  return hits;
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly id = 'duckduckgo' as const;

  async search(
    query: string,
    opts: SearchOptions,
    signal?: AbortSignal,
  ): Promise<SearchHit[]> {
    const html = await fetchText(`${ENDPOINT}?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (Linux; Android) PocketAgent',
      },
      signal,
    });
    const hits = parseResults(html, opts.maxResults);
    if (!hits.length && /anomaly|captcha|blocked/i.test(html)) {
      throw new Error(
        'DuckDuckGo is limiting searches right now; try again in a minute',
      );
    }
    return hits;
  }
}
