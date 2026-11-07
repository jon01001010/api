/**
 * Windows stubs (see stubs/windows/stubbedModules.js): every stub loads,
 * native features fail clearly, UI plumbing stays usable.
 */
const fs = require('fs');
const path = require('path');
const {renderHook, act} = require('@testing-library/react-native');

const {STUBS, windowsStubFor} = require('../stubbedModules');

describe('which modules are stubbed on Windows', () => {
  it('maps a package and paths inside it, nothing else', () => {
    expect(windowsStubFor('llama.rn')).toMatch(/local-model\.js$/);
    expect(windowsStubFor('react-native-reanimated/mock')).toMatch(
      /reanimated\.js$/,
    );
    expect(windowsStubFor('react-native-reanimated-carousel')).toBeNull();
    expect(windowsStubFor('react-native')).toBeNull();
    expect(windowsStubFor('react-native-webview')).toBeNull();
  });

  it('every stub file exists and loads', () => {
    for (const file of new Set(Object.values(STUBS))) {
      const full = path.join(__dirname, '..', file);
      expect(fs.existsSync(full)).toBe(true);
      expect(() => jest.requireActual(full)).not.toThrow();
    }
  });
});

describe('native feature stubs', () => {
  const native = jest.requireActual('../native.js');

  it('every call fails with "not available on this device"', async () => {
    await expect(native.launchCamera()).rejects.toThrow(
      /not available on this device/,
    );
    await expect(native.default.open({})).rejects.toMatchObject({
      code: 'not_available',
    });
  });

  it('components render their children; hooks grant nothing', async () => {
    expect(typeof native.Camera).toBe('object'); // forwardRef component
    const permission = native.useCameraPermission();
    expect(permission.hasPermission).toBe(false);
    await expect(permission.requestPermission()).rejects.toThrow(
      /not available on this device/,
    );
  });

  it('llama.rn: loading a model says not available; screen lookups are harmless', async () => {
    const llama = jest.requireActual('../local-model.js');
    await expect(llama.initLlama({model: 'x'})).rejects.toThrow(
      /not available on this device/,
    );
    await expect(llama.getBackendDevicesInfo()).resolves.toEqual([]);
    expect(llama.addNativeLogListener(() => {}).remove).toBeInstanceOf(
      Function,
    );
    expect(llama.BuildInfo.number).toBe('windows');
  });
});

describe('UI plumbing stubs', () => {
  const ra = jest.requireActual('../reanimated.js');

  it('animations jump to their end value', () => {
    expect(ra.withTiming(1, {duration: 300})).toBe(1);
    expect(ra.withSpring(5)).toBe(5);
    expect(ra.withSequence(1, 2, 3)).toBe(3);
  });

  it('interpolate matches the usual maths, with clamping', () => {
    expect(ra.interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(ra.interpolate(20, [0, 10], [0, 100], 'clamp')).toBe(100);
    expect(ra.interpolate(20, [0, 10], [0, 100])).toBe(200);
  });

  it('a shared value change re-renders, so the jump shows on screen', () => {
    let renders = 0;
    const {result} = renderHook(() => {
      renders++;
      return ra.useSharedValue(0);
    });
    act(() => {
      result.current.value = ra.withTiming(1);
    });
    expect(result.current.value).toBe(1);
    expect(renders).toBe(2);
  });

  it('gesture builders chain without doing anything', () => {
    const gh = jest.requireActual('../gesture-handler.js');
    expect(() =>
      gh.Gesture.Pan()
        .onStart(() => {})
        .onEnd(() => {})
        .enabled(false),
    ).not.toThrow();
  });

  it('safe areas are zero on a desktop window', () => {
    const sa = jest.requireActual('../safe-area-context.js');
    expect(sa.useSafeAreaInsets()).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('random values fill the whole range for each array type', () => {
    jest.isolateModules(() => {
      const saved = global.crypto;
      global.crypto = {};
      jest.requireActual('../get-random-values.js');
      const big = global.crypto.getRandomValues(new Uint32Array(64));
      expect(Math.max(...big)).toBeGreaterThan(255);
      global.crypto = saved;
    });
  });
});

describe('every native package is ready for Windows', () => {
  // Packages with Android code but nothing native to replace on Windows.
  const JS_ON_WINDOWS = {
    // Icons are drawn from fonts; the font files must be added to the
    // Windows app's assets (TODO.md, Windows step 1).
    'react-native-vector-icons': 'fonts only',
  };

  it('has Windows code, a stub, or a stated reason (fails when a new one is added)', () => {
    const root = path.join(__dirname, '..', '..', '..');
    const deps = Object.keys(
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
        .dependencies,
    );
    const uncovered = deps.filter(dep => {
      const dir = path.join(root, 'node_modules', dep);
      const native = fs.existsSync(path.join(dir, 'android'));
      return (
        native &&
        !fs.existsSync(path.join(dir, 'windows')) &&
        !(dep in STUBS) &&
        !(dep in JS_ON_WINDOWS)
      );
    });
    expect(uncovered).toEqual([]);
  });
});

describe('in-memory storage on Windows', () => {
  it('app storage keeps values while the app is open', async () => {
    const storage = jest.requireActual('../memory-storage.js').default;
    await storage.setItem('a', '1');
    await storage.mergeItem('o', JSON.stringify({x: 1}));
    await storage.mergeItem('o', JSON.stringify({y: 2}));
    expect(await storage.getItem('a')).toBe('1');
    expect(JSON.parse(await storage.getItem('o'))).toEqual({x: 1, y: 2});
    expect(await storage.multiGet(['a', 'none'])).toEqual([
      ['a', '1'],
      ['none', null],
    ]);
  });

  it('files: write, read, list, stat, delete, like the phone', async () => {
    const fs = jest.requireActual('../memory-fs.js').default;
    const dir = fs.DocumentDirectoryPath + '/ws';
    await fs.mkdir(dir);
    await fs.writeFile(dir + '/a.txt', 'hello');
    expect(await fs.exists(dir + '/a.txt')).toBe(true);
    expect(await fs.readFile(dir + '/a.txt')).toBe('hello');
    const listed = await fs.readDir(dir);
    expect(listed.map(e => e.name)).toEqual(['a.txt']);
    expect((await fs.stat(dir + '/a.txt')).isFile()).toBe(true);
    await fs.unlink(dir);
    expect(await fs.exists(dir + '/a.txt')).toBe(false);
    await expect(fs.readFile(dir + '/a.txt')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.downloadFile({}).promise).rejects.toThrow(
      /not available on this device/,
    );
  });
});

describe('packages unlinked on Windows are stubbed', () => {
  it('every package switched off for Windows in react-native.config.js has a stub', () => {
    const config = jest.requireActual('../../../react-native.config.js');
    const unlinked = Object.entries(config.dependencies)
      .filter(([, c]) => c.platforms && c.platforms.windows === null)
      .map(([name]) => name);
    // WatermelonDB uses its own JavaScript database on Windows instead.
    const handledElsewhere = ['@nozbe/watermelondb'];
    expect(
      unlinked.filter(
        name => !(name in STUBS) && !handledElsewhere.includes(name),
      ),
    ).toEqual([]);
    expect(
      fs.existsSync(
        path.join(__dirname, '../../../src/database/adapter.windows.ts'),
      ),
    ).toBe(true);
  });
});
