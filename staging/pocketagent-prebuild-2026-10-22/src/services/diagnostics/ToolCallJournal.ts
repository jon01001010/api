/** Bounded in-memory tool-call diagnostics. No secrets or raw arguments stored.
 * Wire recordStart/recordEnd at the central tool dispatcher; not wired yet.
 */
export type ToolCallRecord = {
  id: number;
  tool: string;
  startedAt: number;
  elapsedMs?: number;
  status: 'running' | 'success' | 'error' | 'denied';
  errorType?: string;
};

export class ToolCallJournal {
  private records: ToolCallRecord[] = [];
  private nextId = 1;
  constructor(private readonly capacity = 100) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid journal capacity');
  }
  start(tool: string, now = Date.now()): number {
    const id = this.nextId++;
    this.records.push({id, tool: tool.slice(0, 80), startedAt: now, status: 'running'});
    if (this.records.length > this.capacity) this.records.shift();
    return id;
  }
  finish(id: number, status: 'success' | 'error' | 'denied', errorType?: string, now = Date.now()): void {
    const record = this.records.find(entry => entry.id === id);
    if (!record || record.status !== 'running') return;
    record.elapsedMs = Math.max(0, now - record.startedAt);
    record.status = status;
    // Avoid arbitrary error messages: may contain credentials or user data.
    if (errorType && status !== 'success') record.errorType = errorType.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  }
  snapshot(): ToolCallRecord[] { return this.records.map(entry => ({...entry})); }
  clear(): void { this.records = []; }
}
