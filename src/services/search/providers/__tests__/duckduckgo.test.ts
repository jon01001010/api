import {
  DuckDuckGoProvider,
  parseResults,
  unwrapResultLink,
} from '../duckduckgo';

// The shape of DuckDuckGo's HTML results page (trimmed).
const PAGE = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcats&amp;rut=abc">Cats &amp; hats</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fcats">All about <b>black</b> cats.</a>
</div>
<div class="result results_links web-result result--ad">
  <a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x">Ad</a>
</div>
<div class="result results_links web-result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.test%2Fa%3Fid%3D1">News</a>
  <a class="result__snippet">Second &#8212; result</a>
</div>`;

describe('DuckDuckGo search (no key)', () => {
  it('reads titles, real links and snippets, skipping ads', () => {
    expect(parseResults(PAGE, 5)).toEqual([
      {
        title: 'Cats & hats',
        url: 'https://example.com/cats',
        snippet: 'All about black cats.',
      },
      {
        title: 'News',
        url: 'https://news.test/a?id=1',
        snippet: 'Second — result',
      },
    ]);
    expect(parseResults(PAGE, 1)).toHaveLength(1);
  });

  it('unwraps redirect links and refuses odd schemes', () => {
    expect(
      unwrapResultLink('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2F'),
    ).toBe('https://a.test/');
    expect(unwrapResultLink('javascript:alert(1)')).toBeNull();
  });

  it('searches with no key, through the phone', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {get: () => null},
      text: () => Promise.resolve(PAGE),
    });
    const hits = await new DuckDuckGoProvider().search('black cats', {
      maxResults: 5,
    });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://html.duckduckgo.com/html/?q=black%20cats',
    );
    expect(hits).toHaveLength(2);
  });

  it('says so when DuckDuckGo is limiting searches', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {get: () => null},
      text: () =>
        Promise.resolve(
          '<p>Unfortunately, bots use DuckDuckGo too. anomaly</p>',
        ),
    });
    await expect(
      new DuckDuckGoProvider().search('x', {maxResults: 5}),
    ).rejects.toThrow(/limiting searches/);
  });
});
