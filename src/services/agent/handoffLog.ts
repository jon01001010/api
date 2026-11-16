/**
 * The hand-off log (ask_other_model, subAgent.ts): one entry per hand-off
 * the model asked for, allowed or not: when, which model, where it runs,
 * the size sent and the size of the answer, and the outcome. Never the
 * text itself. Kept on this device only, the newest MAX_ENTRIES; shown in
 * the Toolbox.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const HANDOFF_LOG_KEY = '@pocketagent/handoffs/log/v1';
export const MAX_ENTRIES = 200;

export type HandoffOutcome =
  | 'answered'
  | 'refused'
  | 'stopped'
  | 'failed'
  | 'timed_out'
  // A fallback chain moved on from this model (ask_model_chain).
  | 'ran_out'
  // Unticked in the question of ask_models: nothing sent to it.
  | 'unticked';

export interface HandoffLogEntry {
  at: number;
  model: string;
  where: string;
  outcome: HandoffOutcome;
  /** Characters sent (0 when nothing was sent). */
  sentChars: number;
  /** Characters of the answer (0 when none). */
  resultChars: number;
  /** Tokens, when the server said (else estimated). */
  tokens?: number;
  /** Why, for refused / stopped / failed. */
  note?: string;
}

const isEntry = (e: any): e is HandoffLogEntry =>
  e &&
  typeof e.at === 'number' &&
  typeof e.model === 'string' &&
  typeof e.where === 'string' &&
  typeof e.outcome === 'string' &&
  typeof e.sentChars === 'number' &&
  typeof e.resultChars === 'number';

/** The log, newest first; empty when missing or unreadable. */
export async function readHandoffLog(): Promise<HandoffLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(HANDOFF_LOG_KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter(isEntry) : [];
  } catch {
    return [];
  }
}

let writing: Promise<void> = Promise.resolve();

/** Adds one entry (in order; never throws). */
export function logHandoff(entry: HandoffLogEntry): Promise<void> {
  const clean: HandoffLogEntry = {
    ...entry,
    model: entry.model.slice(0, 120),
    where: entry.where.slice(0, 120),
    ...(entry.note ? {note: entry.note.slice(0, 200)} : {}),
  };
  writing = writing.then(async () => {
    try {
      const list = await readHandoffLog();
      await AsyncStorage.setItem(
        HANDOFF_LOG_KEY,
        JSON.stringify([clean, ...list].slice(0, MAX_ENTRIES)),
      );
    } catch (error) {
      console.warn('[handoffs] could not log', error);
    }
  });
  return writing;
}

/** One line for the Toolbox: "15 Nov 14:02 · Claude … · answered · 1,200 → 3,400 characters". */
export function handoffLine(e: HandoffLogEntry): string {
  const when = new Date(e.at).toLocaleString();
  const sizes =
    e.sentChars > 0
      ? ` · ${e.sentChars} → ${e.resultChars} characters`
      : ' · nothing sent';
  return `${when} · ${e.model} (${e.where}) · ${e.outcome}${sizes}${e.note ? ` · ${e.note}` : ''}`;
}
