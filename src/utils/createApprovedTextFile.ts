import RNFS from '@dr.pogodin/react-native-fs';

/**
 * Create a new UTF-8 text file in PocketAgent's private Documents directory.
 * This helper does not grant agent access: callers must obtain explicit user
 * approval for the proposed filename and contents before invoking it.
 */
const MAX_BYTES = 1024 * 1024;
const SAFE_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}\.(txt|md|json|csv|html|css|js|ts|xml)$/i;

export type CreatedFile = {path: string; name: string; bytes: number};

export async function createApprovedTextFile(
  filename: string,
  content: string,
  approved: boolean,
): Promise<CreatedFile> {
  if (!approved) throw new Error('Explicit user approval required');
  if (!SAFE_FILENAME.test(filename) || filename.includes('..') || filename.trim() !== filename) {
    throw new Error('Invalid filename or unsupported file type');
  }
  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MAX_BYTES) throw new Error('File exceeds 1 MiB limit');
  const directory = RNFS.DocumentDirectoryPath + '/PocketAgentFiles';
  await RNFS.mkdir(directory);
  const path = directory + '/' + filename;
  if (await RNFS.exists(path)) throw new Error('File already exists; overwrite requires separate approval');
  await RNFS.writeFile(path, content, 'utf8');
  return {path, name: filename, bytes};
}
