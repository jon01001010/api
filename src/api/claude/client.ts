/** The Anthropic SDK client, set up to work in React Native. */
import Anthropic from '@anthropic-ai/sdk';

import {ensureTextCodecs} from './utf8';
import {xhrFetch} from './xhrFetch';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com';

export const isAnthropicUrl = (url: string | undefined) =>
  !!url && /^https:\/\/api\.anthropic\.com(\/|$)/i.test(url.trim());

export function claudeClient(apiKey: string | undefined, timeoutMs?: number) {
  ensureTextCodecs();
  return new Anthropic({
    apiKey: apiKey ?? '',
    fetch: xhrFetch as any,
    maxRetries: 2,
    ...(timeoutMs && timeoutMs > 0 ? {timeout: timeoutMs} : {}),
  });
}

export function readableError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new Error(
      'Anthropic rejected the API key (401). Check it in the server settings.',
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new Error(`Anthropic denied access: ${error.message}`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new Error(
      'Anthropic rate limit reached. Wait a moment and try again.',
    );
  }
  if (error instanceof Anthropic.APIError) {
    return new Error(
      `Claude API error ${error.status ?? ''}: ${error.message}`.trim(),
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
