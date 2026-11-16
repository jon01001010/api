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

/** Keeps the HTTP status on the readable error (fallback chains use it:
 *  services/agent/runOut.ts). */
function withStatus(error: Error, status: unknown): Error {
  if (typeof status === 'number') {
    (error as Error & {status?: number}).status = status;
  }
  return error;
}

export function readableError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return withStatus(
      new Error(
        'Anthropic rejected the API key (401). Check it in the server settings.',
      ),
      401,
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return withStatus(
      new Error(`Anthropic denied access: ${error.message}`),
      error.status,
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return withStatus(
      new Error('Anthropic rate limit reached. Wait a moment and try again.'),
      429,
    );
  }
  if (error instanceof Anthropic.APIError) {
    return withStatus(
      new Error(
        `Claude API error ${error.status ?? ''}: ${error.message}`.trim(),
      ),
      error.status,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
