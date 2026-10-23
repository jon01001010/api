import type {ToolCallRecord} from './ToolCallJournal';
/** #18: Aggregate counts for a developer screen without exposing raw inputs. */
export type ToolJournalSummary = {total: number; running: number; success: number; error: number; denied: number; averageElapsedMs: number};
export function summarizeToolJournal(records: ReadonlyArray<ToolCallRecord>): ToolJournalSummary {
  const result: ToolJournalSummary = {total: records.length, running: 0, success: 0, error: 0, denied: 0, averageElapsedMs: 0};
  let duration = 0; let completed = 0;
  for (const record of records) {
    result[record.status]++;
    if (typeof record.elapsedMs === 'number' && Number.isFinite(record.elapsedMs)) {duration += Math.max(0, record.elapsedMs); completed++;}
  }
  result.averageElapsedMs = completed ? Math.round(duration / completed) : 0;
  return result;
}
