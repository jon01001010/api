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
/** A loop made from one sentence ("Make a loop", makeLoop.ts). */
export const CUSTOM_LOOP_ID = 'custom';
export const MAX_CUSTOM_PROMPT = 4000;
const MAX_CUSTOM_TITLE = 60;

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
  /** When the user pressed Start (days are counted from here). */
  startedAt?: number;
  /** Phone only: when it may come due (default: charging or above 20%). */
  battery?: BatteryGuard;
  /** Custom loops: what each run does and the checklist, as approved. */
  plan?: {goal: string; steps: string[]};
  /** Fingerprints of the last run's reply (no-progress stop). */
  progress?: {steps: string; reply: string};
  /** Why it paused by itself (shown on the card); none if the user paused. */
  pausedWhy?: string;
}

/**
 * Battery guard (phone): when a loop is due and the guard isn't met, the
 * app doesn't ask; it logs "Waiting: battery" and looks again later. The
 * desktop has no battery guard (always OK).
 */
export type BatteryGuard =
  | {kind: 'above'; percent: number}
  | {kind: 'charger'}
  | {kind: 'any'};
export const DEFAULT_BATTERY: BatteryGuard = {kind: 'above', percent: 20};
/** How long a loop waits before the battery is looked at again. */
export const BATTERY_WAIT_MS = 30 * 60_000;
export const WAITING_BATTERY = 'Waiting: battery';

/** The phone's battery: level 0–1 (below 0: unknown), and charging. */
export interface BatteryState {
  level: number;
  charging: boolean;
}

/** A guard as saved: anything odd becomes the default. */
export function cleanBattery(guard: unknown): BatteryGuard {
  const g = guard as any;
  if (g?.kind === 'charger' || g?.kind === 'any') {
    return {kind: g.kind};
  }
  if (g?.kind === 'above' && Number.isFinite(g.percent)) {
    return {
      kind: 'above',
      percent: Math.min(95, Math.max(5, Math.round(g.percent))),
    };
  }
  return DEFAULT_BATTERY;
}

/** Whether the guard is met (no battery reading, e.g. desktop: yes). */
export function batteryOk(
  guard: BatteryGuard | undefined,
  state: BatteryState | undefined,
): boolean {
  const g = cleanBattery(guard);
  if (!state || g.kind === 'any' || state.charging) {
    return true;
  }
  if (g.kind === 'charger') {
    return false;
  }
  if (!Number.isFinite(state.level) || state.level < 0) {
    return true;
  }
  return Math.round(state.level * 100) >= g.percent;
}

export function batteryText(guard: BatteryGuard | undefined): string {
  const g = cleanBattery(guard);
  if (g.kind === 'charger') {
    return 'Only on the charger';
  }
  if (g.kind === 'any') {
    return 'Any battery level';
  }
  return `Only when charging or battery above ${g.percent}%`;
}

/** Due, but the battery guard isn't met: look again later, quietly. */
export function waitForBattery(loop: Loop, now = Date.now()): Loop {
  const next = {...loop, nextAt: now + BATTERY_WAIT_MS};
  // One log line while it waits, not one every half hour.
  if (loop.log[0]?.what === WAITING_BATTERY) {
    return {
      ...next,
      log: [{at: now, what: WAITING_BATTERY}, ...loop.log.slice(1)],
    };
  }
  return addLog(next, WAITING_BATTERY, now);
}

/** Two runs in a row with the same next steps (or reply): pause. */
export const NO_PROGRESS_WHY = 'no progress for 2 runs';

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** A short fingerprint of a text (the reply itself is not stored). */
export function fingerprint(text: string): string {
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = (a * 33 + c) % 2147483647;
    b = (b * 31 + c) % 1000000007;
  }
  return `${a.toString(36)}${b.toString(36)}:${text.length}`;
}

/**
 * After a run's reply is complete: compares it with the last run's. Same
 * next steps (when it had any), or the very same reply, twice in a row →
 * the loop pauses and says why. An empty reply (stopped) is not counted.
 */
export function afterReply(loop: Loop, reply: string, now = Date.now()): Loop {
  const text = norm(String(reply ?? ''));
  if (!text) {
    return loop;
  }
  const steps = nextStepsOf(String(reply)).map(norm).join('\n');
  const progress = {
    steps: steps ? fingerprint(steps) : '',
    reply: fingerprint(text),
  };
  const prev = loop.progress;
  const same =
    !!prev &&
    ((progress.steps !== '' && progress.steps === prev.steps) ||
      progress.reply === prev.reply);
  if (same && !loop.paused) {
    return addLog(
      {...loop, progress, paused: true, pausedWhy: NO_PROGRESS_WHY},
      `Paused: ${NO_PROGRESS_WHY}`,
      now,
    );
  }
  return {...loop, progress};
}

/** Pause or resume by the user (resuming forgets the last fingerprint). */
export function togglePause(loop: Loop, now = Date.now()): Loop {
  return loop.paused
    ? addLog(
        {...loop, paused: false, pausedWhy: undefined, progress: undefined},
        'Resumed',
        now,
      )
    : addLog({...loop, paused: true, pausedWhy: undefined}, 'Paused', now);
}

/**
 * The reply to a message the app sent (messages newest first): the newest
 * non-user, non-system message above the newest user message, if that user
 * message is the one sent. Otherwise undefined.
 */
export function replyTo(
  messages: any[],
  sent: string,
  userId: string,
  textOf: (m: any) => string,
): string | undefined {
  const i = messages.findIndex(m => m?.author?.id === userId);
  if (i < 0 || textOf(messages[i]) !== sent) {
    return undefined;
  }
  const reply = messages
    .slice(0, i)
    .find(m => m?.author?.id !== userId && !m?.metadata?.system);
  return reply ? textOf(reply) : undefined;
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

/** A custom loop's prompt as the user approved it: plain text, capped. */
export function cleanCustomPrompt(text: string): string {
  return (
    String(text ?? '')
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_CUSTOM_PROMPT)
      .trim()
  );
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
    `changes itself. Phone: ${batteryText(loop.battery).toLowerCase()}. ` +
    'Pauses if two runs in a row bring nothing new.'
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
    `next steps I can tap, one per line, each under ${MAX_STEP_CHARS} characters.`
  );
}

/**
 * Longest next step offered as a button: its whole text fits on the chip
 * (shown in full, never cut), so a tap never sends words the user didn't
 * see. Longer ones are not offered.
 */
export const MAX_STEP_CHARS = 80;

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
    .filter(l => l.length > 0 && l.length <= MAX_STEP_CHARS)
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
  // Every change (start, run, skip, later, pause, stop) moves the phone's
  // "loop due" notifications to match (loopNotify.ts).
  await require('./loopNotify').syncLoopAlarms(loops);
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

export interface LoopInput {
  templateId: string;
  values: Record<string, string>;
  /** For templateId 'custom' only. */
  custom?: {
    title: string;
    prompt: string;
    plan?: {goal: string; steps: string[]};
  };
  every: Every;
  at?: {hour: number; minute: number};
  maxRuns: number;
  days: number;
  battery?: BatteryGuard;
  now?: number;
}

/** What a custom loop may use, in plain words (dry run). */
export const CUSTOM_USES =
  'The model, and only the tools you have switched on in the Toolbox.';

const cleanAt = (at: Loop['at']): Loop['at'] =>
  at &&
  Number.isInteger(at.hour) &&
  at.hour >= 0 &&
  at.hour < 24 &&
  Number.isInteger(at.minute) &&
  at.minute >= 0 &&
  at.minute < 60
    ? {hour: at.hour, minute: at.minute}
    : undefined;

const cleanPlan = (plan: Loop['plan']): Loop['plan'] =>
  plan && typeof plan.goal === 'string' && Array.isArray(plan.steps)
    ? {
        goal: plan.goal,
        steps: plan.steps.filter(x => typeof x === 'string').slice(0, 20),
      }
    : undefined;

/**
 * The loop Start would make, without saving it (also the dry run's
 * preview). A ready-made loop names its template and blanks; a custom one
 * (templateId 'custom') brings the title and prompt the user saw and
 * approved. Same limits for both.
 */
export function buildLoop(
  input: LoopInput,
): {ok: true; loop: Loop} | {ok: false; error: string} {
  let made: {id: string; title: string; prompt: string};
  if (input.templateId === CUSTOM_LOOP_ID) {
    const title = cleanBlank(input.custom?.title ?? '').slice(
      0,
      MAX_CUSTOM_TITLE,
    );
    const prompt = cleanCustomPrompt(input.custom?.prompt ?? '');
    if (!title) {
      return {ok: false, error: 'Give the loop a name'};
    }
    if (!prompt) {
      return {ok: false, error: 'Say what each run should do'};
    }
    made = {id: CUSTOM_LOOP_ID, title, prompt};
  } else {
    const template = LOOP_TEMPLATES.find(t => t.id === input.templateId);
    if (!template) {
      return {ok: false, error: 'Unknown loop'};
    }
    const filled = fillTemplate(template, input.values);
    if (!filled.ok) {
      return filled;
    }
    made = {id: template.id, title: template.title, prompt: filled.prompt};
  }
  const now = input.now ?? Date.now();
  const at = cleanAt(input.at);
  const every = input.every in EVERY_MS ? input.every : 'day';
  const plan =
    made.id === CUSTOM_LOOP_ID ? cleanPlan(input.custom?.plan) : undefined;
  return {
    ok: true,
    loop: {
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      templateId: made.id,
      title: made.title,
      prompt: made.prompt,
      every,
      at,
      nextAt: firstRun(every, at, now),
      runs: 0,
      maxRuns: Math.min(MAX_RUNS, Math.max(1, Math.round(input.maxRuns))),
      endAt:
        now +
        Math.min(MAX_DAYS, Math.max(1, Math.round(input.days))) * EVERY_MS.day,
      paused: false,
      log: [{at: now, what: 'Started'}],
      startedAt: now,
      battery: cleanBattery(input.battery),
      ...(plan ? {plan} : {}),
    },
  };
}

/**
 * The user pressed "Looks right, start" (after the dry run). Only the
 * user's screens call this.
 */
export async function startLoop(
  input: LoopInput,
): Promise<{ok: true; loop: Loop} | {ok: false; error: string}> {
  const built = buildLoop(input);
  if (!built.ok) {
    return built;
  }
  const loops = await loadLoops();
  if (loops.length >= MAX_LOOPS) {
    return {ok: false, error: `At most ${MAX_LOOPS} loops; stop one first`};
  }
  loops.push(built.loop);
  await saveLoops(loops);
  return built;
}

/** The next few run times (dry run), within the loop's limits. */
export function upcomingRuns(loop: Loop, count = 3): number[] {
  const out: number[] = [];
  let t = loop.nextAt;
  let left = loop.maxRuns - loop.runs;
  while (left > 0 && out.length < count && t <= loop.endAt) {
    out.push(t);
    t += EVERY_MS[loop.every];
    left--;
  }
  return out;
}

/**
 * The dry run before Start: exactly what the first run's message will be,
 * when runs happen, the limits and guards, and what it may use. Pure: it
 * sends nothing and runs nothing.
 */
export function dryRunOf(
  loop: Loop,
  uses: string,
): {message: string; times: number[]; limits: string[]; uses: string} {
  return {
    message: runMessage(loop),
    times: upcomingRuns(loop, 3),
    limits: [
      `At most ${loop.maxRuns} runs, until ${new Date(
        loop.endAt,
      ).toLocaleDateString()} (hard limits: ${MAX_RUNS} runs, ${MAX_DAYS} days).`,
      'Asks before each run: Skip, Later or Run now.',
      `Phone: ${batteryText(loop.battery).toLowerCase()}; otherwise it waits.`,
      'Pauses if two runs in a row bring nothing new.',
    ],
    uses: `${uses} Anything outside the app still asks.`,
  };
}

/** When the loop was started (older loops: their oldest log line). */
export function startOf(loop: Loop, now = Date.now()): number {
  if (typeof loop.startedAt === 'number' && Number.isFinite(loop.startedAt)) {
    return loop.startedAt;
  }
  return loop.log.reduce((min, e) => Math.min(min, e.at), now);
}

/** How many days the loop lasts, counted from its start. */
export function daysOf(loop: Loop, now = Date.now()): number {
  return Math.max(
    1,
    Math.round((loop.endAt - startOf(loop, now)) / EVERY_MS.day),
  );
}

/** What the user changed in Edit. */
export interface LoopEdit {
  title: string;
  /** The whole prompt each run gets (custom loops: built from the plan). */
  prompt: string;
  plan?: {goal: string; steps: string[]};
  every: Every;
  at?: {hour: number; minute: number};
  maxRuns: number;
  days: number;
  battery?: BatteryGuard;
}

/**
 * A running loop as the user edited it, within the hard limits. Keeps runs
 * so far, its chat and log; a new schedule moves the next time; logs
 * "Edited". Days still count from the start (never past MAX_DAYS), and runs
 * can't go below the runs already done.
 */
export function editLoop(
  loop: Loop,
  edit: LoopEdit,
  now = Date.now(),
): {ok: true; loop: Loop} | {ok: false; error: string} {
  const title = cleanBlank(edit.title ?? '').slice(0, MAX_CUSTOM_TITLE);
  const prompt = cleanCustomPrompt(edit.prompt ?? '');
  if (!title) {
    return {ok: false, error: 'Give the loop a name'};
  }
  if (!prompt) {
    return {ok: false, error: 'Say what each run should do'};
  }
  const every = edit.every in EVERY_MS ? edit.every : loop.every;
  const timed = every === 'day' || every === 'week';
  const at = timed ? cleanAt(edit.at) : undefined;
  if (timed && !at) {
    return {ok: false, error: 'Time as HH:MM, e.g. 07:30'};
  }
  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(edit.days) || 1));
  const startedAt = startOf(loop, now);
  const endAt = startedAt + days * EVERY_MS.day;
  if (endAt <= now) {
    return {ok: false, error: 'Choose more days: that end is already past'};
  }
  const maxRuns = Math.min(
    MAX_RUNS,
    Math.max(1, loop.runs, Math.round(edit.maxRuns) || 1),
  );
  const sameSchedule =
    every === loop.every &&
    at?.hour === loop.at?.hour &&
    at?.minute === loop.at?.minute;
  let nextAt = loop.nextAt;
  if (!sameSchedule) {
    nextAt = timed
      ? firstRun(every, at, now)
      : loop.runs > 0
        ? now + EVERY_MS[every]
        : now;
  }
  const newPrompt = prompt !== loop.prompt;
  const plan =
    loop.templateId === CUSTOM_LOOP_ID
      ? (cleanPlan(edit.plan) ?? (newPrompt ? undefined : loop.plan))
      : undefined;
  return {
    ok: true,
    loop: addLog(
      {
        ...loop,
        title,
        prompt,
        every,
        at,
        nextAt,
        maxRuns,
        endAt,
        startedAt,
        battery: cleanBattery(edit.battery ?? loop.battery),
        plan,
        // A new prompt starts afresh for the no-progress check.
        progress: newPrompt ? undefined : loop.progress,
      },
      'Edited',
      now,
    ),
  };
}

/** Saves the user's edit of a running loop (and moves its alarm). */
export async function saveLoopEdit(
  id: string,
  edit: LoopEdit,
  now = Date.now(),
): Promise<{ok: true; loop: Loop} | {ok: false; error: string}> {
  const loops = await loadLoops();
  const i = loops.findIndex(l => l.id === id);
  if (i < 0) {
    return {ok: false, error: 'That loop was stopped'};
  }
  const r = editLoop(loops[i], edit, now);
  if (!r.ok) {
    return r;
  }
  loops[i] = r.loop;
  await saveLoops(loops);
  return r;
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
