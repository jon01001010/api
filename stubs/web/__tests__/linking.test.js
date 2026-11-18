/**
 * Links on the desktop (security review 2, 2026-11-18): react-native-web's
 * Linking.openURL uses window.open, which the desktop window blocks; web
 * pages and e-mail drafts go to the native open_external, which asks.
 */
describe('Linking.openURL on the desktop', () => {
  let RN;
  let invoke;
  let opened;
  beforeEach(() => {
    jest.resetModules();
    opened = [];
    invoke = jest.fn(async () => undefined);
    global.window = {
      __TAURI_INTERNALS__: {invoke},
      open: (...args) => opened.push(args),
      location: {href: 'http://tauri.localhost/'},
    };
    RN = require('../react-native');
  });
  afterEach(() => {
    delete global.window;
  });

  it('web pages and e-mail drafts go to open_external, which asks', async () => {
    await RN.Linking.openURL('https://example.org/a?b=c');
    await RN.Linking.openURL(' mailto:a@b.c?subject=Hi ');
    expect(invoke.mock.calls).toEqual([
      ['open_external', {target: 'https://example.org/a?b=c', thinking: null}],
      ['open_external', {target: 'mailto:a@b.c?subject=Hi', thinking: null}],
    ]);
    expect(opened).toEqual([]);
  });

  it('a "no" in the native question is not an error', async () => {
    invoke.mockRejectedValueOnce('The user said no. Nothing was opened.');
    await expect(
      RN.Linking.openURL('https://example.org/'),
    ).resolves.toBeUndefined();
  });

  it('anything else is never sent to the native side', async () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'tel:1']) {
      try {
        await RN.Linking.openURL(url);
      } catch {}
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});
