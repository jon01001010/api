/**
 * Speech-to-text models for voice input. No fixed model: any Hugging Face
 * repo with Whisper GGML files (`ggml-*.bin`, the format whisper.rn runs)
 * can be found, downloaded and picked. Downloads live in the app's private
 * folder under voice-models/.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';

import {fetchModelFilesDetails, fetchModels} from '../../api/hf';
import {urls} from '../../config';

export interface WhisperModelRef {
  /** Hugging Face repo, e.g. ggerganov/whisper.cpp */
  repo: string;
  /** File in the repo, e.g. ggml-base.en.bin */
  file: string;
}

export interface WhisperSearchResult extends WhisperModelRef {
  downloads?: number;
  /** Bytes, when known. */
  size?: number;
}

export interface DownloadedWhisperModel extends WhisperModelRef {
  path: string;
  size: number;
}

/** Suggested default; the user can pick any other. */
export const RECOMMENDED_WHISPER: WhisperModelRef = {
  repo: 'ggerganov/whisper.cpp',
  file: 'ggml-base.en.bin',
};

export const VOICE_MODELS_DIR = `${RNFS.DocumentDirectoryPath}/voice-models`;

/**
 * A Whisper model file whisper.rn can load: ggml-*.bin. Not the Silero
 * voice-detection model, and not Core ML encoder bundles.
 */
export function isWhisperModelFile(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return /^ggml-[\w.-]+\.bin$/i.test(name) && !/silero|vad|encoder/i.test(name);
}

/** Folder-safe name for a repo (owner/name → owner__name). */
const repoFolder = (repo: string) => repo.replace(/[^\w.-]+/g, '__');

export const whisperModelPath = (m: WhisperModelRef) =>
  `${VOICE_MODELS_DIR}/${repoFolder(m.repo)}/${m.file.split('/').pop()}`;

export const whisperModelId = (m: WhisperModelRef) => `${m.repo}/${m.file}`;

/** Search Hugging Face for Whisper GGML files. */
export async function searchWhisperModels(
  query: string,
  authToken?: string | null,
): Promise<WhisperSearchResult[]> {
  const search = query.trim() || 'whisper';
  const {models} = await fetchModels({
    search,
    full: true,
    limit: 30,
    sort: 'downloads',
    direction: '-1',
    authToken,
  });
  const results: WhisperSearchResult[] = [];
  for (const model of models) {
    for (const sibling of model.siblings ?? []) {
      if (isWhisperModelFile(sibling.rfilename)) {
        results.push({
          repo: model.id,
          file: sibling.rfilename,
          downloads: (model as any).downloads,
          size: sibling.size,
        });
      }
    }
  }
  return results.slice(0, 100);
}

/** Sizes for one repo's files (search results don't always include them). */
export async function fetchWhisperFileSizes(
  repo: string,
  authToken?: string | null,
): Promise<Record<string, number>> {
  const files = await fetchModelFilesDetails(repo, authToken);
  const sizes: Record<string, number> = {};
  for (const f of files) {
    sizes[f.path] = f.lfs?.size ?? f.size;
  }
  return sizes;
}

/** Download to a temporary file, then move into place (no half files). */
export async function downloadWhisperModel(
  m: WhisperModelRef,
  onProgress?: (fraction: number) => void,
  authToken?: string | null,
): Promise<DownloadedWhisperModel> {
  const path = whisperModelPath(m);
  const dir = path.slice(0, path.lastIndexOf('/'));
  const temp = `${path}.part`;
  await RNFS.mkdir(dir, {NSURLIsExcludedFromBackupKey: true});
  try {
    const result = await RNFS.downloadFile({
      fromUrl: urls.modelDownloadFile(m.repo, m.file),
      toFile: temp,
      headers: authToken ? {Authorization: `Bearer ${authToken}`} : {},
      background: false,
      discretionary: false,
      cacheable: false,
      progressInterval: 500,
      progress: res =>
        onProgress?.(
          res.contentLength > 0
            ? Math.min(1, res.bytesWritten / res.contentLength)
            : 0,
        ),
    }).promise;
    if (result.statusCode !== 200) {
      throw new Error(`Download failed: HTTP ${result.statusCode}`);
    }
    if (await RNFS.exists(path)) {
      await RNFS.unlink(path);
    }
    await RNFS.moveFile(temp, path);
  } catch (error) {
    if (await RNFS.exists(temp)) {
      await RNFS.unlink(temp).catch(() => {});
    }
    throw error;
  }
  const stat = await RNFS.stat(path);
  onProgress?.(1);
  return {...m, path, size: Number(stat.size)};
}

export async function deleteWhisperModel(m: WhisperModelRef): Promise<void> {
  const path = whisperModelPath(m);
  if (await RNFS.exists(path)) {
    await RNFS.unlink(path);
  }
}
