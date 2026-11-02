import * as RNFS from '@dr.pogodin/react-native-fs';

export const FILE_ROOT = RNFS.DocumentDirectoryPath + '/PocketAgentFiles';
/** Existing model text tools intentionally keep a small, bounded context. */
export const MAX_FILE_BYTES = 16 * 1024;
/** Binary documents may be stored but are never decoded as prompt text. */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'xml', 'html', 'css', 'js', 'jsx', 'ts',
  'tsx', 'py', 'java', 'kt', 'log', 'yaml', 'yml', 'sh', 'sql',
]);

/** Files are always addressed by a single workspace basename, never an OS path. */
export function safeWorkspaceName(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 120 ||
      value !== value.trim() || value.includes('..') ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/.test(value)) {
    throw new Error('Use a simple filename without directories');
  }
  return value;
}

export function isEditableTextName(name: string): boolean {
  const extension = name.split('.').pop()?.toLowerCase();
  return Boolean(extension && TEXT_EXTENSIONS.has(extension));
}

export function assertEditableTextName(name: string): string {
  safeWorkspaceName(name);
  if (!isEditableTextName(name)) {
    throw new Error('Unsupported filename: ' + name + '. Use a full text/code filename such as test.txt or notes.md. Do not edit an unrelated existing file as a workaround.');
  }
  return name;
}

/** Sanitize SAF display names to safe workspace names while retaining extension. */
export function normalizeImportName(original: unknown): string {
  const raw = typeof original === 'string' ? original : 'document.bin';
  const base = raw.replace(/\\/g, '/').split('/').pop() || 'document.bin';
  let clean = base.replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\.{2,}/g, '.').trim().replace(/^[^a-zA-Z0-9]+/, '');
  if (!clean || !clean.includes('.')) clean = (clean || 'document') + '.bin';
  if (clean.length > 120) {
    const ext = clean.slice(clean.lastIndexOf('.'));
    clean = clean.slice(0, Math.max(1, 120 - ext.length)) + ext;
  }
  return safeWorkspaceName(clean);
}

export function utf8Bytes(text: string): number {
  // URI encoding rejects invalid surrogate pairs instead of silently corrupting data.
  return encodeURIComponent(text).replace(/%[a-fA-F0-9]{2}/g, 'x').length;
}

export function checkText(text: unknown): string {
  if (typeof text !== 'string') throw new Error('Content must be text');
  if (utf8Bytes(text) > MAX_FILE_BYTES) throw new Error('Text exceeds 16 KiB limit');
  return text;
}

export async function ensureWorkspace(): Promise<void> {
  await RNFS.mkdir(FILE_ROOT);
}

export function workspacePath(name: string): string {
  return FILE_ROOT + '/' + safeWorkspaceName(name);
}

export async function readWorkspace(name: string): Promise<string> {
  assertEditableTextName(name);
  const path = workspacePath(name);
  const stat = await RNFS.stat(path);
  if (!stat.isFile() || Number(stat.size) > MAX_FILE_BYTES) {
    throw new Error('Text file is too large or not a regular file');
  }
  return checkText(await RNFS.readFile(path, 'utf8'));
}

/** An import never overwrites a prior import or a model-edited workspace file. */
async function availableImportName(original: string): Promise<string> {
  const name = normalizeImportName(original);
  const index = name.lastIndexOf('.');
  const stem = name.slice(0, index);
  const ext = name.slice(index);
  for (let suffix = 0; suffix < 1000; suffix++) {
    const tail = suffix ? '-' + (suffix + 1) : '';
    const candidate = stem.slice(0, 120 - ext.length - tail.length) + tail + ext;
    if (!(await RNFS.exists(workspacePath(candidate)))) return candidate;
  }
  throw new Error('Too many imports with the same filename');
}

/** Import previously copied, locally accessible bytes; never interpret binary data. */
export async function importWorkspaceCopy(
  originalName: string,
  localPath: string,
  size: number,
): Promise<string> {
  if (!Number.isFinite(size) || size < 0 || size > MAX_IMPORT_BYTES) {
    throw new Error('File exceeds the 32 MiB import limit');
  }
  await ensureWorkspace();
  const name = await availableImportName(originalName);
  if (isEditableTextName(name) && size > MAX_FILE_BYTES) {
    throw new Error('Text/code files currently have a 16 KiB limit');
  }
  const destination = workspacePath(name);
  try {
    await RNFS.copyFile(localPath, destination);
    const copied = await RNFS.stat(destination);
    if (!copied.isFile() || Number(copied.size) !== size) {
      throw new Error('Imported file did not match the source size');
    }
    return name;
  } catch (error) {
    if (await RNFS.exists(destination)) await RNFS.unlink(destination).catch(() => undefined);
    throw error;
  }
}

/** Used when a text-only import is already in memory. */
export async function importWorkspace(name: string, text: string): Promise<string> {
  assertEditableTextName(normalizeImportName(name));
  checkText(text);
  await ensureWorkspace();
  const unique = await availableImportName(name);
  await RNFS.writeFile(workspacePath(unique), text, 'utf8');
  return unique;
}
