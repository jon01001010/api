/**
 * "Ran out" for a fallback chain of models (ask_model_chain, manyModels.ts):
 * which failures mean "this model can't go on, try the next one" and which
 * mean "stop and tell the user". Plain functions; no stores.
 *
 * Ran out (the next model takes over):
 * - quota: credits or a quota used up (OpenAI "insufficient_quota" /
 *   "exceeded your current quota", DeepSeek 402 "Insufficient Balance",
 *   Anthropic "credit balance is too low", Gemini "RESOURCE_EXHAUSTED" /
 *   "Quota exceeded", the app's own "Daily limit used up …"),
 * - rate_limit: 429 / "rate limit" / "too many requests",
 * - context: the text is too long for the model (OpenAI / DeepSeek
 *   "maximum context length", "context_length_exceeded", llama-server
 *   "exceeds the available context size", Anthropic "prompt is too long",
 *   Gemini "input token count … exceeds", 413, a local "context is full"),
 * - timeout: the app's own time limit, "Idle timeout", "Connection timed
 *   out", Anthropic "Request timed out", 408 / 504,
 * - server: 5xx (Anthropic 529 "Overloaded" too),
 * - unreachable: no connection to the server (a Home PC that is off,
 *   no internet).
 *
 * Never ran out (stop and report): a rejected key (401, "Unauthorized",
 * "rejected the API key"), access denied (403 without quota words), a
 * refusal, a bad request, a model that does not exist, anything unknown.
 *
 * How each engine says it: the OpenAI-compatible engine (api/openai.ts)
 * throws `RemoteHttpError` with `.status` and "Server error: <status> —
 * <server's message>" (a 401 is a plain Error "Unauthorized: …"), and
 * rewrites a 429 quota to "Daily limit used up …" / "Rate limit reached
 * …" keeping status 429 (completionEngines.readableQuotaError); the Claude
 * engine (api/claude/client.readableError) throws an Error with `.status`
 * and "Claude API error <status>: <message>", "Anthropic rate limit
 * reached" or "Anthropic rejected the API key (401)"; the local engine
 * reports a full context as `context_full` on the result.
 */

export type RunOutKind =
  | 'quota'
  | 'rate_limit'
  | 'context'
  | 'timeout'
  | 'server'
  | 'unreachable';

/** The words in the chat line: "<model> ran out (<why>): …". */
export const RUN_OUT_WHY: Record<RunOutKind, string> = {
  quota: 'quota or credits used up',
  rate_limit: 'rate limit',
  context: 'the text is too long for it',
  timeout: 'no answer in time',
  server: 'server error',
  unreachable: 'could not be reached',
};

const messageOf = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String((error as {message?: unknown} | null)?.message ?? error ?? '');

/** The HTTP status, from the error or its message, if there is one. */
export function statusOf(error: unknown): number | undefined {
  const own = (error as {status?: unknown} | null)?.status;
  if (typeof own === 'number' && own >= 100 && own < 600) {
    return own;
  }
  const m =
    /(?:Server error:|Claude API error|status:?|Client error:)\s*(\d{3})\b/i.exec(
      messageOf(error),
    );
  return m ? Number(m[1]) : undefined;
}

const AUTH =
  /unauthori[sz]ed|invalid (or missing )?api key|incorrect api key|rejected the api key|invalid x-api-key|authentication/i;
const QUOTA =
  /insufficient[_ ]quota|exceeded your current quota|quota exceeded|quota|resource[_ ]exhausted|credit balance is too low|insufficient[_ ]balance|out of credits|no credits|billing|daily limit used up|payment required/i;
const RATE = /rate.?limit|too many requests/i;
const CONTEXT =
  /context[_ ]length|maximum context|context size|context window|exceeds the available context|prompt is too long|input token count|too many (input )?tokens|context is full|request too large|reduce the length/i;
const TIMEOUT = /timed? ?out|timeout|deadline exceeded|etimedout/i;
const SERVER =
  /overloaded|internal server error|service unavailable|bad gateway|server is busy/i;
const UNREACHABLE =
  /network error|network request failed|connection error|could not be reached|econnrefused|econnreset|enotfound|ehostunreach|failed to fetch/i;

/**
 * Which kind of "ran out" this error is, or null when it is not one (the
 * chain stops and reports it).
 */
export function runOutOf(error: unknown): RunOutKind | null {
  const status = statusOf(error);
  const text = messageOf(error);
  if (status === 401 || AUTH.test(text)) {
    return null;
  }
  if (status === 402 || QUOTA.test(text)) {
    return 'quota';
  }
  if (status === 429 || RATE.test(text)) {
    return 'rate_limit';
  }
  if (status === 413 || CONTEXT.test(text)) {
    return 'context';
  }
  if (status === 408 || status === 504 || TIMEOUT.test(text)) {
    return 'timeout';
  }
  if ((status !== undefined && status >= 500) || SERVER.test(text)) {
    return 'server';
  }
  if (status === undefined && UNREACHABLE.test(text)) {
    return 'unreachable';
  }
  return null;
}

/** The completion's own signs: a full context (local engine) is a run-out;
 *  a content filter or a refusal is not (it stops the chain). */
export function resultRunOut(result: {
  context_full?: boolean;
}): RunOutKind | null {
  return result?.context_full ? 'context' : null;
}

/** The Claude engine's words when Claude declines (api/claude/engine.ts). */
export const CLAUDE_DECLINED = 'Claude declined to answer this request.';

/** True when the answer is a refusal (stop, never hop to another model). */
export function isRefusal(result: {
  interrupted?: boolean;
  content?: string;
  text?: string;
}): boolean {
  const text = String(result?.content || result?.text || '').trim();
  return !!result?.interrupted || text === CLAUDE_DECLINED;
}
