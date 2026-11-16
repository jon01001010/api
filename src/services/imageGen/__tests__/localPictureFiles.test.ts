import {
  IMAGE_MODEL_SETS,
  LOCAL_KIND_SD15,
  findPictureFiles,
  installedSet,
  localId,
  localSets,
  readLocalRecords,
  registerPictureFile,
  stopUsingFile,
} from '../imageModels';

/** A tiny folder tree: path → size (files) or null (folders). */
const mockTree = new Map<string, number | null>();
const mockText = new Map<string, string>();

const mockEntry = (path: string) => {
  const size = mockTree.get(path);
  return {
    name: path.split('/').pop(),
    path,
    size: size ?? 0,
    isFile: () => typeof size === 'number',
    isDirectory: () => size === null,
  };
};

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  mkdir: jest.fn(() => Promise.resolve()),
  exists: jest.fn((p: string) =>
    Promise.resolve(mockTree.has(p) || mockText.has(p)),
  ),
  readFile: jest.fn((p: string) =>
    mockText.has(p)
      ? Promise.resolve(mockText.get(p))
      : Promise.reject(new Error('no file')),
  ),
  writeFile: jest.fn((p: string, text: string) => {
    mockText.set(p, text);
    return Promise.resolve();
  }),
  readDir: jest.fn((dir: string) =>
    Promise.resolve(
      [...mockTree.keys()]
        .filter(
          p =>
            p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/'),
        )
        .map(mockEntry),
    ),
  ),
  stat: jest.fn((p: string) =>
    mockTree.has(p)
      ? Promise.resolve(mockEntry(p))
      : Promise.reject(new Error('no file')),
  ),
}));

const SD = 'stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf';
const SETS = '/docs/image-models/local-sets.json';

beforeEach(() => {
  mockTree.clear();
  mockText.clear();
  for (const dir of [
    '/docs/models',
    '/docs/models/hf',
    '/docs/models/hf/second-state',
    '/docs/models/hf/second-state/stable-diffusion-v1-5-GGUF',
    '/docs/models/hf/city96',
    '/docs/models/hf/city96/FLUX.1-schnell-gguf',
    '/docs/models/hf/Qwen',
    '/docs/models/hf/Qwen/Qwen3-4B-GGUF',
  ]) {
    mockTree.set(dir, null);
  }
  mockTree.set(
    `/docs/models/hf/second-state/stable-diffusion-v1-5-GGUF/${SD}`,
    1_570_000_000,
  );
  mockTree.set(
    '/docs/models/hf/city96/FLUX.1-schnell-gguf/flux1-schnell-Q4_K_S.gguf',
    6_800_000_000,
  );
  mockTree.set(
    '/docs/models/hf/Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf',
    2_500_000_000,
  );
});

describe('picture models already downloaded (desktop Toolbox)', () => {
  it('lists the picture files in the models folder, not the chat models', async () => {
    const files = await findPictureFiles();
    expect(files.map(f => [f.name, f.usable, f.id])).toEqual([
      ['flux1-schnell-Q4_K_S.gguf', false, null],
      [SD, true, null],
    ]);
    expect(files[1].file).toBe(
      `hf/second-state/stable-diffusion-v1-5-GGUF/${SD}`,
    );
    expect(files[1].size).toBe(1_570_000_000);
  });

  it('"Use this file for pictures" keeps a record with an id, place and kind, never a full path', async () => {
    const [, sd] = await findPictureFiles();
    const id = await registerPictureFile(sd);
    expect(id).toMatch(/^local-[a-z0-9-]+$/);
    const saved = JSON.parse(mockText.get(SETS)!);
    expect(saved).toEqual({
      sets: [
        {
          id,
          file: `hf/second-state/stable-diffusion-v1-5-GGUF/${SD}`,
          kind: LOCAL_KIND_SD15,
        },
      ],
    });
    // Picked twice: one record.
    expect(await registerPictureFile(sd)).toBe(id);
    expect(await readLocalRecords()).toHaveLength(1);
    expect((await findPictureFiles())[1].id).toBe(id);

    // It is a set like the list's own: size, SD 1.5's licence and use rules.
    const [set] = await localSets();
    expect(set.id).toBe(id);
    expect(set.kind).toBe('sd');
    expect(set.files[0].approxBytes).toBe(1_570_000_000);
    expect(set.licence).toBe('CreativeML OpenRAIL-M');
    expect(set.useRules).toContain('minors');
    expect(set.recommendedVramGb).toBe(4);

    await stopUsingFile(id);
    expect(await readLocalRecords()).toEqual([]);
    // The file itself stays.
    expect(
      mockTree.has(
        `/docs/models/hf/second-state/stable-diffusion-v1-5-GGUF/${SD}`,
      ),
    ).toBe(true);
  });

  it('only SD 1.5 in one file can be used, and only inside the models folder', async () => {
    const [flux, sd] = await findPictureFiles();
    await expect(registerPictureFile(flux)).rejects.toThrow(
      'Stable Diffusion 1.5',
    );
    await expect(
      registerPictureFile({...sd, file: `../outside/${SD}`}),
    ).rejects.toThrow('not inside the models folder');
    expect(mockText.has(SETS)).toBe(false);
    // A damaged or edited record is not used.
    mockText.set(
      SETS,
      JSON.stringify({
        sets: [
          {id: 'local-a', file: `../x/${SD}`, kind: LOCAL_KIND_SD15},
          {id: 'local-b', file: 'hf/missing.gguf', kind: LOCAL_KIND_SD15},
          {id: 'local-c', file: `hf/x/${SD}`, kind: 'sdxl'},
        ],
      }),
    );
    expect(await localSets()).toEqual([]);
    mockText.set(SETS, 'not json');
    expect(await readLocalRecords()).toEqual([]);
  });

  it('ids are plain', () => {
    expect(localId(`hf/a/b/${SD}`)).toMatch(/^local-[a-z0-9-]+$/);
    expect(localId('hf/a/b/Ü.gguf')).toBe('local-hf-a-b');
  });

  it('with several downloaded, the one that fits the graphics card is used', async () => {
    const [, sd] = await findPictureFiles();
    const id = await registerPictureFile(sd);
    // Nothing from the list is downloaded: the picked file.
    expect((await installedSet())?.id).toBe(id);
    const card = (gb: number) => [{totalMemory: gb * 1e9, shared: false}];
    expect((await installedSet(card(8)))?.id).toBe(id);
    expect(IMAGE_MODEL_SETS[0].recommendedVramGb).toBeGreaterThan(4);
  });
});
