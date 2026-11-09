/**
 * "Run a model on this PC" (the Windows app). The user picks a .gguf file;
 * the bundled llama.cpp server runs it on this PC only (127.0.0.1, random
 * password; src-tauri/src/model_server.rs) and it appears as the server
 * "This PC", so chats use it like any llama.cpp server. One model at a time.
 */
import {invoke} from '@tauri-apps/api/core';

import {serverStore} from '../../store/ServerStore';

export const THIS_PC = 'This PC';

export const isDesktopApp = (): boolean =>
  !!(globalThis as unknown as {__TAURI_INTERNALS__?: unknown})
    .__TAURI_INTERNALS__;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Waits until the server has loaded the model (it answers /health). */
async function waitUntilReady(url: string, apiKey: string): Promise<boolean> {
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`${url}/health`, {
        headers: {Authorization: `Bearer ${apiKey}`},
      });
      if (r.ok) {
        return true;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  return false;
}

/**
 * The vision part each model was started with, so a restart (the server
 * stops when the app closes) starts it the same way. This PC only.
 */
const PROJECTIONS_KEY = 'pa-this-pc-projections';
function projectionFor(modelPath: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(PROJECTIONS_KEY) || '{}')[modelPath];
  } catch {
    return undefined;
  }
}
function rememberProjection(modelPath: string, projection?: string) {
  try {
    const all = JSON.parse(localStorage.getItem(PROJECTIONS_KEY) || '{}');
    if (projection) {
      all[modelPath] = projection;
    } else {
      delete all[modelPath];
    }
    localStorage.setItem(PROJECTIONS_KEY, JSON.stringify(all));
  } catch {
    // Without it a restart runs the model without its vision part.
  }
}

/**
 * Starts the model server for a model file (a downloaded model's own path,
 * or a file the user picked) and lists it under the server "This PC".
 * Returns the server's id; the model's id there is `modelPath`.
 */
export async function startOnThisPc(
  modelPath: string,
  projectionPath?: string,
): Promise<string> {
  const {url, apiKey} = await invoke<{url: string; apiKey: string}>(
    'model_server_start',
    {modelPath, context: 8192, projectionPath: projectionPath ?? null},
  );
  if (!(await waitUntilReady(url, apiKey))) {
    await stopModelOnThisPc();
    throw new Error('The model did not start. Is it a valid .gguf file?');
  }
  rememberProjection(modelPath, projectionPath);
  // A model on this PC reads the whole prompt before it starts answering;
  // with tools that can take minutes on a slow PC, so wait up to 10 minutes
  // (cloud servers keep the usual 30 seconds).
  const requestTimeoutMs = 10 * 60 * 1000;
  const existing = serverStore.servers.find(s => s.name === THIS_PC);
  const serverId = existing
    ? (serverStore.updateServer(existing.id, {
        url,
        serverType: 'llama.cpp',
        requestTimeoutMs,
      }),
      existing.id)
    : serverStore.addServer({
        name: THIS_PC,
        url,
        serverType: 'llama.cpp',
        requestTimeoutMs,
      });
  await serverStore.setApiKey(serverId, apiKey);
  await serverStore.fetchModelsForServer(serverId);
  serverStore.addUserSelectedModel(serverId, modelPath);
  return serverId;
}

export async function runModelOnThisPc(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!isDesktopApp()) {
    return {ok: false, message: 'Only in the Windows app.'};
  }
  const modelPath = await invoke<string | null>('pick_model_file');
  if (!modelPath) {
    return {ok: false, message: 'No model chosen.'};
  }
  try {
    await startOnThisPc(modelPath);
  } catch (e) {
    return {ok: false, message: e instanceof Error ? e.message : String(e)};
  }
  const name = modelPath.split(/[\\/]/).pop();
  return {
    ok: true,
    message: `${name} is running on this PC. Pick it in Models.`,
  };
}

export async function stopModelOnThisPc(): Promise<void> {
  if (isDesktopApp()) {
    await invoke('model_server_stop');
  }
}

/** True when the "This PC" server at `url` is serving `modelPath` right now. */
async function isServing(
  url: string,
  apiKey: string | undefined,
  modelPath: string,
) {
  try {
    const r = await fetch(`${url}/v1/models`, {
      headers: apiKey ? {Authorization: `Bearer ${apiKey}`} : {},
    });
    if (!r.ok) {
      return false;
    }
    const body = await r.json();
    return (body.data || []).some((m: {id: string}) => m.id === modelPath);
  } catch {
    return false;
  }
}

/**
 * Called when a "This PC" model is loaded: the model server stops when the
 * app closes (nothing keeps running behind the user's back), so start it for
 * this model file if it isn't already serving it (the Allow dialog still
 * asks for files outside the app folder). Other servers: nothing to do.
 */
export async function prepareThisPcModel(
  serverId: string,
  modelPath: string,
): Promise<void> {
  const server = serverStore.servers.find(s => s.id === serverId);
  if (!isDesktopApp() || !server || server.name !== THIS_PC) {
    return;
  }
  const currentKey = await serverStore.getApiKey(serverId);
  if (await isServing(server.url, currentKey, modelPath)) {
    return;
  }
  const {url, apiKey} = await invoke<{url: string; apiKey: string}>(
    'model_server_start',
    {
      modelPath,
      context: 8192,
      projectionPath: projectionFor(modelPath) ?? null,
    },
  );
  if (!(await waitUntilReady(url, apiKey))) {
    await stopModelOnThisPc();
    throw new Error('The model did not start. Is it a valid .gguf file?');
  }
  serverStore.updateServer(serverId, {url});
  await serverStore.setApiKey(serverId, apiKey);
}
