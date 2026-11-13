/**
 * Ready-made loops (TODO "Ready-made loops", first slice 2026-11-13): pick
 * one, fill in the blanks, choose how often; when it is due the app asks
 * "Run now?" and runs it as a message in the loop's own chat, so the usual
 * rules hold (each tool behind its Toolbox switch, anything outside the app
 * asks). Each run ends with 1–3 next steps, shown as buttons under the reply.
 *
 * A loop is data, never code: a fixed prompt with the user's blanks filled
 * in as plain text, a schedule and limits. The model never edits a loop; it
 * can't start, reschedule or change one. Nothing runs without a tap.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {LOOP_TEMPLATES, type LoopTemplate} from './loopTemplates';

export type Every = 'hour' | '3hours' | 'day' | 'week';
export const EVERY_MS: Record<Every, number> = {
  hour: 3600_000,
  '3hours': 3 * 3600_000,
  day: 24 * 3600_000,
  week: 7 * 24 * 3600_000,
};
export const EVERY_LABEL: Record<Every, string> = {
  hour: 'every hour',
  '3hours': 'every 3 hours',
  day: 'every day',
  week: 'every week',
};

/** Hard limits (only the user changes a loop; these cap even that). */
export const MAX_RUNS = 60;
export const MAX_DAYS = 60;
export const MAX_LOOPS = 10;
const MAX_BLANK = 200;

export interface Loop {
  id: string;
  templateId: string;
  title: string;
  /** The template's prompt with the blanks filled in. */
  prompt: string;
  every: Every;
  /** For daily / weekly loops: hour and minute of the run. */
  at?: {hour: number; minute: number};
  nextAt: number;
  runs: number;
  maxRuns: number;
  endAt: number;
  paused: boolean;
  /** The loop's own chat, made at its first run. */
  sessionId?: string;
  log: {at: number; what: string}[];
}

const KEY = '@pocketagent/loops/v1';

/** A blank as typed: plain, short, one line. */
export function cleanBlank(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[{}]/g, '')
    .trim()
    .slice(0, MAX_BLANK);
}

/** The template's prompt with each {{blank}} filled in (all required). */
export function fillTemplate(
  template: LoopTemplate,
  values: Record<string, string>,
): {ok: true; prompt: string} | {ok: false; error: string} {
  for (const b of template.blanks) {
    if (!cleanBlank(values[b.key] ?? '')) {
      return {ok: false, error: `Fill in "${b.label}"`};
    }
  }
  // One pass over the template only: what the user typed is never read as
  // a blank itself.
  const prompt = template.prompt.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    cleanBlank(values[key] ?? ''),
  );
  return {ok: true, prompt};
}

/** The first run time at or after `from`. */
export function firstRun(every: Every, at: Loop['at'], from: number): number {
  if ((every === 'day' || every === 'week') && at) {
    const d = new Date(from);
    d.setHours(at.hour, at.minute, 0, 0);
    if (d.getTime() < from) {
      d.setDate(d.getDate() + 1);
    }
    return d.getTime();
  }
  return from;
}

/** The next run after one at `last` (never sooner than its interval). */
export function nextRun(loop: Loop, last: number): number {
  let next = loop.nextAt + EVERY_MS[loop.every];
  while (next <= last) {
    next += EVERY_MS[loop.every];
  }
  return next;
}

export function isFinished(loop: Loop, now = Date.now()): boolean {
  return loop.runs >= loop.maxRuns || now > loop.endAt;
}

/** The plain summary shown before Start and on the loop's card. */
export function summary(loop: Loop): string {
  const time = loop.at
    ? ` at ${String(loop.at.hour).padStart(2, '0')}:${String(
        loop.at.minute,
      ).padStart(2, '0')}`
    : '';
  const days = Math.max(
    1,
    Math.round((loop.endAt - (loop.nextAt || Date.now())) / EVERY_MS.day),
  );
  return (
    `Comes back ${EVERY_LABEL[loop.every]}${time}, at most ${loop.maxRuns} times, ` +
    `for up to ${days} day(s). Asks before each run. Uses only the tools ` +
    'you have switched on; anything outside the app still asks. Never ' +
    'changes itself.'
  );
}

/** The message sent for one run. */
export function runMessage(loop: Loop): string {
  const n = loop.runs + 1;
  const intro =
    n === 1
      ? `This is the first run of my loop "${loop.title}".`
      : `This is run ${n} of my loop "${loop.title}". Carry on from earlier in this chat.`;
  return (
    `${intro}\n\n${loop.prompt}\n\n` +
    'Keep it short. End with a line "Next steps:" and then 1 to 3 short ' +
    'next steps I can tap, one per line.'
  );
}

/** The 1–3 next steps at the end of a reply (none if it has none). */
export function nextStepsOf(text: string): string[] {
  const m = /next steps?\s*:?\**\s*\n([\s\S]*)$/i.exec(text || '');
  if (!m) {
    return [];
  }
  return m[1]
    .split('\n')
    .map(l =>
      l
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
        .replace(/\*\*/g, '')
        .trim(),
    )
    .filter(l => l.length > 0 && l.length <= 120)
    .slice(0, 3);
}

// ------------------------------------------------------------ saved loops

export async function loadLoops(): Promise<Loop[]> {
  try {
    const list = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
    return Array.isArray(list) ? list.filter(isLoop) : [];
  } catch {
    return [];
  }
}

function isLoop(l: any): l is Loop {
  return (
    l &&
    typeof l.id === 'string' &&
    typeof l.prompt === 'string' &&
    l.every in EVERY_MS &&
    Number.isFinite(l.nextAt) &&
    Number.isFinite(l.runs) &&
    Number.isFinite(l.maxRuns) &&
    Number.isFinite(l.endAt) &&
    Array.isArray(l.log)
  );
}

export async function saveLoops(loops: Loop[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(loops));
}

export async function updateLoop(
  id: string,
  change: (l: Loop) => Loop,
): Promise<Loop | undefined> {
  const loops = await loadLoops();
  const i = loops.findIndex(l => l.id === id);
  if (i < 0) {
    return undefined;
  }
  loops[i] = change(loops[i]);
  await saveLoops(loops);
  return loops[i];
}

export async function startLoop(input: {
  templateId: string;
  values: Record<string, string>;
  every: Every;
  at?: {hour: number; minute: number};
  maxRuns: number;
  days: number;
  now?: number;
}): Promise<{ok: true; loop: Loop} | {ok: false; error: string}> {
  const template = LOOP_TEMPLATES.find(t => t.id === input.templateId);
  if (!template) {
    return {ok: false, error: 'Unknown loop'};
  }
  const filled = fillTemplate(template, input.values);
  if (!filled.ok) {
    return filled;
  }
  const loops = await loadLoops();
  if (loops.length >= MAX_LOOPS) {
    return {ok: false, error: `At most ${MAX_LOOPS} loops; stop one first`};
  }
  const now = input.now ?? Date.now();
  const at =
    input.at &&
    Number.isInteger(input.at.hour) &&
    input.at.hour >= 0 &&
    input.at.hour < 24 &&
    Number.isInteger(input.at.minute) &&
    input.at.minute >= 0 &&
    input.at.minute < 60
      ? input.at
      : undefined;
  const loop: Loop = {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    templateId: template.id,
    title: template.title,
    prompt: filled.prompt,
    every: input.every in EVERY_MS ? input.every : 'day',
    at,
    nextAt: firstRun(input.every, at, now),
    runs: 0,
    maxRuns: Math.min(MAX_RUNS, Math.max(1, Math.round(input.maxRuns))),
    endAt:
      now +
      Math.min(MAX_DAYS, Math.max(1, Math.round(input.days))) * EVERY_MS.day,
    paused: false,
    log: [{at: now, what: 'Started'}],
  };
  loops.push(loop);
  await saveLoops(loops);
  return {ok: true, loop};
}

export async function stopLoop(id: string): Promise<void> {
  await saveLoops((await loadLoops()).filter(l => l.id !== id));
}

/** The loop a chat belongs to, if any. */
export async function loopOfSession(
  sessionId: string | undefined,
): Promise<Loop | undefined> {
  if (!sessionId) {
    return undefined;
  }
  return (await loadLoops()).find(l => l.sessionId === sessionId);
}

/** Loops due now (not paused or finished). */
export function dueLoops(loops: Loop[], now = Date.now()): Loop[] {
  return loops.filter(l => !l.paused && !isFinished(l, now) && l.nextAt <= now);
}

export function addLog(loop: Loop, what: string, at = Date.now()): Loop {
  return {...loop, log: [{at, what}, ...loop.log].slice(0, 30)};
}
