import * as RNFS from '@dr.pogodin/react-native-fs';

/** User- and model-editable memory: the app never parses or fixes the user's sigils. */
const MEMORY_PATH = RNFS.DocumentDirectoryPath + '/PocketAgentMemory.txt';
const HISTORY_ROOT = RNFS.DocumentDirectoryPath + '/PocketAgentMemoryHistory';
const MAX_MEMORY_BYTES = 256 * 1024;

export const DEFAULT_MEMORY = '01 =MEM/1 | 02:@U=user | 03:@P=project | 04:@G=goal\\n';

function memoryBytes(value: string): number {
  return encodeURIComponent(value).replace(/%[a-fA-F0-9]{2}/g, 'x').length;
}

export async function memoryGet(): Promise<string> {
  if (!(await RNFS.exists(MEMORY_PATH))) return DEFAULT_MEMORY;
  const stat = await RNFS.stat(MEMORY_PATH);
  if (!stat.isFile() || Number(stat.size) > MAX_MEMORY_BYTES) throw new Error('Memory file is invalid or oversized');
  return RNFS.readFile(MEMORY_PATH, 'utf8');
}

/** No schema restrictions: numbering, first line, mappings and sigils are editable. */
export async function memoryReplace(next: string, expectedPrevious: string): Promise<void> {
  if (typeof next !== 'string' || memoryBytes(next) > MAX_MEMORY_BYTES) throw new Error('Memory exceeds 256 KiB');
  const previous = await memoryGet();
  if (previous !== expectedPrevious) throw new Error('Memory changed since it was read; refresh before replacing');
  await RNFS.mkdir(HISTORY_ROOT);
  const snapshot = HISTORY_ROOT + '/memory-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt';
  await RNFS.writeFile(snapshot, previous, 'utf8');
  const temporary = MEMORY_PATH + '.pending';
  try {
    await RNFS.writeFile(temporary, next, 'utf8');
    if (await RNFS.readFile(temporary, 'utf8') !== next) throw new Error('Memory verification failed');
    await RNFS.moveFile(temporary, MEMORY_PATH);
  } catch (error) {
    if (await RNFS.exists(temporary)) await RNFS.unlink(temporary);
    throw error;
  }
}

export async function memoryHistory(): Promise<string[]> {
  if (!(await RNFS.exists(HISTORY_ROOT))) return [];
  const entries = await RNFS.readDir(HISTORY_ROOT);
  return entries.filter(item => item.isFile() && /^memory-[0-9]+-[a-z0-9]+\\.txt$/.test(item.name))
    .map(item => item.name).sort().reverse();
}

export async function memoryReadSnapshot(name: string): Promise<string> {
  if (!/^memory-[0-9]+-[a-z0-9]+\\.txt$/.test(name)) throw new Error('Invalid memory snapshot');
  return RNFS.readFile(HISTORY_ROOT + '/' + name, 'utf8');
}
