import {LlamaContext} from 'llama.rn';

import {streamChatCompletion} from './openai';
import type {RemoteEndpoint} from './servers';
import {pickSamplers} from '../utils/samplerParams';
import {
  ApiCompletionParams,
  CompletionEngine,
  CompletionResult,
  CompletionStreamData,
  normaliseTimings,
} from '../utils/completionTypes';
import {
  RemoteHttpError,
  RemoteModelRequestWithdrawnError,
} from '../utils/errors';
import {isModelNotLoaded} from './llamaServer/routerWire';

export class LocalCompletionEngine implements CompletionEngine {
  constructor(private context: LlamaContext) {}

  async completion(
    params: ApiCompletionParams,
    callback?: (data: CompletionStreamData) => void,
  ): Promise<CompletionResult> {
    const result = await this.context.completion(
      params,
      callback
        ? data => {
            callback({
              token: data.token,
              content: data.content,
              reasoning_content: data.reasoning_content,
              tool_calls: data.tool_calls,
              accumulated_text: data.accumulated_text,
            });
          }
        : undefined,
    );
    return {
      text: result.text,
      content: result.content,
      reasoning_content: result.reasoning_content,
      tool_calls: result.tool_calls,
      timings: normaliseTimings(result.timings),
      tokens_predicted: result.tokens_predicted,
      tokens_evaluated: result.tokens_evaluated,
      draft_tokens: result.draft_tokens,
      draft_tokens_accepted: result.draft_tokens_accepted,
      truncated: result.truncated,
      stopped_eos: result.stopped_eos,
      stopped_limit: result.stopped_limit,
      stopped_word: result.stopped_word,
      stopping_word: result.stopping_word,
      context_full: result.context_full,
      interrupted: result.interrupted,
    };
  }

  async stopCompletion(): Promise<void> {
    await this.context.stopCompletion();
  }
}

export interface RemoteEngineOptions {
  /**
   * Awaited before the request, with the signal Stop aborts. The engine
   * applies no timeout of its own: whoever supplies this bounds it. With
   * `reread`, the cached list is not trusted; resolves true only when a
   * router made the model ready.
   */
  ensureReady?: (
    signal: AbortSignal,
    options?: {reread: boolean},
  ) => Promise<boolean | void>;
}

/**
 * A 400 that says the model cannot take tools at all (Gemini: "Function
 * calling is not enabled for this model"), as opposed to a bad tool call.
 */
export function refusesTools(error: unknown): boolean {
  const status = (error as {status?: number} | null)?.status;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    status === 400 &&
    /function calling is not enabled|does not support (tools|function calling|tool use)|tools? (are|is) not supported/i.test(
      message,
    )
  );
}

/** Waits before each retry of a busy server; its length is the retry count. */
export const BUSY_RETRY_DELAYS_MS = [2000, 4000, 8000];

/**
 * How long the server says to wait, in seconds, if it says: Gemini writes
 * "Please retry in 14h29m47.99s" or `"retryDelay": "52s"`.
 */
export function retryAfterSeconds(error: unknown): number | undefined {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const m =
    /retry in ((?:\d+(?:\.\d+)?[hms])+)/i.exec(text) ??
    /"retryDelay"\s*:\s*"((?:\d+(?:\.\d+)?[hms])+)"/i.exec(text);
  if (!m) {
    return undefined;
  }
  let seconds = 0;
  for (const [, n, unit] of m[1].matchAll(/(\d+(?:\.\d+)?)([hms])/gi)) {
    seconds += Number(n) * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1);
  }
  return seconds;
}

/** Longest wait worth retrying for; past it (a daily limit) say so instead. */
const MAX_RETRY_WAIT_S = 20;

/** Busy, rate-limited or briefly down: worth asking again shortly. */
export function isBusyError(error: unknown): boolean {
  const status = (error as {status?: number} | null)?.status;
  if (status === 429) {
    const wait = retryAfterSeconds(error);
    const daily = /per ?day|daily/i.test(
      error instanceof Error ? error.message : String(error ?? ''),
    );
    return !daily && (wait === undefined || wait <= MAX_RETRY_WAIT_S);
  }
  return status === 502 || status === 503 || status === 504;
}

const formatWait = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m} min` : `${Math.ceil(seconds)} s`;
};

/**
 * A used-up quota (429) in plain words instead of the provider's JSON:
 * "Free daily limit used up for gemini-3.6-flash (resets in ~14h 30m)."
 * Anything else is returned as it was.
 */
export function readableQuotaError(error: unknown, model: string): unknown {
  const status = (error as {status?: number} | null)?.status;
  const text = error instanceof Error ? error.message : '';
  if (status !== 429 || !/quota|limit|exhausted/i.test(text)) {
    return error;
  }
  const wait = retryAfterSeconds(error);
  const daily = /per ?day|daily/i.test(text);
  const what = daily ? 'Daily limit used up' : 'Rate limit reached';
  const free = /free.?tier/i.test(text) ? ' (free tier)' : '';
  const when =
    wait !== undefined ? ` Resets in about ${formatWait(wait)}.` : '';
  return new RemoteHttpError(
    `${what}${free} for ${model}.${when} Try another model meanwhile.`,
    429,
    (error as {serverMessage?: string}).serverMessage,
  );
}

function waitUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

export class OpenAICompletionEngine implements CompletionEngine {
  private abortController: AbortController | null = null;

  constructor(
    private endpoint: RemoteEndpoint,
    private options: RemoteEngineOptions = {},
  ) {}

  async completion(
    params: ApiCompletionParams,
    callback?: (data: CompletionStreamData) => void,
  ): Promise<CompletionResult> {
    const controller = new AbortController();
    this.abortController = controller;

    const {ensureReady} = this.options;
    if (!ensureReady) {
      return this.send(params, controller.signal, callback);
    }
    await ensureReady(controller.signal);
    if (controller.signal.aborted) {
      throw new RemoteModelRequestWithdrawnError();
    }

    let streamed = false;
    try {
      return await this.send(params, controller.signal, data => {
        streamed = true;
        callback?.(data);
      });
    } catch (error) {
      if (streamed || !isModelNotLoaded(error)) {
        throw error;
      }
      const ready = await ensureReady(controller.signal, {reread: true});
      if (controller.signal.aborted) {
        throw new RemoteModelRequestWithdrawnError();
      }
      if (ready !== true) {
        throw error;
      }
      return this.send(params, controller.signal, callback);
    }
  }

  /** The model refused tools once (some Gemma / Gemini models): skip them. */
  private toolsUnsupported = false;

  private async send(
    params: ApiCompletionParams,
    signal: AbortSignal,
    callback?: (data: CompletionStreamData) => void,
  ): Promise<CompletionResult> {
    const tools = (params as any).tools;
    const withTools = !!tools?.length && !this.toolsUnsupported;
    try {
      return await this.streamRetrying(params, withTools, signal, callback);
    } catch (error) {
      if (!withTools || !refusesTools(error) || signal.aborted) {
        throw error;
      }
      // Chat without tools rather than not at all.
      this.toolsUnsupported = true;
      return this.streamRetrying(params, false, signal, callback);
    }
  }

  /**
   * A busy or rate-limited server (503, 429, …) usually answers a moment
   * later: wait 2 s, 4 s, 8 s and try again before showing the error. Only
   * while nothing has streamed yet, so a reply is never sent twice.
   */
  private async streamRetrying(
    params: ApiCompletionParams,
    withTools: boolean,
    signal: AbortSignal,
    callback?: (data: CompletionStreamData) => void,
  ): Promise<CompletionResult> {
    let streamed = false;
    const onData = (data: CompletionStreamData) => {
      streamed = true;
      callback?.(data);
    };
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.stream(params, withTools, signal, onData);
      } catch (error) {
        const delay = BUSY_RETRY_DELAYS_MS[attempt];
        if (
          streamed ||
          signal.aborted ||
          delay === undefined ||
          !isBusyError(error)
        ) {
          throw readableQuotaError(error, this.endpoint.remoteModelId);
        }
        await waitUnlessAborted(delay, signal);
        if (signal.aborted) {
          throw error;
        }
      }
    }
  }

  private stream(
    params: ApiCompletionParams,
    withTools: boolean,
    signal: AbortSignal,
    callback?: (data: CompletionStreamData) => void,
  ): Promise<CompletionResult> {
    return streamChatCompletion(
      {
        messages: params.messages || [],
        model: this.endpoint.remoteModelId,
        samplers: pickSamplers(params),
        stop: params.stop,
        stream: true,
        // llama.rn's `tools` typedef is structurally compatible with OpenAI's
        // function-tool shape but lives under a different name.
        ...(withTools && {
          tools: (params as any).tools,
          tool_choice: (params as any).tool_choice,
        }),
        response_format: (params as any).response_format,
        // Reasoning intent carried on the params; the server profile owns the wire shape.
        reasoning: params.reasoning,
      },
      this.endpoint,
      signal,
      callback,
    );
  }

  async stopCompletion(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
  }
}
