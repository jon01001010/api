/**
 * Picture models for the PC (desktop app only). The list is data
 * (imageModels.json, also read by src-tauri/src/image_gen.rs); each set is
 * downloaded with the app's own downloader into its own folder
 * (`Documents/image-models/<set>`), size and licence shown first. The native
 * side runs only these files.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNFS from '@dr.pogodin/react-native-fs';

import catalog from './imageModels.json';

export type ImageModelFile = {
  role: string;
  name: string;
  url: string;
  approxBytes: number;
  sha256: string | null;
};
export type ImageModelSet = {
  id: string;
  name: string;
  kind: string;
  licence: string;
  licenceUrl: string;
  licenceNote: string;
  useRules: string | null;
  defaultSteps: number;
  cfgScale: number;
  offloadToCpu: boolean;
  recommendedVramGb: number;
  verified: boolean;
  files: ImageModelFile[];
};

export const IMAGE_MODEL_SETS: ImageModelSet[] = catalog.sets;

/** Licences that may never be listed (non-commercial or unclear). */
export const BANNED_MODEL_NAMES = [
  'flux.1-dev',
  'flux.2-klein-9b',
  'klein-9b',
  'sd-turbo',
  'sdxl-turbo',
];

export const imageModelDir = (set: ImageModelSet) =>
  `${RNFS.DocumentDirectoryPath}/image-models/${set.id}`;

export const setBytes = (set: ImageModelSet) =>
  set.files.reduce((sum, f) => sum + f.approxBytes, 0);

export const formatGb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

export async function isInstalled(set: ImageModelSet): Promise<boolean> {
  for (const file of set.files) {
    if (!(await RNFS.exists(`${imageModelDir(set)}/${file.name}`))) {
      return false;
    }
  }
  return true;
}

/** The first downloaded set, in the list's order (FLUX.2 klein first). */
export async function installedSet(): Promise<ImageModelSet | null> {
  for (const set of IMAGE_MODEL_SETS) {
    if (await isInstalled(set)) {
      return set;
    }
  }
  return null;
}

/** What the user reads before downloading (and agrees to by downloading). */
export function downloadQuestion(set: ImageModelSet): string {
  const parts = [
    `${set.name}: about ${formatGb(setBytes(set))} in ${set.files.length} file${set.files.length > 1 ? 's' : ''}, from Hugging Face, into the app's folder. Pictures are then made on this PC only; nothing is uploaded.`,
    `Licence: ${set.licenceNote}`,
  ];
  if (set.useRules) {
    parts.push(`Use rules: ${set.useRules}`);
  }
  parts.push(
    `Best with a graphics card with ${set.recommendedVramGb} GB or more; slower without.`,
  );
  return parts.join('\n\n');
}

const LICENCE_KEY = '@pocketagent/image-models/licence-seen/v1';

/** Sets whose licence note the user has seen (shown the first time). */
export async function licenceSeen(id: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LICENCE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) && list.includes(id);
  } catch {
    return false;
  }
}

export async function markLicenceSeen(id: string): Promise<void> {
  const raw = await AsyncStorage.getItem(LICENCE_KEY).catch(() => null);
  let list: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    list = Array.isArray(parsed)
      ? parsed.filter(v => typeof v === 'string')
      : [];
  } catch {}
  await AsyncStorage.setItem(
    LICENCE_KEY,
    JSON.stringify([...new Set([...list, id])]),
  );
}

/**
 * Downloads the set's files one after another (each as `<name>.part` until
 * complete, src-tauri/src/download.rs). Files already there are kept.
 */
export async function downloadSet(
  set: ImageModelSet,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const dir = imageModelDir(set);
  await RNFS.mkdir(dir);
  const total = setBytes(set);
  let before = 0;
  for (const file of set.files) {
    const target = `${dir}/${file.name}`;
    if (await RNFS.exists(target)) {
      before += file.approxBytes;
      onProgress(before, total);
      continue;
    }
    const job = RNFS.downloadFile({
      fromUrl: file.url,
      toFile: target,
      progress: p => onProgress(before + p.bytesWritten, total),
    });
    const result = await job.promise;
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`${file.name}: the server answered ${result.statusCode}`);
    }
    before += file.approxBytes;
  }
  onProgress(total, total);
}
