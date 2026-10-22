import {makeToolDiagnostic, type ToolDiagnostic, type ToolStatus} from './toolDiagnostics';

/** Session-local, bounded, opt-in diagnostic store. No persistent sensitive logs. */
const MAX_RECORDS = 100;
let enabled = false;
let records: ToolDiagnostic[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function enableToolDiagnostics(value: boolean): void {
  enabled = value;
  if (!value) records = [];
  notify();
}
export function toolDiagnosticsEnabled(): boolean { return enabled; }
export function getToolDiagnostics(): ToolDiagnostic[] { return records.map(r => ({...r})); }
export function clearToolDiagnostics(): void { records = []; notify(); }
export function subscribeToolDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function recordToolDiagnostic(callId: string, toolName: string, args: string,
  startedAt: number, status: ToolStatus, summary: string): void {
  if (!enabled) return;
  records = [...records, makeToolDiagnostic(callId, toolName, args, startedAt, status, summary)].slice(-MAX_RECORDS);
  notify();
}
