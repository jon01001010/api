/**
 * read_url redirect hardening: the final URL a reader reports (after
 * redirects) must itself be allowed, on an allowed port and scheme.
 */
import {ReadUrlEngine, isDowngrade} from '../ReadUrlEngine';
import type {SearchAccess} from '../searchAccess';
import type {PageContent, SearchProvider} from '../../search/types';
import {
  allowReadUrls,
  matchReadUrl,
  isReadUrlAllowed,
  resetReadUrlAllowlist,
  seedReadUrlAllowlist,
} from '../readUrlAllowlist';

const engineWithFinal = (page: Partial<PageContent>) => {
  const read = jest.fn(
    async (url: string): Promise<PageContent> => ({
      url,
      finalUrlVerified: true,
      text: 'body',
      ...page,
    }),
  );
  const provider: SearchProvider = {id: 'exa', search: jest.fn(), read};
  const access: SearchAccess = {
    getActiveProvider: () => provider,
    canSearch: () => true,
    getResultCount: () => 3,
    readWithDefaultReader: jest.fn(),
  };
  return new ReadUrlEngine(access);
};

const userSaid = (text: string) =>
  seedReadUrlAllowlist([{role: 'user', content: text}], []);

beforeEach(() => resetReadUrlAllowlist());

describe('final URL after redirects', () => {
  it('accepts a redirect within the site the user named', async () => {
    userSaid('read example.com please');
    const r = await engineWithFinal({
      url: 'https://www.example.com/landing',
    }).execute({url: 'https://example.com/'});
    expect(r.type).toBe('text');
  });

  it.each([
    ['another host', 'https://evil.test/steal'],
    ['a subdomain the user did not name', 'https://api.example.com/'],
    ['a non-default port', 'https://example.com:6379/'],
    ['plain http (downgrade)', 'http://example.com/'],
    ['embedded credentials', 'https://user:pw@example.com/'],
    ['an IP address', 'https://127.0.0.1/'],
    ['a non-web scheme', 'file:///etc/passwd'],
  ])('rejects a redirect to %s', async (_label, finalUrl) => {
    userSaid('read example.com please');
    const r = await engineWithFinal({url: finalUrl}).execute({
      url: 'https://example.com/',
    });
    expect(r.type).toBe('error');
    expect(r.summary).toMatch(/final destination/);
  });

  it('rejects a page whose final URL was not verified by the reader', async () => {
    userSaid('read example.com please');
    const r = await engineWithFinal({finalUrlVerified: false}).execute({
      url: 'https://example.com/',
    });
    expect(r.type).toBe('error');
  });

  it('a search hit only allows its exact page, not a redirect elsewhere on the host', async () => {
    allowReadUrls(['https://news.test/a']);
    const ok = await engineWithFinal({}).execute({url: 'https://news.test/a'});
    expect(ok.type).toBe('text');
    const r = await engineWithFinal({url: 'https://news.test/admin'}).execute({
      url: 'https://news.test/a',
    });
    expect(r.type).toBe('error');
  });
});

describe('ports on user-named sites', () => {
  it('allows only default ports when no port was written', () => {
    userSaid('look at example.com');
    expect(isReadUrlAllowed('https://example.com/x')).toBe(true);
    expect(isReadUrlAllowed('http://example.com:80/x')).toBe(true);
    expect(isReadUrlAllowed('https://example.com:443/x')).toBe(true);
    expect(isReadUrlAllowed('https://example.com:8443/x')).toBe(false);
    expect(isReadUrlAllowed('http://example.com:22/')).toBe(false);
  });

  it('allows exactly the port the user wrote, plus the default', () => {
    userSaid('my server is example.com:8080/admin');
    expect(isReadUrlAllowed('https://example.com:8080/x')).toBe(true);
    expect(isReadUrlAllowed('https://example.com/x')).toBe(true);
    expect(isReadUrlAllowed('https://example.com:8081/x')).toBe(false);
  });
});

describe('isDowngrade', () => {
  it('flags https -> http only', () => {
    expect(isDowngrade('https://a.test/', 'http://a.test/')).toBe(true);
    expect(isDowngrade('http://a.test/', 'https://a.test/')).toBe(false);
    expect(isDowngrade('https://a.test/', 'https://a.test/x')).toBe(false);
    expect(isDowngrade('not a url', 'https://a.test/')).toBe(true);
  });
});

describe('http and https are the same page', () => {
  it('matches either scheme and fetches the allowed entry', () => {
    allowReadUrls(['http://plain.test/a']);
    expect(matchReadUrl('https://plain.test/a')).toBe('http://plain.test/a');
    allowReadUrls(['https://secure.test/a']);
    expect(matchReadUrl('http://secure.test/a')).toBe('https://secure.test/a');
  });

  it('prefers https when both versions are allowed, in either order', () => {
    allowReadUrls(['https://both.test/a', 'http://both.test/a']);
    expect(matchReadUrl('http://both.test/a')).toBe('https://both.test/a');
    allowReadUrls(['http://other.test/a', 'https://other.test/a']);
    expect(matchReadUrl('http://other.test/a')).toBe('https://other.test/a');
  });
});
