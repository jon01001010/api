import {
  ImageModelSet,
  checksumProblem,
  downloadQuestion,
  downloadSet,
  isInstalled,
  verifiedNote,
  IMAGE_MODEL_SETS,
} from '../imageModels';

const mockFiles = new Map<string, string>();
const mockDownloads: {toFile: string; sha256?: string}[] = [];
let mockServed: {sha256?: string; statusCode: number} = {statusCode: 200};

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  mkdir: jest.fn(() => Promise.resolve()),
  exists: jest.fn((p: string) => Promise.resolve(mockFiles.has(p))),
  readFile: jest.fn((p: string) =>
    mockFiles.has(p)
      ? Promise.resolve(mockFiles.get(p))
      : Promise.reject(new Error('no file')),
  ),
  writeFile: jest.fn((p: string, text: string) => {
    mockFiles.set(p, text);
    return Promise.resolve();
  }),
  unlink: jest.fn((p: string) => {
    mockFiles.delete(p);
    return Promise.resolve();
  }),
  downloadFile: jest.fn((options: {toFile: string; sha256?: string}) => {
    mockDownloads.push({toFile: options.toFile, sha256: options.sha256});
    mockFiles.set(options.toFile, 'model bytes');
    return {jobId: 1, promise: Promise.resolve({...mockServed, jobId: 1})};
  }),
}));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const setWith = (
  verified: boolean,
  hashes: (string | null)[],
): ImageModelSet => ({
  ...IMAGE_MODEL_SETS[1],
  id: 'test-set',
  verified,
  files: hashes.map((sha256, i) => ({
    role: 'model',
    name: `m${i}.gguf`,
    url: `https://example.invalid/m${i}.gguf`,
    approxBytes: 1000,
    sha256,
  })),
});

beforeEach(() => {
  mockFiles.clear();
  mockDownloads.length = 0;
  mockServed = {statusCode: 200};
});

describe('picture model checksums', () => {
  it('the list itself: every checksum is a SHA-256; a verified set has one for every file', () => {
    for (const set of IMAGE_MODEL_SETS) {
      expect([set.id, checksumProblem(set)]).toEqual([set.id, null]);
    }
    expect(checksumProblem(setWith(true, [A, null]))).toMatch(/no checksum/);
    expect(checksumProblem(setWith(false, ['abc']))).toMatch(/not a SHA-256/);
    expect(checksumProblem(setWith(false, [A.toUpperCase()]))).toMatch(
      /not a SHA-256/,
    );
    expect(checksumProblem(setWith(true, [A, B]))).toBeNull();
    expect(checksumProblem(setWith(false, [null, null]))).toBeNull();
  });

  it('refuses a set marked verified that has a file without a checksum, before any download', async () => {
    await expect(
      downloadSet(setWith(true, [A, null]), () => {}),
    ).rejects.toThrow(/no checksum. Not downloaded/);
    expect(mockDownloads).toEqual([]);
  });

  it('a set not verified yet still downloads, and says so first', async () => {
    const set = setWith(false, [null]);
    expect(verifiedNote(set)).toMatch(/^Not verified yet/);
    expect(downloadQuestion(set)).toContain('Not verified yet');
    expect(verifiedNote(setWith(true, [A]))).toBeNull();
    expect(downloadQuestion(setWith(true, [A]))).not.toContain(
      'Not verified yet',
    );
    await downloadSet(set, () => {});
    expect(mockDownloads).toEqual([
      {toFile: '/docs/image-models/test-set/m0.gguf', sha256: undefined},
    ]);
    expect(await isInstalled(set)).toBe(true);
  });

  it('passes the checksum to the downloader and keeps a matching file, with its note', async () => {
    const set = setWith(true, [A]);
    mockServed = {statusCode: 200, sha256: A};
    await downloadSet(set, () => {});
    expect(mockDownloads[0].sha256).toBe(A);
    expect(mockFiles.get('/docs/image-models/test-set/m0.gguf.sha256')).toBe(A);
    expect(await isInstalled(set)).toBe(true);
  });

  it('deletes a file whose SHA-256 does not match, or that came back unchecked', async () => {
    const set = setWith(true, [A]);
    for (const served of [{sha256: B}, {}]) {
      mockServed = {statusCode: 200, ...served};
      await expect(downloadSet(set, () => {})).rejects.toThrow(
        /SHA-256 doesn't match/,
      );
      expect(mockFiles.has('/docs/image-models/test-set/m0.gguf')).toBe(false);
      expect(await isInstalled(set)).toBe(false);
    }
  });

  it('an existing file with a checksum but no check note is downloaded again', async () => {
    const set = setWith(true, [A]);
    mockFiles.set('/docs/image-models/test-set/m0.gguf', 'old unchecked');
    expect(await isInstalled(set)).toBe(false);
    mockServed = {statusCode: 200, sha256: A};
    await downloadSet(set, () => {});
    expect(mockDownloads).toHaveLength(1);
    expect(await isInstalled(set)).toBe(true);
    // A note for another checksum doesn't count.
    mockFiles.set('/docs/image-models/test-set/m0.gguf.sha256', B);
    expect(await isInstalled(set)).toBe(false);
  });
});
