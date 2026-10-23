import type {ToolCallRecord} from './ToolCallJournal';
/** Export a privacy-minimal diagnostic snapshot, no args, results or raw error text. */
export function exportToolJournal(records: ToolCallRecord[]): string {
  return JSON.stringify({schema: 1, exportedAt: new Date().toISOString(), entries: records.map(r => ({
    id: r.id, tool: r.tool, startedAt: r.startedAt, elapsedMs: r.elapsedMs ?? null,
    status: r.status, errorType: r.errorType ?? null,
  }))}, null, 2);
}
