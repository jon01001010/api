/**
 * Context summary: when a chat fills the model's memory, older messages are
 * replaced (for the model only) by a short summary written by the model.
 *
 * The summary is stored as a marker message in the chat, added at the point
 * where it happened. Its metadata lists the recent messages that were kept
 * word for word. What the model then sees:
 *   system prompt + summary + the kept messages + anything newer.
 * Older messages stay visible on screen (greyed). Deleting the marker (Undo)
 * restores the full context; editing its text edits the summary.
 */
import {chatSessionStore, modelStore, uiStore} from '../store';
import type {MessageType} from '../utils/types';
import type {CompletionEngine} from '../utils/completionTypes';

/** Recent messages kept word for word after a summary. */
export const SUMMARY_KEEP_RECENT = 4;
/** Longest summary the model may write, in tokens. */
export const SUMMARY_MAX_TOKENS = 400;
/** Author id of summary markers (never a real user or assistant). */
export const SUMMARY_AUTHOR_ID = 'pocketagent-context-summary';

export interface SummaryMeta {
  contextSummary: true;
  /** Ids of the recent messages kept word for word. */
  keptIds: string[];
  /** How many messages this summary replaced (for display). */
  summarizedCount: number;
}

export const isSummaryMessage = (m: MessageType.Any | undefined): boolean =>
  !!m && (m.metadata as any)?.contextSummary === true;

/** The newest summary marker (messages are stored newest first). */
export function findLatestSummary(
  messages: MessageType.Any[],
): MessageType.Text | undefined {
  return messages.find(isSummaryMessage) as MessageType.Text | undefined;
}

/**
 * What the model should see. `messages` is newest first (store order).
 * Returns the summary text (if any) and the messages to send, newest first:
 * everything newer than the latest summary, plus the messages it kept.
 */
export function messagesForModel(messages: MessageType.Any[]): {
  summary?: string;
  messages: MessageType.Any[];
} {
  const index = messages.findIndex(isSummaryMessage);
  if (index === -1) {
    return {messages};
  }
  const marker = messages[index] as MessageType.Text;
  const kept = new Set((marker.metadata as SummaryMeta).keptIds ?? []);
  const newer = messages.slice(0, index).filter(m => !isSummaryMessage(m));
  const keptOlder = messages.slice(index + 1).filter(m => kept.has(m.id));
  return {summary: marker.text, messages: [...newer, ...keptOlder]};
}

/**
 * Ids of messages the latest summary replaced (for greying them on screen):
 * older than the marker and not kept.
 */
export function summarizedMessageIds(messages: MessageType.Any[]): Set<string> {
  const index = messages.findIndex(isSummaryMessage);
  if (index === -1) {
    return new Set();
  }
  const kept = new Set(
    ((messages[index].metadata as SummaryMeta).keptIds ?? []) as string[],
  );
  return new Set(
    messages
      .slice(index + 1)
      .filter(m => !kept.has(m.id) && !isSummaryMessage(m))
      .map(m => m.id),
  );
}

/** One line of plain text per message, oldest first. */
export function transcriptOf(
  oldestFirst: MessageType.Any[],
  userId: string,
): string {
  const lines: string[] = [];
  for (const m of oldestFirst) {
    if (isSummaryMessage(m)) {
      continue;
    }
    if (m.type === 'text') {
      const who = m.author?.id === userId ? 'User' : 'Assistant';
      const pictures = m.imageUris?.length ?? 0;
      const note = pictures ? ` [${pictures} picture(s) attached]` : '';
      lines.push(`${who}: ${(m.text ?? '').trim()}${note}`);
    } else if (m.type === 'assistant_turn') {
      for (const step of m.steps ?? []) {
        if (step.content?.trim()) {
          lines.push(`Assistant: ${step.content.trim()}`);
        }
        for (const outcome of step.toolOutcomes ?? []) {
          const name = (outcome as any).toolName ?? 'tool';
          const result = String((outcome as any).result?.summary ?? '').slice(
            0,
            300,
          );
          lines.push(`Assistant used ${name}${result ? `: ${result}` : ''}`);
        }
      }
    }
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT =
  'You compress chat history. Write a concise summary that lets the ' +
  'conversation continue without the original messages: key facts, ' +
  "the user's goals and preferences, decisions made, names, numbers, " +
  'files and tool results that matter, and open tasks. Plain text, no ' +
  'preamble, at most about 250 words. Do not invent anything.';

/** Rough characters per token for budgeting (no tokenizer needed). */
const CHARS_PER_TOKEN = 3.5;

/**
 * Ask the model for a summary. Long transcripts are summarized in chunks
 * that fit the model's context, each chunk folding in the summary so far.
 */
export async function summarizeTranscript(
  engine: CompletionEngine,
  transcript: string,
  previousSummary: string | undefined,
  contextTokens: number,
  signal?: AbortSignal,
): Promise<string> {
  // Leave room for the instructions, the running summary and the answer.
  const budgetChars = Math.max(
    2000,
    Math.floor(
      (contextTokens - SUMMARY_MAX_TOKENS * 2 - 300) * CHARS_PER_TOKEN,
    ),
  );
  const chunks: string[] = [];
  for (let i = 0; i < transcript.length; i += budgetChars) {
    chunks.push(transcript.slice(i, i + budgetChars));
  }
  let summary = previousSummary?.trim() || '';
  for (const chunk of chunks) {
    if (signal?.aborted) {
      throw new Error('Cancelled');
    }
    const user =
      (summary ? `Summary so far:\n${summary}\n\n` : '') +
      `Conversation to add:\n${chunk}\n\nWrite the updated summary.`;
    const result = await engine.completion({
      messages: [
        {role: 'system', content: SYSTEM_PROMPT},
        {role: 'user', content: user},
      ],
      n_predict: SUMMARY_MAX_TOKENS,
      temperature: 0.3,
      jinja: true,
      enable_thinking: false,
    } as any);
    const text = String(result?.content ?? '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    if (!text) {
      throw new Error('The model returned an empty summary');
    }
    summary = text;
  }
  return summary;
}

export type SummarizeResult = 'done' | 'nothing' | 'busy' | 'failed';

/**
 * Summarize the current chat: everything except the last
 * SUMMARY_KEEP_RECENT messages (and any previous summary) becomes one new
 * summary marker. Leaves the chat unchanged on failure.
 */
export async function summarizeCurrentChat(
  userId: string,
  options: {automatic?: boolean} = {},
): Promise<SummarizeResult> {
  const all = chatSessionStore.currentSessionMessages;
  const {summary: previous, messages} = messagesForModel(all);
  const kept = messages.slice(0, SUMMARY_KEEP_RECENT);
  const toSummarize = messages.slice(SUMMARY_KEEP_RECENT);
  if (toSummarize.length === 0) {
    return 'nothing';
  }
  if (modelStore.isGenerationBusy) {
    return 'busy';
  }
  const lease = await modelStore.acquireGeneration();
  if (!lease) {
    return 'busy';
  }
  let text: string;
  try {
    text = await summarizeTranscript(
      lease.engine,
      transcriptOf([...toSummarize].reverse(), userId),
      previous,
      modelStore.activeModelCaps.effectiveContextLength ?? 4096,
      lease.signal,
    );
  } catch (error) {
    console.warn('[chatSummary] summary failed', error);
    return 'failed';
  } finally {
    lease.end();
  }
  const meta: SummaryMeta = {
    contextSummary: true,
    keptIds: kept.map(m => m.id),
    summarizedCount: toSummarize.length,
  };
  await chatSessionStore.addMessageToCurrentSession({
    id: `summary-${Date.now()}`,
    author: {id: SUMMARY_AUTHOR_ID},
    createdAt: Date.now(),
    type: 'text',
    text,
    metadata: meta,
  } as MessageType.Text);
  // The chat is no longer near full: clear the banner state, and offer Undo.
  chatSessionStore.clearCompletionSnapshot();
  const marker = findLatestSummary(chatSessionStore.currentSessionMessages);
  if (marker) {
    uiStore.setSummaryNotice({
      kind: 'done',
      messageId: marker.id,
      automatic: !!options.automatic,
    });
  }
  return 'done';
}

let running = false;

/**
 * Summarize with on-screen progress: shows "Summarizing…", then the result
 * (done with Undo, failed, or nothing to do). One run at a time.
 */
export async function summarizeWithNotice(
  userId: string,
  options: {automatic?: boolean} = {},
): Promise<SummarizeResult> {
  if (running) {
    return 'busy';
  }
  running = true;
  try {
    if (!options.automatic) {
      uiStore.setSummaryNotice({kind: 'working'});
    }
    const result = await summarizeCurrentChat(userId, options);
    if (result === 'failed') {
      uiStore.setSummaryNotice({kind: 'failed'});
    } else if (result === 'nothing' && !options.automatic) {
      uiStore.setSummaryNotice({kind: 'nothing'});
    } else if (result !== 'done' && !options.automatic) {
      uiStore.setSummaryNotice(null);
    }
    return result;
  } finally {
    running = false;
  }
}

/** True when the chat has older messages a summary could replace. */
export function canSummarize(messages: MessageType.Any[]): boolean {
  return messagesForModel(messages).messages.length > SUMMARY_KEEP_RECENT;
}

/** Undo: remove the summary marker, restoring the full context. */
export async function removeSummary(messageId: string): Promise<void> {
  uiStore.setSummaryNotice(null);
  const sessionId = chatSessionStore.activeSessionId;
  if (sessionId) {
    await chatSessionStore.deleteMessageFromSession(sessionId, messageId);
  }
}

/** Edit the summary text the model will see. */
export async function editSummary(
  messageId: string,
  text: string,
): Promise<void> {
  const sessionId = chatSessionStore.activeSessionId;
  if (sessionId) {
    await chatSessionStore.updateMessage(messageId, sessionId, {text} as any);
  }
}
