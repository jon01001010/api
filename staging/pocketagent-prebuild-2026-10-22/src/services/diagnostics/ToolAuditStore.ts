import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ToolCallRecord} from './ToolCallJournal';
import {exportToolJournal} from './ToolJournalExport';

const KEY = '@pocketagent/audit/v1';
const LIMIT = 200;
let queue: Promise<unknown> = Promise.resolve();
let subscribers = new Set<() => void>();
let live: ToolCallRecord[] = [];
let ready = false;

function sanitize(record: ToolCallRecord): ToolCallRecord {
  return {
    id: Number.isFinite(record.id) ? record.id : 0,
    tool: String(record.tool).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
    startedAt: Number.isFinite(record.startedAt) ? record.startedAt : Date.now(),
    elapsedMs: record.elapsedMs === undefined ? undefined : Math.max(0, record.elapsedMs),
    status: ['running', 'success', 'error', 'denied'].includes(record.status) ? record.status : 'error',
    errorType: record.errorType?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48),
  };
}
function publish() {subscribers.forEach(fn => fn());}
export function subscribeToolAudit(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {subscribers.delete(fn);};
}
export function snapshotToolAudit(): ToolCallRecord[] {
  return live.map(r => ({...r}));
}
export async function loadToolAudit(): Promise<ToolCallRecord[]> {
  if (!ready) {
    const raw = await AsyncStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    live = Array.isArray(data) ? data.slice(-LIMIT).filter(x => x && typeof x === 'object').map(sanitize) : [];
    ready = true;
    publish();
  }
  return snapshotToolAudit();
}
export function recordToolAudit(record: ToolCallRecord): Promise<void> {
  queue = queue.catch(() => {}).then(async () => {
    if (!ready) await loadToolAudit();
    const next = sanitize(record);
    // IDs repeat across runs; retain distinct events by replacing only an active
    // matching entry, otherwise append as a new historical event.
    const index = live.map((r, i) => ({r, i})).reverse().find(({r}) => r.id === next.id && r.tool === next.tool && r.startedAt === next.startedAt && r.status === 'running')?.i ?? -1;
    if (index >= 0) live[index] = next;
    else live.push(next);
    live = live.slice(-LIMIT);
    await AsyncStorage.setItem(KEY, JSON.stringify(live));
    publish();
  });
  return queue as Promise<void>;
}
export function clearToolAudit(): Promise<void> {
  queue = queue.catch(() => {}).then(async () => {
    ready = true;
    live = [];
    await AsyncStorage.removeItem(KEY);
    publish();
  });
  return queue as Promise<void>;
}
export function exportToolAudit(): string {return exportToolJournal(snapshotToolAudit());}
