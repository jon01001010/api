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
import {isPictureModel, isSd15SingleFile} from '../../utils/pictureModel';

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

type Gpus = {totalMemory: number; shared: boolean}[] | undefined;

/**
 * The downloaded set to use: the list's sets (FLUX.2 klein first), then
 * picture files picked from the models folder; the first that fits the
 * graphics card, else the first (the native side picks the same way for a
 * paired device).
 */
export async function installedSet(gpus?: Gpus): Promise<ImageModelSet | null> {
  const installed: ImageModelSet[] = [];
  for (const set of IMAGE_MODEL_SETS) {
    if (await isInstalled(set)) {
      installed.push(set);
    }
  }
  installed.push(...(await localSets()));
  return (
    installed.find(set => fitForCard(set, gpus) === 'fits') ??
    installed[0] ??
    null
  );
}

/*
 * Picture-model files the user downloaded through the Models screen (e.g.
 * stable-diffusion-v1-5-…-Q4_0.gguf from a Hugging Face search). Stable
 * Diffusion 1.5 runs from one such file, so it can be used for pictures:
 * "Use this file for pictures" keeps a small record (an id, the file's
 * place inside the models folder, kind "sd15-single") in
 * LOCAL_SETS_FILE. The native side (src-tauri/src/image_gen.rs) gets only
 * the id, reads that record itself and checks the file (inside the app's
 * models folder, a regular .gguf file, no links) before it runs it.
 */

/** Where the Models screen keeps its downloads. */
export const chatModelsDir = () => `${RNFS.DocumentDirectoryPath}/models`;
export const localSetsFile = () =>
  `${RNFS.DocumentDirectoryPath}/image-models/local-sets.json`;
export const LOCAL_KIND_SD15 = 'sd15-single';
/** Their licence is SD 1.5's: its note is shown the first time, once. */
export const SD15_LICENCE_ID = 'sd15';

export type LocalRecord = {id: string; file: string; kind: string};
export type PictureFile = {
  /** Its place inside the models folder, parts joined with "/". */
  file: string;
  name: string;
  size: number;
  /** Stable Diffusion 1.5 in one file: the PC can run it. */
  usable: boolean;
  /** Its record's id once picked ("Use this file for pictures"). */
  id: string | null;
};

const PLAIN_PART = /^[^/\\:\0]+$/;
const plainPlace = (file: string) =>
  file
    .split('/')
    .every(part => part !== '.' && part !== '..' && PLAIN_PART.test(part));

/** A record's id: "local-" and lower-case letters, digits and "-". */
export function localId(file: string): string {
  const slug = file
    .toLowerCase()
    .replace(/\.gguf$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80)
    .replace(/^-+/, '');
  return `local-${slug || 'model'}`;
}

export async function readLocalRecords(): Promise<LocalRecord[]> {
  try {
    if (!(await RNFS.exists(localSetsFile()))) {
      return [];
    }
    const parsed: unknown = JSON.parse(
      await RNFS.readFile(localSetsFile(), 'utf8'),
    );
    const sets = (parsed as {sets?: unknown})?.sets;
    return Array.isArray(sets)
      ? sets.filter(
          (r): r is LocalRecord =>
            !!r &&
            typeof r.id === 'string' &&
            typeof r.file === 'string' &&
            typeof r.kind === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/** A picked file as a set, shown and chosen like the list's own. */
export function localSetFor(record: LocalRecord, size: number): ImageModelSet {
  const sd15 = IMAGE_MODEL_SETS.find(s => s.id === SD15_LICENCE_ID)!;
  const name = record.file.split('/').pop() ?? record.file;
  return {
    ...sd15,
    id: record.id,
    name: `${name} (your file, Stable Diffusion 1.5)`,
    kind: 'sd',
    defaultSteps: 20,
    cfgScale: 7,
    offloadToCpu: false,
    recommendedVramGb: 4,
    verified: false,
    files: [{role: 'model', name, url: '', approxBytes: size, sha256: null}],
  };
}

/** The picked files that are still there, as sets. */
export async function localSets(): Promise<ImageModelSet[]> {
  const out: ImageModelSet[] = [];
  for (const record of await readLocalRecords()) {
    if (record.kind !== LOCAL_KIND_SD15 || !plainPlace(record.file)) {
      continue;
    }
    try {
      const stat = await RNFS.stat(`${chatModelsDir()}/${record.file}`);
      if (stat.isFile()) {
        out.push(localSetFor(record, Number(stat.size)));
      }
    } catch {}
  }
  return out;
}

/**
 * Picture-model GGUFs in the models folder (a few levels deep:
 * hf/<author>/<repo>/<file>), with whether the PC can run each and its
 * record if picked.
 */
export async function findPictureFiles(): Promise<PictureFile[]> {
  const records = await readLocalRecords();
  const found: PictureFile[] = [];
  const walk = async (dir: string, place: string[], depth: number) => {
    let entries: Awaited<ReturnType<typeof RNFS.readDir>>;
    try {
      entries = await RNFS.readDir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const parts = [...place, entry.name];
      if (entry.isDirectory()) {
        if (depth < 4) {
          await walk(`${dir}/${entry.name}`, parts, depth + 1);
        }
        continue;
      }
      if (!entry.isFile() || !/\.gguf$/i.test(entry.name)) {
        continue;
      }
      if (!isPictureModel({filename: entry.name, repo: place.join('/')})) {
        continue;
      }
      const file = parts.join('/');
      if (!plainPlace(file)) {
        continue;
      }
      found.push({
        file,
        name: entry.name,
        size: Number(entry.size),
        usable: isSd15SingleFile(entry.name),
        id:
          records.find(r => r.file === file && r.kind === LOCAL_KIND_SD15)
            ?.id ?? null,
      });
    }
  };
  if (await RNFS.exists(chatModelsDir()).catch(() => false)) {
    await walk(chatModelsDir(), [], 0);
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * "Use this file for pictures": keeps its record (SD 1.5 in one file only).
 * Returns the record's id.
 */
export async function registerPictureFile(picked: PictureFile): Promise<string> {
  if (!picked.usable || !isSd15SingleFile(picked.name)) {
    throw new Error(
      'Only a Stable Diffusion 1.5 file (one .gguf) can be used for pictures for now.',
    );
  }
  if (!plainPlace(picked.file)) {
    throw new Error('That file is not inside the models folder.');
  }
  const records = await readLocalRecords();
  const existing = records.find(r => r.file === picked.file);
  if (existing) {
    return existing.id;
  }
  let id = localId(picked.file);
  for (let n = 2; records.some(r => r.id === id); n++) {
    id = `${localId(picked.file)}-${n}`;
  }
  const next = [...records, {id, file: picked.file, kind: LOCAL_KIND_SD15}];
  await RNFS.mkdir(`${RNFS.DocumentDirectoryPath}/image-models`);
  await RNFS.writeFile(
    localSetsFile(),
    JSON.stringify({sets: next}, null, 2),
    'utf8',
  );
  return id;
}

/** Stops using a picked file for pictures (the file itself stays). */
export async function stopUsingFile(id: string): Promise<void> {
  const records = await readLocalRecords();
  await RNFS.writeFile(
    localSetsFile(),
    JSON.stringify({sets: records.filter(r => r.id !== id)}, null, 2),
    'utf8',
  );
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

/**
 * Does this set suit the PC's graphics card? From the largest card's memory
 * (read fresh each start). Not a hard limit: a set too big still runs,
 * partly in memory and much slower.
 */
export function fitForCard(
  set: ImageModelSet,
  gpus: Gpus,
): 'fits' | 'too-big' | 'unknown' {
  const dedicated = (gpus ?? []).filter(g => !g.shared);
  if (!dedicated.length) {
    return 'unknown';
  }
  const gb = Math.max(...dedicated.map(g => g.totalMemory)) / 1e9;
  return gb + 0.25 >= set.recommendedVramGb ? 'fits' : 'too-big';
}
