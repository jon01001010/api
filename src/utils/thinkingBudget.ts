/**
 * How long a model may think before it must answer (Toolbox → What the
 * model sees → Thinking). With Think on, a model could go "wait, I
 * should…" round and round and never answer (2026-11-08). When the budget
 * runs out, the runner ends the thinking with a short note and the model
 * answers: llama.rn on the phone, llama.cpp servers (This PC, Home PC) by
 * the same numbers. Other servers ignore it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type {ApiCompletionParams} from './completionTypes';

export type ThinkingLength = 'short' | 'medium' | 'long' | 'unlimited';

/** Thinking tokens allowed (-1: no limit). */
export const THINKING_TOKENS: Record<ThinkingLength, number> = {
  short: 512,
  medium: 2048,
  long: 8192,
  unlimited: -1,
};

export const DEFAULT_THINKING_LENGTH: ThinkingLength = 'medium';

/** Put before the end of the thinking when the budget runs out. */
export const THINKING_BUDGET_MESSAGE =
  '\n\nI have thought enough. Now I will give my answer directly.\n';

const KEY = '@pocketagent/thinking-length/v1';

export async function readThinkingLength(): Promise<ThinkingLength> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    return saved && saved in THINKING_TOKENS
      ? (saved as ThinkingLength)
      : DEFAULT_THINKING_LENGTH;
  } catch {
    return DEFAULT_THINKING_LENGTH;
  }
}

export async function writeThinkingLength(length: ThinkingLength) {
  await AsyncStorage.setItem(KEY, length);
}

/**
 * Adds the budget to a request when the model will think: as llama.rn's own
 * fields (phone) and inside the reasoning intent (servers; see
 * api/servers llamaCppReasoningExtras). No limit: nothing is added.
 */
export function applyThinkingBudget(
  params: ApiCompletionParams,
  length: ThinkingLength,
): void {
  const tokens = THINKING_TOKENS[length];
  const thinking = params.enable_thinking !== false;
  if (tokens < 0 || !thinking) {
    return;
  }
  const extra = params as ApiCompletionParams & {
    thinking_budget_tokens?: number;
    thinking_budget_message?: string;
  };
  extra.thinking_budget_tokens = tokens;
  extra.thinking_budget_message = THINKING_BUDGET_MESSAGE;
  if (params.reasoning && params.reasoning.enabled) {
    params.reasoning = {
      ...params.reasoning,
      budgetTokens: tokens,
      budgetMessage: THINKING_BUDGET_MESSAGE,
    };
  }
}
