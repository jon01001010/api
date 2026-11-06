import type {SearchProvider, SearchProviderId, PageContent} from './types';
import {fetchPage} from './providers/http';
import {htmlToText} from './htmlToText';
import {TavilyProvider} from './providers/tavily';
import {BraveProvider} from './providers/brave';
import {ExaProvider} from './providers/exa';
import {FirecrawlProvider} from './providers/firecrawl';
import {ParallelProvider} from './providers/parallel';
import {DuckDuckGoProvider} from './providers/duckduckgo';

export type {
  SearchProvider,
  SearchProviderId,
  SearchHit,
  PageContent,
  SearchBudget,
  SearchOptions,
} from './types';
export {
  budgetHits,
  budgetPage,
  getCachedHits,
  setCachedHits,
  resetSearchCache,
} from './searchBudget';

/** Wires each adapter to a key accessor so it reads its BYOK key lazily, without importing the store. */
export const createSearchProvider = (
  id: SearchProviderId,
  getKey: () => string,
): SearchProvider => {
  switch (id) {
    case 'duckduckgo':
      return new DuckDuckGoProvider();
    case 'tavily':
      return new TavilyProvider(getKey);
    case 'brave':
      return new BraveProvider(getKey);
    case 'exa':
      return new ExaProvider(getKey);
    case 'firecrawl':
      return new FirecrawlProvider(getKey);
    case 'parallel':
      return new ParallelProvider(getKey);
  }
};

/**
 * Default reader: the phone fetches the page itself (no third-party reader
 * sees the URL) and turns the HTML into plain text. The final address after
 * redirects comes from the network layer, so it is verified.
 */
export const readWithDefaultReader = async (
  url: string,
  signal?: AbortSignal,
): Promise<PageContent> => {
  const page = await fetchPage(url, {
    method: 'GET',
    signal,
    headers: {Accept: 'text/html, text/plain;q=0.9, */*;q=0.1'},
  });
  if (!/text\/html|text\/plain|xhtml|^$/i.test(page.contentType)) {
    throw new Error(`not a readable page (${page.contentType.split(';')[0]})`);
  }
  const isHtml =
    /html/i.test(page.contentType) || /^\s*<(!doctype|html)/i.test(page.body);
  const {title, text} = isHtml
    ? htmlToText(page.body)
    : {title: undefined, text: page.body};
  return {
    url: page.finalUrl || url,
    finalUrlVerified: !!page.finalUrl,
    ...(title ? {title} : {}),
    text,
  };
};
