import RNFS from '@dr.pogodin/react-native-fs';

export const FILE_ROOT = RNFS.DocumentDirectoryPath + '/PocketAgentFiles';
export const MAX_FILE_BYTES = 16 * 1024;
const ALLOWED = new Set(['txt','md','json','csv','xml','html','css','js','jsx','ts','tsx','py','java','kt','log','yaml','yml','sh','sql']);

export function safeWorkspaceName(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120 || value !== value.trim() ||
      value.includes('..') || !/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/.test(value)) {
    throw new Error('Use a simple filename without directories');
  }
  const ext = value.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED.has(ext)) {
    throw new Error('This version can edit text/code files only');
  }
  return value;
}

export function utf8Bytes(text: string): number {
  // URI encoding rejects invalid surrogates; fail instead of silently corrupting.
  return encodeURIComponent(text).replace(/%[a-fA-F0-9]{2}/g, 'x').length;
}

export function checkText(text: unknown): string {
  if (typeof text !== 'string') throw new Error('Content must be text');
  if (utf8Bytes(text) > MAX_FILE_BYTES) throw new Error('File exceeds 16 KiB text limit');
  return text;
}

export async function ensureWorkspace(): Promise<void> {
  await RNFS.mkdir(FILE_ROOT);
}

export function workspacePath(name: string): string {
  return FILE_ROOT + '/' + safeWorkspaceName(name);
}

export async function readWorkspace(name: string): Promise<string> {
  const path = workspacePath(name);
  const stat = await RNFS.stat(path);
  if (!stat.isFile() || Number(stat.size) > MAX_FILE_BYTES) throw new Error('File too large or not a regular file');
  return checkText(await RNFS.readFile(path, 'utf8'));
}

export async function importWorkspace(name: string, text: string): Promise<string> {
  await ensureWorkspace();
  const path = workspacePath(name);
  checkText(text);
  if (await RNFS.exists(path)) throw new Error('Filename already exists in workspace; rename the import');
  await RNFS.writeFile(path, text, 'utf8');
  return name;
}
