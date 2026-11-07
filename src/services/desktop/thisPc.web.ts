/**
 * "Run a model on this PC" (the Windows app). The user picks a .gguf file;
 * the bundled llama.cpp server runs it on this PC only (127.0.0.1, random
 * password; src-tauri/src/model_server.rs) and it appears as the server
 * "This PC", so chats use it like any llama.cpp server. One model at a time.
 */
import {invoke} from '@tauri-apps/api/core';

import {serverStore} from '../../store';

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
  const {url, apiKey} = await invoke<{url: string; apiKey: string}>(
    'model_server_start',
    {modelPath, context: 8192},
  );
  if (!(await waitUntilReady(url, apiKey))) {
    await stopModelOnThisPc();
    return {
      ok: false,
      message: 'The model did not start. Is it a valid .gguf file?',
    };
  }
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
  const models = serverStore.serverModels.get(serverId) || [];
  for (const model of models) {
    serverStore.addUserSelectedModel(serverId, model.id);
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
