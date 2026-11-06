import {createSearchProvider, readWithDefaultReader} from '../index';
import type {SearchProviderId} from '../types';

describe('createSearchProvider', () => {
  it('builds the adapter matching each provider id', () => {
    const ids: SearchProviderId[] = [
      'tavily',
      'brave',
      'exa',
      'firecrawl',
      'parallel',
    ];
    for (const id of ids) {
      expect(createSearchProvider(id, () => 'k').id).toBe(id);
    }
  });

  it('wires the key accessor lazily into the adapter', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    });
    let key = '';
    const provider = createSearchProvider('tavily', () => key);
    // No key yet → adapter throws "key not set" without a network call.
    await expect(provider.search('q', {maxResults: 3})).rejects.toThrow(
      /key not set/i,
    );
    expect(global.fetch).not.toHaveBeenCalled();
    // Accessor is read inside search() (lazy) — later key is picked up.
    key = 'now-set';
    await expect(provider.search('q', {maxResults: 3})).rejects.toThrow(
      /failed/i,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('readWithDefaultReader (the phone reads the page)', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  const response = (body: string, url: string, type = 'text/html') => ({
    ok: true,
    status: 200,
    url,
    headers: {get: (h: string) => (h === 'content-type' ? type : null)},
    text: () => Promise.resolve(body),
  });

  it('fetches the page directly and verifies the final address', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      response(
        '<html><head><title>News &amp; more</title><script>x()</script></head><body><nav>menu</nav><main><h1>Hello</h1><p>World&nbsp;today</p></main></body></html>',
        'https://example.com/article-final',
      ),
    );
    const page = await readWithDefaultReader('https://example.com/article');
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://example.com/article',
    );
    expect(page).toEqual({
      url: 'https://example.com/article-final',
      finalUrlVerified: true,
      title: 'News & more',
      text: 'Hello\n\nWorld today',
    });
  });

  it('cannot verify without the final address, and refuses non-pages', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response('plain words', '', 'text/plain'),
    );
    expect(await readWithDefaultReader('https://e.com/a.txt')).toEqual({
      url: 'https://e.com/a.txt',
      finalUrlVerified: false,
      text: 'plain words',
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response('PK…', 'https://e.com/a.zip', 'application/zip'),
    );
    await expect(readWithDefaultReader('https://e.com/a.zip')).rejects.toThrow(
      /not a readable page/,
    );
  });

  it('throws on a non-ok reader response (never silent)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve(''),
    });
    await expect(
      readWithDefaultReader('https://example.com/x'),
    ).rejects.toThrow(/failed/i);
  });
});

describe('htmlToText', () => {
  const {htmlToText, decodeEntities} = require('../htmlToText');

  it('keeps list items and paragraphs apart and drops page furniture', () => {
    const {text} = htmlToText(
      '<body><header><nav>Home | About</nav></header><article><h2>Steps</h2><ul><li>One</li><li>Two &#8212; done</li></ul><footer>© 2026</footer></article><form>login</form></body>',
    );
    expect(text).toBe('Steps\n\n• One\n• Two — done');
  });

  it('decodes common entities, leaves unknown ones', () => {
    expect(decodeEntities('a&amp;b &lt;c&gt; &#x41; &bogus;')).toBe(
      'a&b <c> A &bogus;',
    );
  });
});
