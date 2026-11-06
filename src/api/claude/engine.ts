/**
 * Claude (Anthropic Messages API) as a remote chat model, through the
 * official SDK. One `completion()` call is one streamed Claude message; the
 * app's agent loop runs the tools and calls again, as with other engines.
 */
import type {
  ApiCompletionParams,
  CompletionEngine,
  CompletionResult,
  CompletionStreamData,
} from '../../utils/completionTypes';
import type {RemoteEndpoint} from '../servers';
import {encodeMessagesForRemote, hasLocalImageAttachment} from '../openai';
import {claudeFeatures} from './models';
import {
  textKey,
  toClaudeMessages,
  toClaudeToolChoice,
  toClaudeTools,
  type AppMessage,
  type RawTurnCache,
} from './convert';
import {claudeClient, readableError} from './client';

const DEFAULT_MAX_TOKENS = 32000;
const CACHE_LIMIT = 200;

/** Map the app's effort word to one this model accepts. */
function pickEffort(effort: string | undefined, allowed: string[]) {
  if (!effort || !allowed.length) {
    return undefined;
  }
  const e = effort.toLowerCase();
  if (allowed.includes(e)) {
    return e;
  }
  if (e === 'minimal' || e === 'none') {
    return 'low';
  }
  if (e === 'xhigh' || e === 'max') {
    return allowed.includes('max') ? 'max' : 'high';
  }
  return undefined;
}

export interface BuiltRequest {
  body: Record<string, any>;
  betas: string[];
  keepThinking: boolean;
}

/** The request body for one turn, with only options this model accepts. */
export function buildClaudeRequest(
  params: ApiCompletionParams,
  messages: AppMessage[],
  modelId: string,
  cache: RawTurnCache,
  /** The model's output cap, from the Models API, when known. */
  maxOutput?: number,
): BuiltRequest {
  const f = claudeFeatures(modelId);
  const betas: string[] = [];
  const body: Record<string, any> = {model: modelId};
  const reasoning = params.reasoning;
  const output: Record<string, any> = {};
  let thinking: Record<string, any> | undefined;

  if (f.adaptive) {
    // Thinking on unless the app turned it off.
    const wantThinking = reasoning ? reasoning.enabled : true;
    let effort = pickEffort(reasoning?.effort, f.efforts);
    if (wantThinking) {
      thinking = {type: 'adaptive', display: 'summarized'};
    } else if (f.thinkingAlwaysOn) {
      // Can't be turned off: keep it brief and hidden.
      thinking = {type: 'adaptive'};
      effort = 'low';
    } else {
      thinking = {type: f.offIsBetweenTools ? 'between_tools' : 'disabled'};
      if (
        (f.offIsBetweenTools || f.offNeedsHighOrLower) &&
        (effort === 'xhigh' || effort === 'max')
      ) {
        effort = 'high';
      }
    }
    if (effort) {
      output.effort = effort;
    }
    if (f.bindsThinking && thinking.type === 'adaptive') {
      // The app edits history (memory, summaries): drop thinking blocks
      // that no longer match instead of failing the request.
      thinking.block_binding = {prefix_mismatch_behavior: 'drop_block'};
      betas.push('thinking-binding-controls-2026-08-01');
    }
    body.thinking = thinking;
  }
  const keepThinking = !thinking || thinking.type === 'adaptive';

  if (f.fallbacks && thinking?.type !== 'between_tools') {
    // If Claude declines on safety grounds, the API retries on another
    // Claude model in the same call.
    body.fallbacks = 'default';
    betas.push('server-side-fallback-2026-07-01');
  }

  const {system, messages: claudeMessages} = toClaudeMessages(
    messages,
    cache,
    keepThinking,
  );
  if (system) {
    body.system = system;
  }
  body.messages = claudeMessages;

  const tools = toClaudeTools((params as any).tools);
  if (tools.length) {
    body.tools = tools;
    const choice = toClaudeToolChoice((params as any).tool_choice);
    if (choice) {
      body.tool_choice = choice;
    }
  }
  const format = (params as any).response_format;
  if (format?.type === 'json_schema' && format.json_schema?.schema) {
    output.format = {type: 'json_schema', schema: format.json_schema.schema};
  }
  if (Object.keys(output).length) {
    body.output_config = output;
  }
  const n = Number((params as any).n_predict);
  const wanted = Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
  body.max_tokens = maxOutput ? Math.min(wanted, maxOutput) : wanted;
  // Sampling settings and local stop words are not sent: newer Claude
  // models reject sampling parameters, and the app's stop words are chat
  // template tokens for local models.
  return {body, betas, keepThinking};
}

export class ClaudeCompletionEngine implements CompletionEngine {
  private abortController: AbortController | null = null;
  private cache: RawTurnCache = new Map();
  /** Output cap from the Models API (null = couldn't read it). */
  private maxOutput: number | null | undefined;

  constructor(private endpoint: RemoteEndpoint) {}

  private remember(key: string, content: any[]) {
    this.cache.delete(key);
    this.cache.set(key, content);
    while (this.cache.size > CACHE_LIMIT) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
  }

  async completion(
    params: ApiCompletionParams,
    callback?: (data: CompletionStreamData) => void,
  ): Promise<CompletionResult> {
    const controller = new AbortController();
    this.abortController = controller;
    const raw = (params.messages ?? []) as any[];
    const messages = (
      hasLocalImageAttachment(raw) ? await encodeMessagesForRemote(raw) : raw
    ) as AppMessage[];
    const client = claudeClient(this.endpoint.apiKey, this.endpoint.timeoutMs);
    if (this.maxOutput === undefined) {
      try {
        const info: any = await client.models.retrieve(
          this.endpoint.remoteModelId,
        );
        this.maxOutput =
          typeof info?.max_tokens === 'number' ? info.max_tokens : null;
      } catch {
        this.maxOutput = null;
      }
    }
    const {body, betas} = buildClaudeRequest(
      params,
      messages,
      this.endpoint.remoteModelId,
      this.cache,
      this.maxOutput ?? undefined,
    );

    let content = '';
    let reasoning = '';
    let tokensPredicted = 0;
    const toolBlocks = new Map<
      number,
      {id: string; name: string; args: string}
    >();
    const snapshot = () =>
      [...toolBlocks.values()].map(t => ({
        type: 'function' as const,
        id: t.id,
        function: {name: t.name, arguments: t.args},
      }));

    try {
      const stream = client.beta.messages.stream(
        {...(body as any), ...(betas.length ? {betas} : {})},
        {signal: controller.signal},
      );
      for await (const event of stream as AsyncIterable<any>) {
        if (event.type === 'content_block_start') {
          if (event.content_block?.type === 'tool_use') {
            toolBlocks.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              args: '',
            });
            callback?.({
              token: '',
              content: content || undefined,
              tool_calls: snapshot(),
            });
          }
        } else if (event.type === 'content_block_delta') {
          const d = event.delta;
          if (d?.type === 'text_delta' && d.text) {
            content += d.text;
            tokensPredicted++;
            callback?.({
              token: d.text,
              content,
              reasoning_content: reasoning || undefined,
            });
          } else if (d?.type === 'thinking_delta' && d.thinking) {
            reasoning += d.thinking;
            callback?.({
              token: d.thinking,
              content: content || undefined,
              reasoning_content: reasoning,
            });
          } else if (d?.type === 'input_json_delta') {
            const t = toolBlocks.get(event.index);
            if (t) {
              t.args += d.partial_json ?? '';
            }
          }
        }
      }
      const final: any = await stream.finalMessage();
      const blocks: any[] = final.content ?? [];
      const toolUses = blocks.filter(b => b.type === 'tool_use');
      const text = blocks
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      const result: CompletionResult = {
        text: text || content,
        content: text || content,
        reasoning_content: reasoning || undefined,
        tokens_predicted: final.usage?.output_tokens ?? tokensPredicted,
        tokens_evaluated:
          (final.usage?.input_tokens ?? 0) +
          (final.usage?.cache_read_input_tokens ?? 0) +
          (final.usage?.cache_creation_input_tokens ?? 0),
      };
      if (final.stop_reason === 'max_tokens') {
        // A tool call cut off mid-input can't be trusted: don't run it.
        result.stopped_limit = 1;
      } else if (final.stop_reason === 'refusal') {
        if (!result.content.trim()) {
          result.content = result.text =
            'Claude declined to answer this request.';
        }
        result.stopped_eos = true;
      } else {
        result.stopped_eos = true;
        if (toolUses.length) {
          result.tool_calls = toolUses.map(b => ({
            type: 'function' as const,
            id: b.id,
            function: {name: b.name, arguments: JSON.stringify(b.input ?? {})},
          }));
        }
      }
      // Keep Claude's own content so the next request replays it unchanged.
      this.remember(
        toolUses.length && result.tool_calls
          ? toolUses[0].id
          : textKey(result.content),
        blocks,
      );
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          text: content,
          content,
          reasoning_content: reasoning || undefined,
          tokens_predicted: tokensPredicted,
          interrupted: true,
        };
      }
      throw readableError(error);
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  async stopCompletion(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
  }
}
