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
      /webview\.js$/,
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

  it('the HTML preview is the sandboxed desktop frame', () => {
    expect(webStubFor('react-native-webview')).toMatch(/web[\\/]webview\.js$/);
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'webview.js'),
      'utf8',
    );
    // Scripts only: no same-origin, pop-ups, forms, downloads or top navigation.
    expect(src).toContain("const SANDBOX = 'allow-scripts';");
    expect(src).not.toMatch(/allow-(same-origin|popups|forms|downloads|top)/);
    // Only the page the app built (source.html), shown from the checked
    // preview address; a page address (source.uri) is never used.
    expect(src).toContain("typeof source.html === 'string'");
    expect(src).toContain('src: url,');
    expect(src).not.toContain('source.uri)');
  });
});

describe('downloads in the desktop app', () => {
  it('downloadFile streams through the native side with begin and progress', async () => {
    jest.resetModules();
    const calls = [];
    const expectedSha = [];
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
            expectedSha.push(args.sha256);
            const send = args.onEvent.onMessage;
            send({type: 'begin', statusCode: 200, contentLength: 10});
            send({type: 'progress', bytesWritten: 5, contentLength: 10});
            send({
              type: 'done',
              statusCode: 200,
              bytesWritten: 10,
              sha256: 'f'.repeat(64),
            });
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
      sha256: 'f'.repeat(64),
      begin: r => seen.push(['begin', r.contentLength]),
      progress: r => seen.push(['progress', r.bytesWritten]),
    });
    await expect(job.promise).resolves.toMatchObject({
      statusCode: 200,
      bytesWritten: 10,
      sha256: 'f'.repeat(64),
    });
    // The expected checksum reaches the native side.
    expect(expectedSha).toEqual(['f'.repeat(64)]);
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

describe('model memory on a PC', () => {
  const {modelMemoryLimit} = require('../systemInfo');
  const GB = 1e9;
  it('is all memory but room for Windows, not just what is free now', () => {
    // 16 GB PC with only 4 GB free at the moment: a 4B model still fits.
    expect(
      modelMemoryLimit({totalMemory: 16 * GB, availableMemory: 4 * GB}),
    ).toBe(13 * GB);
  });
  it('never less than what is free right now, never below zero', () => {
    expect(
      modelMemoryLimit({totalMemory: 4 * GB, availableMemory: 2 * GB}),
    ).toBe(2 * GB);
    expect(modelMemoryLimit({totalMemory: 1 * GB, availableMemory: 0})).toBe(0);
  });
});

describe('where a model runs on a PC', () => {
  const {modelMemoryLimit, cardMemory, pcFit} = require('../systemInfo');
  const GB = 1e9;
  const GiB = 1024 * 1024 * 1024;
  // The user's PC (2026-11-09): 16 GB memory, an 8 GB graphics card, and
  // the processor's own graphics (uses the PC's memory).
  const pc = {
    totalMemory: 16 * GB,
    availableMemory: 6 * GB,
    gpus: [
      {
        name: 'NVIDIA GeForce',
        totalMemory: 8 * GiB,
        freeMemory: 8 * GiB,
        shared: false,
      },
      {
        name: 'Intel(R) UHD Graphics',
        totalMemory: 8 * GiB,
        freeMemory: 8 * GiB,
        shared: true,
      },
    ],
  };
  it("counts the card's own memory, not built-in graphics", () => {
    expect(cardMemory(pc)).toBe(7 * GiB);
    expect(modelMemoryLimit(pc)).toBe(13 * GB + 7 * GiB);
  });
  it('says card, partly, memory or too big', () => {
    expect(pcFit(3 * GB, pc)).toBe('card');
    expect(pcFit(12 * GB, pc)).toBe('partly');
    expect(pcFit(30 * GB, pc)).toBe('too-big');
    const noCard = {...pc, gpus: []};
    expect(pcFit(3 * GB, noCard)).toBe('memory');
    expect(pcFit(14 * GB, noCard)).toBe('too-big');
  });
});

describe("PC to PC: the phone's HomeLink module on the desktop", () => {
  it('goes to the native link commands with the same answers', async () => {
    jest.resetModules();
    const calls = [];
    jest.doMock('../tauri', () => ({
      isTauri: () => true,
      invoke: async (cmd, args) => {
        calls.push([cmd, args]);
        return JSON.stringify({ok: true, port: 5000});
      },
    }));
    const {NativeModules} = jest.requireActual('../react-native.js');
    const link = NativeModules.HomeLink;
    await link.pair('PA1:P:x:y');
    await link.status('pc');
    await link.startModel('pc');
    await link.sync('pc', '{}');
    await link.questions('pc');
    await link.answerQuestion('pc', 3, false);
    await link.picture('pc', 'a cat', 512, 0, 0);
    await link.tool('pc', 'workspace_read', 'chat-1', '{"file":"a.md"}');
    await link.circle('{"op":"news","homePcs":[]}');
    expect(JSON.parse(await link.openTunnel('pc'))).toEqual({
      ok: true,
      port: 5000,
    });
    await link.closeTunnel();
    expect(calls.map(c => c[0])).toEqual([
      'homelink_pair',
      'homelink_status',
      'homelink_start_model',
      'homelink_sync',
      'homelink_questions',
      'homelink_answer_question',
      'homelink_picture',
      'homelink_tool',
      'link_circle',
      'homelink_open_tunnel',
      'homelink_close_tunnel',
    ]);
    expect(calls[0][1]).toEqual({qr: 'PA1:P:x:y'});
    expect(calls[5][1]).toEqual({pc: 'pc', id: 3, yes: false});
    // 0 = the PC's default: sent as nothing.
    expect(calls[6][1]).toEqual({
      pc: 'pc',
      prompt: 'a cat',
      width: 512,
      height: null,
      steps: null,
    });
    expect(calls[7][1]).toEqual({
      pc: 'pc',
      name: 'workspace_read',
      chat: 'chat-1',
      args: '{"file":"a.md"}',
    });
    // The circle goes to the PC's own removal notices, as JSON.
    expect(calls[8][1]).toEqual({request: '{"op":"news","homePcs":[]}'});
  });
});
