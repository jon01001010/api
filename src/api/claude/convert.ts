/**
 * The app's chat format (OpenAI style: system / user / assistant with
 * tool_calls / tool) to Claude's Messages format, and Claude's reply back.
 */
import type Anthropic from '@anthropic-ai/sdk';

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type BetaContentBlock = Anthropic.Beta.BetaContentBlock;
type BetaToolUnion = Anthropic.Beta.BetaToolUnion;

export interface AppMessage {
  role: string;
  content?: any;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: {name?: string; arguments?: string};
  }>;
  tool_call_id?: string;
  reasoning_content?: string;
}

/**
 * Claude's own assistant content (with thinking blocks), keyed by the
 * turn's first tool-call id, or by its text for a turn without tools.
 * Sending these back unchanged keeps thinking valid; the app's history
 * only keeps text and tool calls.
 */
export type RawTurnCache = Map<string, BetaContentBlock[]>;

function imageBlock(url: string): BetaContentBlockParam | null {
  const data = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(url);
  if (data) {
    const mediaType = data[1].toLowerCase();
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: (allowed.includes(mediaType)
          ? mediaType
          : 'image/jpeg') as any,
        data: data[2],
      },
    };
  }
  if (/^https?:\/\//.test(url)) {
    return {type: 'image', source: {type: 'url', url}};
  }
  return null;
}

function userContent(content: any): BetaContentBlockParam[] {
  if (typeof content === 'string') {
    return content.trim() ? [{type: 'text', text: content}] : [];
  }
  const blocks: BetaContentBlockParam[] = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === 'text' && part.text?.trim()) {
      blocks.push({type: 'text', text: part.text});
    } else if (part?.type === 'image_url' && part.image_url?.url) {
      const image = imageBlock(part.image_url.url);
      if (image) {
        blocks.push(image);
      }
    }
  }
  return blocks;
}

const textOf = (content: any): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((p: any) => p?.type === 'text' && p.text)
          .map((p: any) => p.text)
          .join('\n')
      : '';

function parseArgs(args: string | undefined): Record<string, unknown> {
  try {
    const value = JSON.parse(args || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

/** Cache key for an assistant turn without tool calls. */
export const textKey = (text: string) => `text:${text.trim()}`;

const stripThinking = (blocks: BetaContentBlock[]) =>
  blocks.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking');

/**
 * Build Claude's `system` and `messages`. All system messages become the
 * top-level system prompt. Consecutive tool results go into one user
 * message (Claude expects all results of one turn together).
 * `keepThinking` replays cached thinking blocks (only when the request
 * can drop stale ones, or the model doesn't bind them).
 */
export function toClaudeMessages(
  messages: AppMessage[],
  cache: RawTurnCache,
  keepThinking: boolean,
): {system?: string; messages: BetaMessageParam[]} {
  const system: string[] = [];
  const out: BetaMessageParam[] = [];

  const append = (
    role: 'user' | 'assistant',
    blocks: BetaContentBlockParam[],
  ) => {
    if (!blocks.length) {
      return;
    }
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) {
      (last.content as BetaContentBlockParam[]).push(...blocks);
    } else {
      out.push({role, content: blocks});
    }
  };

  for (const m of messages) {
    if (m.role === 'system') {
      const text = textOf(m.content).trim();
      if (text) {
        system.push(text);
      }
    } else if (m.role === 'user') {
      append('user', userContent(m.content));
    } else if (m.role === 'tool') {
      append('user', [
        {
          type: 'tool_result',
          tool_use_id: m.tool_call_id ?? '',
          content: textOf(m.content) || '(no output)',
        },
      ]);
    } else if (m.role === 'assistant') {
      const calls = m.tool_calls ?? [];
      const cached = cache.get(
        calls.length ? (calls[0].id ?? '') : textKey(textOf(m.content)),
      );
      if (cached) {
        append(
          'assistant',
          (keepThinking ? cached : stripThinking(cached)) as any,
        );
        continue;
      }
      const blocks: BetaContentBlockParam[] = [];
      const text = textOf(m.content);
      if (text.trim()) {
        blocks.push({type: 'text', text});
      }
      for (const call of calls) {
        blocks.push({
          type: 'tool_use',
          id: call.id ?? '',
          name: call.function?.name ?? '',
          input: parseArgs(call.function?.arguments),
        });
      }
      append('assistant', blocks);
    }
  }
  // Claude's conversation must start with the user (e.g. drop a greeting).
  while (out.length && out[0].role !== 'user') {
    out.shift();
  }
  return {
    system: system.length ? system.join('\n\n') : undefined,
    messages: out,
  };
}

/** OpenAI-style function tools to Claude tools. */
export function toClaudeTools(tools: any[] | undefined): BetaToolUnion[] {
  return (tools ?? [])
    .filter(t => t?.type === 'function' && t.function?.name)
    .map(t => ({
      name: t.function.name,
      description: t.function.description ?? '',
      input_schema: {
        type: 'object',
        ...(t.function.parameters ?? {}),
      } as any,
    }));
}

/**
 * The app's tool choice. Newer Claude models reject forced tool choice
 * ('required' / a named tool), so those become 'auto'.
 */
export function toClaudeToolChoice(
  choice: any,
): Anthropic.Beta.BetaToolChoice | undefined {
  if (choice === 'none') {
    return {type: 'none'};
  }
  if (choice === undefined || choice === null) {
    return undefined;
  }
  return {type: 'auto'};
}
