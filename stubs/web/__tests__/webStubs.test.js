/**
 * Web stubs (the Windows app via Tauri; see stubs/web/stubbedModules.js).
 */
const fs = require('fs');
const path = require('path');

const {STUBS, webStubFor} = require('../stubbedModules');

describe('which modules are stubbed on the web', () => {
  it('maps a package and paths inside it, nothing else', () => {
    expect(webStubFor('llama.rn')).toMatch(/local-model\.js$/);
    expect(webStubFor('react-native-webview/lib/WebView')).toMatch(
      /native\.js$/,
    );
    // These support the web themselves, so they are not stubbed.
    for (const name of [
      'react-native-reanimated',
      'react-native-gesture-handler',
      'react-native-safe-area-context',
      'react-native-screens',
      '@react-native-async-storage/async-storage',
      'react-native-svg',
    ]) {
      expect(webStubFor(name)).toBeNull();
    }
  });

  it('every stub file exists and loads', () => {
    for (const file of new Set(Object.values(STUBS))) {
      expect(fs.existsSync(file)).toBe(true);
      expect(() => jest.requireActual(file)).not.toThrow();
    }
  });

  it('the chat database has a web version saved in browser storage', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/database/adapter.web.ts'),
      'utf8',
    );
    expect(src).toContain('LokiJSAdapter');
    expect(src).toContain('useIncrementalIndexedDB: true');
  });

  it('the HTML preview stays off on the web until its lock is built and checked', () => {
    expect(webStubFor('react-native-webview')).toMatch(/native\.js$/);
  });
});
