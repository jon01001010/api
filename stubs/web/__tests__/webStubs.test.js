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

describe('downloads in the desktop app', () => {
  it('downloadFile streams through the native side with begin and progress', async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock('../tauri', () => {
      class Channel {
        constructor(onMessage) {
          this.onMessage = onMessage;
        }
      }
      return {
        isTauri: () => true,
        Channel,
        invoke: async (cmd, args) => {
          calls.push([cmd, args && args.path]);
          if (cmd === 'fs_download') {
            const send = args.onEvent.onMessage;
            send({type: 'begin', statusCode: 200, contentLength: 10});
            send({type: 'progress', bytesWritten: 5, contentLength: 10});
            send({type: 'done', statusCode: 200, bytesWritten: 10});
          }
          return null;
        },
      };
    });
    const fsModule = jest.requireActual('../fs.js').default;
    const seen = [];
    const job = fsModule.downloadFile({
      fromUrl: 'https://huggingface.co/x/resolve/main/m.gguf',
      toFile: '/pocketagent/Documents/models/m.gguf',
      headers: {Authorization: 'Bearer t'},
      begin: r => seen.push(['begin', r.contentLength]),
      progress: r => seen.push(['progress', r.bytesWritten]),
    });
    await expect(job.promise).resolves.toMatchObject({
      statusCode: 200,
      bytesWritten: 10,
    });
    expect(seen).toEqual([
      ['begin', 10],
      ['progress', 5],
    ]);
    expect(calls[0]).toEqual([
      'fs_download',
      '/pocketagent/Documents/models/m.gguf',
    ]);
    fsModule.stopDownload(job.jobId);
    expect(calls.map(c => c[0])).toContain('fs_download_cancel');
    jest.dontMock('../tauri');
  });
});
