import * as RNFS from '@dr.pogodin/react-native-fs';

import {safeWorkspaceName} from './fileWorkspace';

/**
 * Per-file version history for the private workspace. Every model write
 * snapshots the previous contents here (outside the workspace folder, so
 * snapshots never show up as workspace files). Newest MAX_SNAPSHOTS kept.
 */
export const HISTORY_ROOT =
  RNFS.DocumentDirectoryPath + '/PocketAgentFileHistory';
export const MAX_SNAPSHOTS = 20;
const SNAPSHOT_NAME = /^([0-9]+)-[a-z0-9]+\.txt$/;
let lastSavedAt = 0;

const dirFor = (name: string) => HISTORY_ROOT + '/' + safeWorkspaceName(name);

export interface FileSnapshot {
  id: string;
  savedAt: number;
}

export async function listFileHistory(name: string): Promise<FileSnapshot[]> {
  const dir = dirFor(name);
  if (!(await RNFS.exists(dir))) {
    return [];
  }
  const entries = await RNFS.readDir(dir);
  return entries
    .filter(e => e.isFile() && SNAPSHOT_NAME.test(e.name))
    .map(e => ({id: e.name, savedAt: Number(SNAPSHOT_NAME.exec(e.name)![1])}))
    .sort((a, b) => b.savedAt - a.savedAt || b.id.localeCompare(a.id));
}

export async function saveFileSnapshot(
  name: string,
  content: string,
): Promise<string> {
  const dir = dirFor(name);
  await RNFS.mkdir(dir);
  // Strictly increasing so "newest" is exact even for saves in the same ms.
  lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
  const id =
    lastSavedAt + '-' + Math.random().toString(36).slice(2, 10) + '.txt';
  await RNFS.writeFile(dir + '/' + id, content, 'utf8');
  const all = await listFileHistory(name);
  for (const old of all.slice(MAX_SNAPSHOTS)) {
    await RNFS.unlink(dir + '/' + old.id).catch(() => undefined);
  }
  return id;
}

export async function readFileSnapshot(
  name: string,
  id: string,
): Promise<string> {
  if (!SNAPSHOT_NAME.test(id)) {
    throw new Error('Invalid snapshot id');
  }
  return RNFS.readFile(dirFor(name) + '/' + id, 'utf8');
}
