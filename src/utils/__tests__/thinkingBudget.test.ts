/**
 * How long a model may think: sent to the phone's runner (llama.rn) and to
 * llama.cpp servers (This PC, Home PC) by the same numbers, so a model that
 * goes "wait, I should…" round and round must answer at the limit.
 */
import {bodyExtras} from '../../api/servers';
import type {ApiCompletionParams} from '../completionTypes';
import {
  applyThinkingBudget,
  DEFAULT_THINKING_LENGTH,
  THINKING_BUDGET_MESSAGE,
  THINKING_TOKENS,
} from '../thinkingBudget';

const params = (p: Partial<ApiCompletionParams>) => p as ApiCompletionParams;

it('limits thinking by default (medium)', () => {
  expect(DEFAULT_THINKING_LENGTH).toBe('medium');
  expect(THINKING_TOKENS.medium).toBeGreaterThan(0);
});

it("sets llama.rn's own fields and the servers' reasoning intent", () => {
  const p = params({enable_thinking: true, reasoning: {enabled: true}});
  applyThinkingBudget(p, 'short');
  expect((p as any).thinking_budget_tokens).toBe(THINKING_TOKENS.short);
  expect((p as any).thinking_budget_message).toBe(THINKING_BUDGET_MESSAGE);
  expect(p.reasoning).toEqual({
    enabled: true,
    budgetTokens: THINKING_TOKENS.short,
    budgetMessage: THINKING_BUDGET_MESSAGE,
  });
  // llama.cpp reads it per request.
  expect(
    bodyExtras('llama.cpp', {samplers: {}, reasoning: p.reasoning}),
  ).toEqual({
    reasoning_format: 'auto',
    thinking_budget_tokens: THINKING_TOKENS.short,
    reasoning_budget_message: THINKING_BUDGET_MESSAGE,
  });
});

it('adds nothing with Think off or no limit', () => {
  const off = params({enable_thinking: false, reasoning: {enabled: false}});
  applyThinkingBudget(off, 'short');
  expect((off as any).thinking_budget_tokens).toBeUndefined();
  expect(off.reasoning).toEqual({enabled: false});

  const unlimited = params({enable_thinking: true, reasoning: {enabled: true}});
  applyThinkingBudget(unlimited, 'unlimited');
  expect((unlimited as any).thinking_budget_tokens).toBeUndefined();
  expect(
    bodyExtras('llama.cpp', {samplers: {}, reasoning: unlimited.reasoning}),
  ).toEqual({
    reasoning_format: 'auto',
  });
});

it('effort and budget go together', () => {
  expect(
    bodyExtras('llama.cpp', {
      samplers: {},
      reasoning: {enabled: true, effort: 'low', budgetTokens: 512},
    }),
  ).toEqual({
    reasoning_format: 'auto',
    thinking_budget_tokens: 512,
    chat_template_kwargs: {reasoning_effort: 'low'},
  });
});
