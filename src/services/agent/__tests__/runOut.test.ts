import Anthropic from '@anthropic-ai/sdk';

import {readableError} from '../../../api/claude/client';
import {readableQuotaError} from '../../../api/completionEngines';
import {RemoteHttpError} from '../../../utils/errors';
import {
  CLAUDE_DECLINED,
  isRefusal,
  resultRunOut,
  runOutOf,
  statusOf,
} from '../runOut';

/** The OpenAI-compatible engine's error for a non-2xx answer (openai.ts). */
const openAi = (status: number, message: string) =>
  status === 401
    ? new Error('Unauthorized: Invalid or missing API key')
    : new RemoteHttpError(
        `Server error: ${status} — ${message}`,
        status,
        message,
      );

/** The Claude engine's error for an SDK error (claude/client.ts). */
const claude = (status: number | undefined, type: string, message: string) =>
  readableError(
    Anthropic.APIError.generate(
      status,
      {type: 'error', error: {type, message}},
      undefined,
      status ? (new Headers() as any) : undefined,
    ),
  );

describe('runOutOf: OpenAI-compatible engines (OpenAI, DeepSeek, Gemini, llama-server)', () => {
  it.each([
    [
      429,
      'You exceeded your current quota, please check your plan and billing details.',
      'quota',
    ],
    [402, 'Insufficient Balance', 'quota'],
    [
      429,
      'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests. Please retry in 14h29m47.99s',
      'quota',
    ],
    [
      429,
      'Rate limit reached for gpt-x in organization org on requests per min',
      'rate_limit',
    ],
    [
      400,
      "This model's maximum context length is 65536 tokens. However, you requested 70000 tokens.",
      'context',
    ],
    [
      400,
      'request (9000 tokens) exceeds the available context size (8192 tokens), try increasing it',
      'context',
    ],
    [
      400,
      'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
      'context',
    ],
    [413, 'Payload Too Large', 'context'],
    [500, 'Internal error', 'server'],
    [503, 'The model is overloaded. Please try again later.', 'server'],
    [504, 'Gateway Timeout', 'timeout'],
  ])('%i %s → %s', (status, message, kind) => {
    expect(runOutOf(openAi(status, message))).toBe(kind);
  });

  it('the rewritten quota message (completionEngines) still reads as quota / rate limit', () => {
    const daily = readableQuotaError(
      openAi(429, 'Quota exceeded per day for free tier. retry in 14h2m'),
      'gemini-x',
    );
    expect((daily as Error).message).toMatch(/Daily limit used up/);
    expect(runOutOf(daily)).toBe('quota');
    expect(runOutOf(new RemoteHttpError('Too Many Requests', 429))).toBe(
      'rate_limit',
    );
  });

  it('the stream errors: idle, connect timeout, network', () => {
    expect(runOutOf(new Error('Idle timeout: no data received'))).toBe(
      'timeout',
    );
    expect(runOutOf(new Error('Connection timed out'))).toBe('timeout');
    expect(runOutOf(new Error('Network error'))).toBe('unreachable');
    expect(runOutOf(new Error('Your PC could not be reached'))).toBe(
      'unreachable',
    );
  });

  it('never for a rejected key, access denied, a bad request or a missing model', () => {
    expect(runOutOf(openAi(401, 'bad key'))).toBeNull();
    expect(runOutOf(openAi(403, 'Forbidden'))).toBeNull();
    expect(runOutOf(openAi(400, 'Invalid value for temperature'))).toBeNull();
    expect(runOutOf(openAi(404, 'The model `x` does not exist'))).toBeNull();
    expect(runOutOf(new Error('Something odd'))).toBeNull();
    expect(runOutOf(undefined)).toBeNull();
  });
});

describe('runOutOf: the Claude engine', () => {
  it('keeps the status on its readable errors', () => {
    expect(statusOf(claude(429, 'rate_limit_error', 'slow down'))).toBe(429);
    expect(statusOf(claude(529, 'overloaded_error', 'Overloaded'))).toBe(529);
  });

  it.each([
    [
      429,
      'rate_limit_error',
      'Number of request tokens has exceeded your per-minute rate limit',
      'rate_limit',
    ],
    [
      400,
      'invalid_request_error',
      'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      'quota',
    ],
    [
      400,
      'invalid_request_error',
      'prompt is too long: 210000 tokens > 200000 maximum',
      'context',
    ],
    [529, 'overloaded_error', 'Overloaded', 'server'],
    [500, 'api_error', 'Internal server error', 'server'],
  ])('%i %s → %s', (status, type, message, kind) => {
    expect(runOutOf(claude(status, type, message))).toBe(kind);
  });

  it('a timeout and a lost connection', () => {
    expect(
      runOutOf(readableError(new Anthropic.APIConnectionTimeoutError())),
    ).toBe('timeout');
    expect(
      runOutOf(
        readableError(new Anthropic.APIConnectionError({message: undefined})),
      ),
    ).toBe('unreachable');
  });

  it('never for a rejected key or denied access', () => {
    expect(
      runOutOf(claude(401, 'authentication_error', 'invalid x-api-key')),
    ).toBeNull();
    expect(runOutOf(claude(403, 'permission_error', 'not allowed'))).toBeNull();
    expect(
      runOutOf(claude(400, 'invalid_request_error', 'temperature: bad')),
    ).toBeNull();
  });
});

describe('the completion itself', () => {
  it('a full local context is a run-out; a refusal is not', () => {
    expect(resultRunOut({context_full: true})).toBe('context');
    expect(resultRunOut({})).toBeNull();
    expect(isRefusal({content: CLAUDE_DECLINED})).toBe(true);
    expect(isRefusal({content: 'x', interrupted: true})).toBe(true);
    expect(isRefusal({content: 'Fine.'})).toBe(false);
  });
});
