/**
 * Loops shared as a QR code, a file or a pasted code (TODO.md "Ready-made
 * loops": sharing). Only the loop's definition travels: its name, what
 * each run does (the goal and steps, or the prompt), how often, the limits
 * and the battery guard. Never its runs, log, chat or fingerprints.
 *
 * A code is data only: unpacking never runs anything. The receiver sees
 * the whole loop (every step, the schedule, the limits, the dry run); it is
 * installed paused and not started, with the same hard limits as any loop
 * (clamped), and the user presses Start on its card.
 *
 * Format: `PA1:L:1:<form>:<body>`, packed like a tool (toolQr.ts): form `z`
 * is the JSON deflated (raw) then base64, form `j` the plain JSON.
 */
import {
  LOOP_TAG,
  MAX_CODE_CHARS,
  packPayload,
  readPayload,
} from '../talents/toolQr';

import {
  addLog,
  buildLoop,
  CUSTOM_LOOP_ID,
  daysOf,
  EVERY_MS,
  loadLoops,
  MAX_CUSTOM_PROMPT,
  MAX_LOOPS,
  saveLoops,
  type Every,
  type Loop,
} from './loops';
import {
  blankDraft,
  cleanLine,
  cleanSteps,
  loopPromptOf,
  MAX_GOAL,
  MAX_PLAN_STEPS,
  MAX_TITLE,
  planOfLoop,
} from './makeLoop';

export {LOOP_TAG};
export const LOOP_CODE_VERSION = '1';
/** Largest loop JSON accepted after unpacking. */
export const MAX_LOOP_BYTES = 12 * 1024;

const PREFIX = `${LOOP_TAG}${LOOP_CODE_VERSION}:`;

/** What travels: the definition only. */
export interface SharedLoop {
  title: string;
  /** With a plan: what each run should do, and the checklist. */
  goal?: string;
  steps?: string[];
  /** Without a plan: the whole prompt each run gets. */
  prompt?: string;
  every: Every;
  at?: {hour: number; minute: number};
  maxRuns: number;
  days: number;
  battery?: Loop['battery'];
}

/** The parts of a loop that travel (no runs, log, chat id or progress). */
export function shareableLoop(loop: Loop, now = Date.now()): SharedLoop {
  const plan = planOfLoop(loop);
  return {
    title: loop.title,
    ...(plan && plan.steps.length
      ? {goal: plan.goal, steps: plan.steps}
      : {prompt: loop.prompt}),
    every: loop.every,
    ...(loop.at ? {at: {hour: loop.at.hour, minute: loop.at.minute}} : {}),
    maxRuns: loop.maxRuns,
    days: daysOf(loop, now),
    ...(loop.battery ? {battery: loop.battery} : {}),
  };
}

/** A loop → its share code (`PA1:L:1:z:…` or `PA1:L:1:j:…`, the shorter). */
export function packLoop(loop: Loop, now = Date.now()): string {
  return packPayload(PREFIX, JSON.stringify(shareableLoop(loop, now)));
}

export type LoopReview = {ok: true; loop: Loop} | {ok: false; error: string};

const fail = (error: string): LoopReview => ({ok: false, error});

/**
 * A pasted or scanned code → the loop it would install (not saved): built
 * like any loop (same cleaning and hard limits, clamped), paused and not
 * started. Never runs anything.
 */
export function reviewLoopCode(code: string, now = Date.now()): LoopReview {
  const text = (code ?? '').trim();
  if (!text.startsWith(LOOP_TAG)) {
    return fail('This is not a PocketAgent loop code.');
  }
  if (text.length > MAX_CODE_CHARS) {
    return fail('This code is too long for a loop.');
  }
  const m = /^PA1:L:(\d+):([a-z]):([\s\S]*)$/.exec(text);
  if (!m) {
    return fail('This loop code is damaged.');
  }
  if (m[1] !== LOOP_CODE_VERSION) {
    return fail(
      'This loop code is from a newer PocketAgent. Update the app to read it.',
    );
  }
  const read = readPayload(m[2], m[3], MAX_LOOP_BYTES);
  if (!read.ok) {
    return fail(
      read.why === 'too_big'
        ? 'This loop is too big.'
        : read.why === 'form'
          ? 'This loop code uses a form this app does not know.'
          : 'This loop code is damaged or the loop is too big.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.json);
  } catch {
    return fail('This loop code is damaged.');
  }
  return loopFromShared(parsed, now);
}

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** A shared definition (any shape) → the loop to install, or why not. */
export function loopFromShared(v: unknown, now = Date.now()): LoopReview {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return fail('This code does not hold a loop.');
  }
  const d = v as Record<string, unknown>;
  const title = cleanLine(d.title, MAX_TITLE);
  if (!title) {
    return fail('This loop has no name.');
  }
  // With steps, the prompt is made here from the goal and steps (exactly
  // what is shown); a prompt that came along is not used.
  const steps = cleanSteps(d.steps, MAX_PLAN_STEPS);
  const goal = cleanLine(d.goal, MAX_GOAL);
  const withPlan = steps.length > 0 && !!goal;
  const prompt = withPlan
    ? loopPromptOf({...blankDraft(''), prompt: goal, steps})
    : typeof d.prompt === 'string'
      ? d.prompt.slice(0, MAX_CUSTOM_PROMPT * 2)
      : typeof d.goal === 'string'
        ? goal
        : '';
  const every = (
    typeof d.every === 'string' && d.every in EVERY_MS ? d.every : 'day'
  ) as Every;
  const at =
    d.at && typeof d.at === 'object'
      ? (d.at as {hour: number; minute: number})
      : undefined;
  const timed = every === 'day' || every === 'week';
  const built = buildLoop({
    templateId: CUSTOM_LOOP_ID,
    values: {},
    custom: {
      title,
      prompt,
      ...(withPlan ? {plan: {goal, steps}} : {}),
    },
    every,
    at: timed ? (at ?? {hour: 9, minute: 0}) : undefined,
    maxRuns: num(d.maxRuns, 14),
    days: num(d.days, 14),
    battery: d.battery as Loop['battery'],
    now,
  });
  if (!built.ok) {
    return fail(`This loop can't be installed: ${built.error}.`);
  }
  const loop: Loop = {
    ...built.loop,
    // A daily or weekly loop whose time didn't come through intact gets
    // 09:00 (buildLoop drops a bad time).
    at: timed ? (built.loop.at ?? {hour: 9, minute: 0}) : undefined,
    paused: true,
    notStarted: true,
    log: [],
  };
  return {
    ok: true,
    loop: addLog(loop, 'Installed from a shared code (not started)', now),
  };
}

/**
 * Saves a reviewed loop, paused and not started. Nothing runs: the user
 * presses Start on its card. Returns the saved loop or why not.
 */
export async function installSharedLoop(loop: Loop): Promise<Loop | string> {
  const loops = await loadLoops();
  if (loops.length >= MAX_LOOPS) {
    return `At most ${MAX_LOOPS} loops; stop one first`;
  }
  const saved: Loop = {
    ...loop,
    paused: true,
    notStarted: true,
    runs: 0,
    sessionId: undefined,
    progress: undefined,
    pausedWhy: undefined,
  };
  loops.push(saved);
  await saveLoops(loops);
  return saved;
}

/** The file name a shared loop is saved as. */
export const loopCodeFilename = (title: string) =>
  `${title.replace(/[^\w -]+/g, '').trim() || 'loop'}.pocketagent-loop.txt`;
