/** Diagnostic metadata only; never store auth headers or API keys in exported records. */
export type ToolStatus = 'success' | 'error' | 'denied' | 'cancelled';
export interface ToolDiagnostic {
  callId: string;
  toolName: string;
  rawArguments: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  status: ToolStatus;
  resultSummary: string;
}
const SENSITIVE_KEY = /^(api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|cookie)$/i;
function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 100).map(x => redact(x, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([k,v]) => [k, SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1)]));
  return typeof value === 'string' ? value.slice(0, 10000) : value;
}
export function safeToolArguments(raw: string): string {
  try { return JSON.stringify(redact(JSON.parse(raw))); }
  catch { return '[invalid JSON arguments omitted]'; }
}
export function makeToolDiagnostic(callId: string, toolName: string, rawArguments: string, startedAt: number, status: ToolStatus, resultSummary: string): ToolDiagnostic {
  const finishedAt = Date.now();
  return {callId, toolName, rawArguments: safeToolArguments(rawArguments), startedAt, finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt), status, resultSummary: '[tool response hidden: may contain sensitive data]' };
}
