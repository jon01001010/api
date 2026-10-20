import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {modelStore} from '../../store';
import type {GenerationLease} from '../../store/generationLease';
import {parseCompletion} from './protocol';
import {localApiState} from './state';

const native = NativeModules.LocalApi;
let subscriptions: {remove(): void}[] = [];
const active = new Map<string, GenerationLease>();
export type LocalApiSession = {url: string; token: string};
let session: LocalApiSession | null = null;
const listeners = new Set<() => void>();
export const getLocalApiSession = () => session;
export function subscribeLocalApi(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publishSession(next: LocalApiSession | null) {
  session = next;
  listeners.forEach(listener => listener());
}
const npuSelected = () =>
  modelStore.activeContextSettings?.devices?.some(d => d.startsWith('HTP')) &&
  (modelStore.activeContextSettings?.n_gpu_layers ?? 0) > 0;

function reply(id: string, status: number, body: object) {
  native.respond(id, status, JSON.stringify(body));
}
async function request(event: {id: string; path: string; body: string}) {
  const {id, path, body} = event;
  const context = modelStore.context;
  if (!localApiState.running || !context || !npuSelected()) {
    reply(id, 503, {
      error: {message: 'Load a local model with Hexagon selected'},
    });
    return;
  }
  if (path === '/v1/models') {
    reply(id, 200, {
      object: 'list',
      data: [{id: 'local', object: 'model', owned_by: 'user'}],
    });
    return;
  }
  let params: ReturnType<typeof parseCompletion>;
  try {
    params = parseCompletion(body);
  } catch {
    reply(id, 400, {
      error: {
        message:
          'Invalid request; text only, model=local, stream=false, max_tokens 1–512',
      },
    });
    return;
  }
  const lease = modelStore.tryAcquireGeneration();
  if (!lease) {
    reply(id, 429, {error: {message: 'Model is busy'}});
    return;
  }
  active.set(id, lease);
  const stop = () => {
    context.stopCompletion().catch(() => {});
  };
  lease.signal.addEventListener('abort', stop);
  try {
    const formatted = await context.getFormattedChat(params.messages);
    if (lease.signal.aborted) {
      return;
    }
    const {tokens} = await context.tokenize(formatted.prompt);
    const capacity = modelStore.activeContextSettings?.n_ctx ?? 2048;
    if (tokens.length + params.maxTokens + 32 > capacity) {
      reply(id, 413, {
        error: {message: 'Request exceeds loaded model context'},
      });
      return;
    }
    if (lease.signal.aborted) {
      return;
    }
    const result = await context.completion({
      prompt: formatted.prompt,
      n_predict: params.maxTokens,
      temperature: params.temperature,
    });
    if (!lease.signal.aborted) {
      reply(id, 200, {
        id: `chatcmpl-${id}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'local',
        choices: [
          {
            index: 0,
            message: {role: 'assistant', content: result.text},
            finish_reason: result.stopped_limit ? 'length' : 'stop',
          },
        ],
      });
    }
  } catch {
    reply(id, 500, {error: {message: 'Local inference failed'}});
  } finally {
    lease.signal.removeEventListener('abort', stop);
    active.delete(id);
    lease.end();
  }
}
function cleanup() {
  localApiState.running = false;
  publishSession(null);
  active.forEach(lease => lease.abort());
  subscriptions.forEach(sub => sub.remove());
  subscriptions = [];
}
export async function startLocalApi(): Promise<LocalApiSession> {
  if (Platform.OS !== 'android' || !native) {
    throw new Error('Android local service is unavailable');
  }
  if (!modelStore.context || !npuSelected()) {
    throw new Error(
      'Load a model with Hexagon selected first. Actual NPU offload still needs device verification.',
    );
  }
  if (localApiState.running) {
    throw new Error('Already running');
  }
  const events = new NativeEventEmitter(native);
  subscriptions = [
    events.addListener('localApiRequest', e => {
      request(e).catch(() => {});
    }),
    events.addListener('localApiCancel', e => active.get(e.id)?.abort()),
    events.addListener('localApiStopped', cleanup),
  ];
  localApiState.running = true;
  try {
    const started = await native.start();
    publishSession(started);
    return started;
  } catch (e) {
    cleanup();
    throw e;
  }
}
export async function stopLocalApi() {
  try {
    await native.stop();
  } finally {
    cleanup();
  }
}
