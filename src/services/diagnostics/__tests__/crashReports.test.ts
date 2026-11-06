import {NativeModules, Platform} from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});

import {
  describeExit,
  describeJsError,
  installJsErrorRecorder,
  loadCrashReports,
  takeNewCrashReports,
  usableMemoryBytes,
} from '../crashReports';

const lowMemory = {
  reason: 3,
  status: 0,
  description: 'lmk',
  timestamp: 2000,
  pssKb: 2_500_000,
  rssKb: 2_700_000,
};
const nativeCrash = {
  reason: 5,
  status: 6,
  description: 'crash',
  timestamp: 3000,
  pssKb: 0,
  rssKb: 0,
  trace:
    'Abort message\nbacktrace:\n#00 pc 1234 /data/app/lib/arm64/librnwhisper.so',
};

describe('crash reports', () => {
  const native = {
    getLastExits: jest.fn(),
    readJsError: jest.fn(),
    recordJsError: jest.fn(() => true),
    memoryInfo: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'android');
    NativeModules.AppDiagnostics = native;
    native.getLastExits.mockResolvedValue([]);
    native.readJsError.mockResolvedValue(null);
  });

  it('explains a low-memory close', () => {
    expect(describeExit(lowMemory)).toMatchObject({
      kind: 'Low memory',
      summary:
        'Android closed PocketAgent to free memory (it was using 2441 MB).',
    });
  });

  it('names the library a native crash happened in', () => {
    const r = describeExit(nativeCrash)!;
    expect(r.summary).toBe(
      'PocketAgent crashed in native code (librnwhisper.so).',
    );
    expect(r.details).toContain('Trace:');
  });

  it('ignores normal exits (user closed it, app updated)', () => {
    expect(describeExit({reason: 10, timestamp: 1})).toBeNull();
    expect(describeExit({reason: 1, timestamp: 1})).toBeNull();
    expect(describeExit({reason: 16, timestamp: 1})).toBeNull();
  });

  it('reads a saved app error', () => {
    expect(
      describeJsError('5000\nTypeError: x is undefined\n  at foo'),
    ).toMatchObject({
      time: 5000,
      kind: 'App error',
      summary: 'TypeError: x is undefined',
    });
  });

  it('lists everything, newest first', async () => {
    native.getLastExits.mockResolvedValue([lowMemory, nativeCrash]);
    native.readJsError.mockResolvedValue('2500\nError: boom');
    const reports = await loadCrashReports();
    expect(reports.map(r => r.time)).toEqual([3000, 2500, 2000]);
  });

  it('shows each crash once, and not old history on first run', async () => {
    const storage = jest.requireMock(
      '@react-native-async-storage/async-storage',
    );
    await storage.removeItem('@pocketagent/crash-reports/last-seen/v1');
    native.getLastExits.mockResolvedValue([lowMemory]);
    expect(await takeNewCrashReports()).toEqual([]); // first run
    native.getLastExits.mockResolvedValue([nativeCrash, lowMemory]);
    const fresh = await takeNewCrashReports();
    expect(fresh.map(r => r.kind)).toEqual(['Native crash']);
    expect(await takeNewCrashReports()).toEqual([]); // already shown
  });

  it('saves fatal JS errors before the app closes', () => {
    const previous = jest.fn();
    const utils = {
      handler: previous as any,
      getGlobalHandler() {
        return this.handler;
      },
      setGlobalHandler(h: any) {
        this.handler = h;
      },
    };
    (globalThis as any).ErrorUtils = utils;
    installJsErrorRecorder();
    const error = new TypeError('boom');
    utils.handler(error, true);
    expect(native.recordJsError).toHaveBeenCalledWith(
      expect.stringContaining('TypeError: boom'),
    );
    expect(previous).toHaveBeenCalledWith(error, true);
    utils.handler(new Error('not fatal'), false);
    expect(native.recordJsError).toHaveBeenCalledTimes(1);
  });

  it("measures memory above Android's low-memory line", async () => {
    native.memoryInfo.mockResolvedValue({availMem: 1000, threshold: 300});
    expect(await usableMemoryBytes()).toBe(700);
    native.memoryInfo.mockRejectedValue(new Error('no'));
    expect(await usableMemoryBytes()).toBeUndefined();
  });

  it('does nothing off Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    expect(await loadCrashReports()).toEqual([]);
  });
});
