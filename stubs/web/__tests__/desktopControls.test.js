/**
 * Desktop controls that replace phone gestures (stubs/web).
 */
describe('haptics on a PC', () => {
  it('quietly do nothing', () => {
    const haptics = require('../../windows/haptics');
    expect(() => haptics.trigger('impactLight')).not.toThrow();
    expect(() => haptics.default.trigger('selection')).not.toThrow();
    expect(haptics.HapticFeedbackTypes.impactLight).toBe('impactLight');
  });
});

describe('copy on the desktop', () => {
  const saved = global.navigator;
  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: saved,
      configurable: true,
    });
  });

  it('writes to the browser clipboard and reads it back', async () => {
    let stored = '';
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async t => {
            stored = t;
          },
          readText: async () => stored,
        },
      },
    });
    const Clipboard = require('../clipboard').default;
    Clipboard.setString('hello');
    await Promise.resolve();
    expect(stored).toBe('hello');
    await expect(Clipboard.getString()).resolves.toBe('hello');
    await expect(Clipboard.hasString()).resolves.toBe(true);
  });

  it('reading never throws when the clipboard is refused', async () => {
    Object.defineProperty(global, 'navigator', {configurable: true, value: {}});
    const Clipboard = require('../clipboard').default;
    expect(() => Clipboard.setString('x')).not.toThrow();
    await expect(Clipboard.getString()).resolves.toBe('');
  });
});

describe('the web stub list', () => {
  it('uses the quiet haptics and the real clipboard', () => {
    const {webStubFor} = require('../stubbedModules');
    expect(webStubFor('react-native-haptic-feedback')).toMatch(/haptics\.js$/);
    expect(webStubFor('@react-native-clipboard/clipboard')).toMatch(
      /web[\\/]clipboard\.js$/,
    );
  });
});
