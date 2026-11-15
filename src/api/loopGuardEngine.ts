/**
 * Ends thinking early when it goes round in circles (utils/thinkingLoop).
 *
 * Wraps any engine (phone's own model or a server). While the model is
 * still thinking (no answer text yet, no tool call), every new piece of
 * reasoning is checked. On a loop the engine is stopped and asked once more
 * with thinking off, the same messages, so the model answers directly. The
 * reasoning shown keeps what was thought, then the same line the thinking
 * budget uses: "I have thought enough. Now I will give my answer directly."
 * A Stop from the user is never turned into a second request.
 */
import type {
  ApiCompletionParams,
  CompletionEngine,
  CompletionResult,
  CompletionStreamData,
  CompletionTimings,
} from '../utils/completionTypes';
import {makeLoopWatcher} from '../utils/thinkingLoop';
import {THINKING_BUDGET_MESSAGE} from '../utils/thinkingBudget';

/** The request again, with thinking off and no thinking budget. */
export function withoutThinking(
  params: ApiCompletionParams,
): ApiCompletionParams {
  const next = {...params} as ApiCompletionParams & {
    thinking_budget_tokens?: number;
    thinking_budget_message?: string;
    chat_template_kwargs?: Record<string, unknown>;
  };
  delete next.thinking_budget_tokens;
  delete next.thinking_budget_message;
  next.enable_thinking = false;
  next.chat_template_kwargs = {
    ...next.chat_template_kwargs,
    enable_thinking: false,
  };
  if (next.reasoning) {
    next.reasoning = {
      ...next.reasoning,
      enabled: false,
      effort: undefined,
      budgetTokens: undefined,
      budgetMessage: undefined,
    };
  }
  return next;
}

/** Two parts of one reply: generated tokens and time added up. */
export function addTimings(
  a: CompletionTimings | undefined,
  b: CompletionTimings | undefined,
): CompletionTimings | undefined {
  if (!a || !b) {
    return b ?? a;
  }
  const sum = (x?: number, y?: number) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  const predicted_n = sum(a.predicted_n, b.predicted_n);
  const predicted_ms = sum(a.predicted_ms, b.predicted_ms);
  const out: CompletionTimings = {
    ...b,
    predicted_n,
    predicted_ms,
  };
  if (predicted_n && predicted_ms) {
    out.predicted_per_second = (predicted_n / predicted_ms) * 1000;
    out.predicted_per_token_ms = predicted_ms / predicted_n;
  }
  return out;
}

export class LoopGuardEngine implements CompletionEngine {
  private userStopped = false;

  constructor(
    private inner: CompletionEngine,
    private onLoop?: () => void,
  ) {}

  async completion(
    params: ApiCompletionParams,
    callback?: (data: CompletionStreamData) => void,
  ): Promise<CompletionResult> {
    this.userStopped = false;
    if (
      params.enable_thinking === false ||
      params.reasoning?.enabled === false
    ) {
      return this.inner.completion(params, callback);
    }

    const watch = makeLoopWatcher();
    let reasoning = '';
    let looped = false;
    let first: CompletionResult | undefined;
    try {
      first = await this.inner.completion(params, data => {
        if (looped) {
          return;
        }
        callback?.(data);
        reasoning = data.reasoning_content ?? reasoning;
        const answering = !!data.content?.trim() || !!data.tool_calls?.length;
        if (!answering && watch(reasoning)) {
          looped = true;
          this.inner.stopCompletion().catch(() => {});
        }
      });
    } catch (error) {
      // A server engine throws when stopped; ours is not an error.
      if (!looped || this.userStopped) {
        throw error;
      }
    }
    if (!looped || this.userStopped) {
      if (!first) {
        throw new Error('No reply');
      }
      return first;
    }

    this.onLoop?.();
    const thought = reasoning.trimEnd() + THINKING_BUDGET_MESSAGE;
    callback?.({reasoning_content: thought, content: ''});
    const answer = await this.inner.completion(
      withoutThinking(params),
      data => {
        callback?.({
          ...data,
          reasoning_content: data.reasoning_content
            ? thought + data.reasoning_content
            : thought,
        });
      },
    );
    return {
      ...answer,
      reasoning_content: answer.reasoning_content
        ? thought + answer.reasoning_content
        : thought,
      timings: addTimings(first?.timings, answer.timings),
      tokens_predicted:
        (first?.tokens_predicted ?? 0) + (answer.tokens_predicted ?? 0) ||
        undefined,
    };
  }

  async stopCompletion(): Promise<void> {
    this.userStopped = true;
    await this.inner.stopCompletion();
  }
}

/**
 * The engine with the loop guard, except engines that run thinking their
 * own way (Claude: some models cannot turn thinking off).
 */
export function guardThinkingLoops(engine: CompletionEngine): CompletionEngine {
  if ((engine as {managesThinking?: boolean}).managesThinking) {
    return engine;
  }
  return new LoopGuardEngine(engine);
}
