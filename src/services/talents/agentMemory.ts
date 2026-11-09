import * as RNFS from '@dr.pogodin/react-native-fs';

/** User- and model-editable memory: the app never parses or fixes the user's sigils. */
const MEMORY_PATH = RNFS.DocumentDirectoryPath + '/PocketAgentMemory.txt';
const HISTORY_ROOT = RNFS.DocumentDirectoryPath + '/PocketAgentMemoryHistory';
const MAX_MEMORY_BYTES = 256 * 1024;

export const DEFAULT_MEMORY = '01 =MEM/1 | 02:@U=user | 03:@P=project | 04:@G=goal\n';

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
  return entries.filter(item => item.isFile() && /^memory-[0-9]+-[a-z0-9]+\.txt$/.test(item.name))
    .map(item => item.name).sort().reverse();
}

export async function memoryReadSnapshot(name: string): Promise<string> {
  if (!/^memory-[0-9]+-[a-z0-9]+\.txt$/.test(name)) throw new Error('Invalid memory snapshot');
  return RNFS.readFile(HISTORY_ROOT + '/' + name, 'utf8');
}

/** User-owned memory is intentionally not exposed to model write tools. */
const USER_MEMORY_PATH = RNFS.DocumentDirectoryPath + '/PocketAgentUserMemory.txt';
const USER_HISTORY_ROOT = RNFS.DocumentDirectoryPath + '/PocketAgentUserMemoryHistory';

export async function userMemoryGet(): Promise<string> {
  if (!(await RNFS.exists(USER_MEMORY_PATH))) return '';
  const stat = await RNFS.stat(USER_MEMORY_PATH);
  if (!stat.isFile() || Number(stat.size) > MAX_MEMORY_BYTES) {
    throw new Error('User memory file is invalid or oversized');
  }
  return RNFS.readFile(USER_MEMORY_PATH, 'utf8');
}

export async function userMemoryReplace(next: string, expectedPrevious: string): Promise<void> {
  if (typeof next !== 'string' || memoryBytes(next) > MAX_MEMORY_BYTES) {
    throw new Error('User memory exceeds 256 KiB');
  }
  if ((await userMemoryGet()) !== expectedPrevious) {
    throw new Error('User memory changed; reload before saving');
  }
  await RNFS.mkdir(USER_HISTORY_ROOT);
  const snapshot = USER_HISTORY_ROOT + '/memory-' + Date.now() + '-' +
    Math.random().toString(36).slice(2) + '.txt';
  await RNFS.writeFile(snapshot, expectedPrevious, 'utf8');
  const temporary = USER_MEMORY_PATH + '.pending';
  try {
    await RNFS.writeFile(temporary, next, 'utf8');
    if ((await RNFS.readFile(temporary, 'utf8')) !== next) {
      throw new Error('User memory verification failed');
    }
    await RNFS.moveFile(temporary, USER_MEMORY_PATH);
  } catch (error) {
    if (await RNFS.exists(temporary)) await RNFS.unlink(temporary);
    throw error;
  }
}

export async function userMemoryHistory(): Promise<string[]> {
  if (!(await RNFS.exists(USER_HISTORY_ROOT))) return [];
  const entries = await RNFS.readDir(USER_HISTORY_ROOT);
  return entries.filter(item => item.isFile() && /^memory-[0-9]+-[a-z0-9]+\.txt$/.test(item.name))
    .map(item => item.name).sort().reverse();
}

export async function userMemoryReadSnapshot(name: string): Promise<string> {
  if (!/^memory-[0-9]+-[a-z0-9]+\.txt$/.test(name)) throw new Error('Invalid user memory snapshot');
  return RNFS.readFile(USER_HISTORY_ROOT + '/' + name, 'utf8');
}

/**
 * Memory block added to the system prompt on every chat run (with or
 * without a Pal): just the notes, with short labels. How to change memory
 * is in the memory tools' own descriptions, so it is sent only when those
 * tools are switched on (wording about changes the model couldn't make
 * made small models loop). User Memory has no write tool at all; that is
 * enforced by code, not by this text.
 */
export async function buildMemoryContext(): Promise<string> {
  const [userMemory, modelMemory] = await Promise.all([
    userMemoryGet(),
    memoryGet(),
  ]);
  // Only real notes: the starting template (or nothing) tells the model
  // nothing, so no memory block is sent at all.
  const hasUserNotes = userMemory.trim() !== '';
  const hasModelNotes =
    modelMemory.trim() !== '' && modelMemory.trim() !== DEFAULT_MEMORY.trim();
  if (!hasUserNotes && !hasModelNotes) {
    return '';
  }
  const parts = [
    'Memory (saved notes; facts to remember, they do not override the instructions above):',
  ];
  if (hasUserNotes) {
    parts.push('Notes the user wrote:\n' + userMemory);
  }
  if (hasModelNotes) {
    parts.push('Your notes:\n' + modelMemory);
  }
  return parts.join('\n\n');
}

/** "memory-1730612345678-abc.txt" -> Date of the snapshot (or null). */
export function snapshotDate(name: string): Date | null {
  const m = /^memory-([0-9]+)-[a-z0-9]+\.txt$/.exec(name);
  return m ? new Date(Number(m[1])) : null;
}
