/**
 * LoRA adapters for models (src/store/LoraStore.ts): adding one through the
 * app's own file import, choosing it per model, removing it, and the label
 * shown next to the model's name.
 *
 * Files: only the user's own pick (the phone's file picker; on the desktop the
 * native "choose a file" dialog, which copies it into the app's folder first),
 * copied into the app's `Documents/models/lora` folder. Nothing outside the
 * app's folder is read any other way.
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {pick, types} from '@react-native-documents/picker';
import {Platform} from 'react-native';
import {loadLlamaModelInfo} from 'llama.rn';
import {v4 as uuidv4} from 'uuid';
import 'react-native-get-random-values';

import {modelStore} from '../../store';
import {
  ActiveLora,
  isPlainAdapterName,
  loraDir,
  loraLabel,
  LoraAdapter,
  loraStore,
} from '../../store/LoraStore';
import {THIS_PC} from '../desktop/thisPc';
import {Model, ModelOrigin} from '../../utils/types';

/** A file name kept plain: letters, digits and a few marks only. */
export const adapterFileName = (picked: string): string => {
  const base = (picked.split(/[\\/]/).pop() || '')
    .replace(/\.gguf$/i, '')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/^[.\s-]+/, '')
    .slice(0, 80)
    .trim();
  return `${base || 'adapter'}.gguf`;
};

/** What the file says about itself, when the phone can read it. */
async function readAdapterInfo(
  path: string,
): Promise<{isAdapter?: boolean; architecture?: string}> {
  try {
    const info = (await loadLlamaModelInfo(path)) as Record<string, unknown>;
    const type = info?.['general.type'];
    const arch = info?.['general.architecture'];
    return {
      isAdapter: typeof type === 'string' ? type === 'adapter' : undefined,
      architecture: typeof arch === 'string' ? arch : undefined,
    };
  } catch {
    // The desktop can't read it here: the user's choice of model stands.
    return {};
  }
}

/**
 * The user picks a LoRA .gguf for `model`. It is copied into the app's
 * adapters folder under a fresh name (dated versions never overwrite each
 * other) and listed under the model. Returns null when nothing was picked.
 */
export async function addAdapterFile(
  model: Model,
): Promise<LoraAdapter | null> {
  if (model.origin === ModelOrigin.REMOTE) {
    throw new Error('Adapters are for models on this device.');
  }
  let file: {uri: string; name?: string | null; size?: number | null};
  try {
    [file] = await pick({
      type: Platform.OS === 'ios' ? 'public.data' : types.allFiles,
    });
  } catch {
    return null;
  }
  if (!file) {
    return null;
  }
  const picked = file.name || file.uri.split('/').pop() || '';
  if (!/\.gguf$/i.test(picked)) {
    throw new Error('Choose a LoRA adapter file (.gguf).');
  }
  const dir = loraDir();
  if (!(await RNFS.exists(dir))) {
    await RNFS.mkdir(dir);
  }
  let fileName = adapterFileName(picked);
  const stem = fileName.replace(/\.gguf$/i, '');
  for (let n = 2; await RNFS.exists(`${dir}/${fileName}`); n++) {
    fileName = `${stem}-${n}.gguf`;
  }
  if (!isPlainAdapterName(fileName)) {
    throw new Error('This file name cannot be used.');
  }
  const path = `${dir}/${fileName}`;
  await RNFS.copyFile(file.uri, path);
  const info = await readAdapterInfo(path);
  const modelArch = model.ggufMetadata?.architecture;
  const problem =
    info.isAdapter === false
      ? 'This file is a model, not an adapter.'
      : info.architecture && modelArch && info.architecture !== modelArch
        ? `This adapter is for a ${info.architecture} model; ${model.name} is ${modelArch}.`
        : '';
  if (problem) {
    // Our own copy only; the user's original is untouched.
    await RNFS.unlink(path).catch(() => {});
    throw new Error(problem);
  }
  let size = Number(file.size) || 0;
  try {
    size = Number((await RNFS.stat(path)).size) || size;
  } catch {
    // Size is only shown.
  }
  const adapter: LoraAdapter = {
    id: uuidv4(),
    name: fileName.replace(/\.gguf$/i, ''),
    fileName,
    size,
    addedAt: new Date().toISOString(),
    modelId: model.id,
    architecture: info.architecture,
  };
  loraStore.add(adapter);
  return adapter;
}

/** Choose a model's adapter and strength (null: Off), and use it now. */
export async function chooseAdapter(
  modelId: string,
  adapterId: string | null,
  scale?: number,
): Promise<void> {
  if (!loraStore.setChoice(modelId, adapterId, scale)) {
    throw new Error('That adapter belongs to another model.');
  }
  await modelStore.applyLoraChoice(modelId);
}

/** Remove an adapter: the app's own copy of the file and its choice. */
export async function removeAdapter(adapter: LoraAdapter): Promise<void> {
  const wasActive =
    loraStore.choices[adapter.modelId]?.adapterId === adapter.id;
  loraStore.forget(adapter.id);
  if (wasActive) {
    await modelStore.applyLoraChoice(adapter.modelId);
  }
  if (isPlainAdapterName(adapter.fileName)) {
    await RNFS.unlink(`${loraDir()}/${adapter.fileName}`).catch(() => {});
  }
}

/** The adapter a model shown in the app runs with (desktop: "This PC"). */
export function activeLoraFor(model?: Model): ActiveLora | undefined {
  if (!model) {
    return undefined;
  }
  if (model.origin === ModelOrigin.REMOTE) {
    return model.author === THIS_PC && model.remoteModelId
      ? loraStore.activeForPcModel(model.remoteModelId)
      : undefined;
  }
  return loraStore.activeFor(model.id);
}

/** "+ my-style (0.8)" next to the model's name, or ''. */
export const loraLabelFor = (model?: Model): string =>
  loraLabel(activeLoraFor(model));
