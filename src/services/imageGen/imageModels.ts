/**
 * Picture models for the PC (desktop app only). The list is data
 * (imageModelCatalog.json, also read by src-tauri/src/image_gen.rs); each set is
 * downloaded with the app's own downloader into its own folder
 * (`Documents/image-models/<set>`), size and licence shown first. The native
 * side runs only these files.
 *
 * Checksums: a file with a `sha256` in the list is checked while it downloads
 * (on the native side, src-tauri/src/download.rs, and again here) and counts
 * as downloaded only with its `<name>.sha256` note, written after that check.
 * A set marked `verified` must have a sha256 for every file, or nothing is
 * downloaded. Sets not verified yet say so before the download.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNFS from '@dr.pogodin/react-native-fs';

import catalog from './imageModelCatalog.json';

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

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Why the list's entry for this set can't be downloaded safely, or null. A
 * set marked verified needs a checksum for every file; any checksum given
 * must be 64 lower-case hex characters.
 */
export function checksumProblem(set: ImageModelSet): string | null {
  for (const file of set.files) {
    if (file.sha256 !== null && !SHA256.test(file.sha256)) {
      return `${file.name}: its checksum in the model list is not a SHA-256.`;
    }
    if (set.verified && file.sha256 === null) {
      return `${file.name}: the model list says this set is checked, but it has no checksum. Not downloaded.`;
    }
  }
  return null;
}

/** Shown before downloading a set whose files are not checked yet. */
export function verifiedNote(set: ImageModelSet): string | null {
  return set.verified
    ? null
    : "Not verified yet: these files have no checksum in the app's list, so the app can't check them. You trust Hugging Face and the people who uploaded them.";
}

/** The desktop downloader's extras (stubs/web/fs.js). */
type DownloadOptions = Parameters<typeof RNFS.downloadFile>[0] & {
  sha256?: string;
};
type DownloadResult = Awaited<
  ReturnType<typeof RNFS.downloadFile>['promise']
> & {sha256?: string};

const checkedNote = (target: string) => `${target}.sha256`;

/** A file with a checksum counts only once it was checked (its note). */
async function fileReady(dir: string, file: ImageModelFile): Promise<boolean> {
  const target = `${dir}/${file.name}`;
  if (!(await RNFS.exists(target))) {
    return false;
  }
  if (file.sha256 === null) {
    return true;
  }
  try {
    const note = checkedNote(target);
    return (
      (await RNFS.exists(note)) &&
      (await RNFS.readFile(note, 'utf8')).trim() === file.sha256
    );
  } catch {
    return false;
  }
}

export async function isInstalled(set: ImageModelSet): Promise<boolean> {
  if (checksumProblem(set)) {
    return false;
  }
  for (const file of set.files) {
    if (!(await fileReady(imageModelDir(set), file))) {
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
  const note = verifiedNote(set);
  if (note) {
    parts.push(note);
  }
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
 * complete, src-tauri/src/download.rs). Files already there are kept, except
 * a file with a checksum that was never checked: it is downloaded again. A
 * file with a checksum is checked on the native side while it streams (a
 * mismatch is deleted there) and its reported SHA-256 again here.
 */
export async function downloadSet(
  set: ImageModelSet,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const problem = checksumProblem(set);
  if (problem) {
    throw new Error(problem);
  }
  const dir = imageModelDir(set);
  await RNFS.mkdir(dir);
  const total = setBytes(set);
  let before = 0;
  for (const file of set.files) {
    const target = `${dir}/${file.name}`;
    if (await fileReady(dir, file)) {
      before += file.approxBytes;
      onProgress(before, total);
      continue;
    }
    if (file.sha256 !== null) {
      // Unchecked leftovers (an older download): never used as they are.
      await RNFS.unlink(checkedNote(target)).catch(() => {});
      if (await RNFS.exists(target)) {
        await RNFS.unlink(target);
      }
    }
    const options: DownloadOptions = {
      fromUrl: file.url,
      toFile: target,
      progress: p => onProgress(before + p.bytesWritten, total),
    };
    if (file.sha256 !== null) {
      // Desktop (stubs/web/fs.js): the native side deletes a mismatch.
      options.sha256 = file.sha256;
    }
    const result: DownloadResult = await RNFS.downloadFile(options).promise;
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`${file.name}: the server answered ${result.statusCode}`);
    }
    if (file.sha256 !== null) {
      if (result.sha256 !== file.sha256) {
        await RNFS.unlink(target).catch(() => {});
        throw new Error(
          `${file.name}: the downloaded file is not the one in the model list (its SHA-256 doesn't match), so it was deleted.`,
        );
      }
      await RNFS.writeFile(checkedNote(target), file.sha256, 'utf8');
    }
    before += file.approxBytes;
  }
  onProgress(total, total);
}
