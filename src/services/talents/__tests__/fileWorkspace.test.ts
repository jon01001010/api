import RNFS from '@dr.pogodin/react-native-fs';
import {
  MAX_IMPORT_BYTES, importWorkspaceCopy, isEditableTextName,
  normalizeImportName, safeWorkspaceName,
} from '../fileWorkspace';

jest.mock('@dr.pogodin/react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/private/documents',
    mkdir: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    copyFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({size: 12, isFile: () => true}),
    unlink: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('hello world!'),
  },
}));

const fsMock = RNFS as jest.Mocked<typeof RNFS>;

beforeEach(() => {
  jest.clearAllMocks();
  (fsMock.exists as jest.Mock).mockResolvedValue(false);
  (fsMock.stat as jest.Mock).mockResolvedValue({size: 12, isFile: () => true});
});

describe('Android SAF workspace imports', () => {
  it('accepts text and PNG basenames but never arbitrary paths', () => {
    expect(normalizeImportName('notes (1).txt')).toBe('notes _1_.txt');
    expect(normalizeImportName('camera/photo.png')).toBe('photo.png');
    expect(() => safeWorkspaceName('../secret.txt')).toThrow();
    expect(isEditableTextName('notes.txt')).toBe(true);
    expect(isEditableTextName('photo.png')).toBe(false);
  });

  it('preserves a previous import with an incremented filename', async () => {
    (fsMock.exists as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const name = await importWorkspaceCopy('notes.txt', '/cache/notes.txt', 12);
    expect(name).toBe('notes-2.txt');
    expect(fsMock.copyFile).toHaveBeenCalledWith(
      '/cache/notes.txt', '/private/documents/PocketAgentFiles/notes-2.txt',
    );
  });

  it('stores PNG bytes without decoding or changing them', async () => {
    const name = await importWorkspaceCopy('photo.png', '/cache/photo.png', 12);
    expect(name).toBe('photo.png');
    expect(fsMock.copyFile).toHaveBeenCalledWith(
      '/cache/photo.png', '/private/documents/PocketAgentFiles/photo.png',
    );
    expect(fsMock.readFile).not.toHaveBeenCalled();
  });

  it('refuses oversized imports before calling the filesystem', async () => {
    await expect(importWorkspaceCopy('large.png', '/cache/large.png', MAX_IMPORT_BYTES + 1))
      .rejects.toThrow('32 MiB');
    expect(fsMock.copyFile).not.toHaveBeenCalled();
  });
});
