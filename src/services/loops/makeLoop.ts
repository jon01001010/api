/**
 * "Make a loop" from one sentence (TODO "Ready-made loops": Make a loop,
 * The user chooses how many steps). The user types what they want and picks
 * a detail level; the loaded model drafts a loop as strict JSON; the app
 * validates it (data, never code: SECURITY.md rule 4) and shows it for
 * approval. Nothing runs before the user presses Start, and the model is
 * never given a way to start or change a loop itself.
 *
 * The model's reply is untrusted text: it is only parsed as JSON, every
 * field is checked and clamped to the hard limits in loops.ts, and the user
 * sees (and can edit) the whole prompt before Start. No tools are offered
 * to the model while drafting.
 */
import {
  type BatteryGuard,
  cleanBattery,
  CUSTOM_LOOP_ID,
  cleanCustomPrompt,
  daysOf,
  EVERY_MS,
  type Every,
  type Loop,
  MAX_DAYS,
  MAX_RUNS,
  MAX_CUSTOM_PROMPT,
} from './loops';
import {
  MAX_REPEAT_TIMES,
  newStep,
  type Plan,
  type PlanTools,
  validatePlan,
  DEFAULT_GUARDS,
} from './plan';
import {stopQuietly} from '../../utils/stopQuietly';

export type DetailLevel = 'short' | 'normal' | 'detailed';

/** How many steps each level asks for, and the most it keeps. */
export const DETAIL_LEVELS: Record<
  DetailLevel,
  {label: string; ask: string; max: number}
> = {
  short: {label: 'Short (≈3 steps)', ask: '3', max: 3},
  normal: {label: 'Normal (5–7 steps)', ask: '5 to 7', max: 7},
  detailed: {label: 'Detailed (10–15 steps)', ask: '10 to 15', max: 15},
};

/** Hard maximum of steps in any plan, whatever the level. */
export const MAX_PLAN_STEPS = 20;
export const MAX_SENTENCE = 300;
export const MAX_TITLE = 60;
export const MAX_GOAL = 600;
export const MAX_STEP = 160;
/** Longest reply the model may write for a draft, in tokens. */
export const DRAFT_MAX_TOKENS = 900;
/** The same with a plan's steps (more JSON). */
export const PLAN_DRAFT_MAX_TOKENS = 2000;

export interface LoopDraft {
  title: string;
  /** What each run should do, in the user's words (without the steps). */
  prompt: string;
  every: Every;
  at?: {hour: number; minute: number};
  maxRuns: number;
  days: number;
  steps: string[];
  /** Phone: when it may come due (default: charging or above 20%). */
  battery?: BatteryGuard;
  /**
   * A plan (steps the app runs, plan.ts), when the user asked for one:
   * checked by validatePlan; `notes` say what was dropped and why.
   */
  program?: {plan: Plan; notes: string[]};
}

/** What a plan draft may use: the tools a plan may name, and those on now. */
export interface PlanDraftTools {
  tools: PlanTools;
  on: string[];
}

/** The extra instructions when the user asks for a plan. */
export function planDraftHint(on: string[], level: DetailLevel): string {
  const tools = on.length
    ? on.join(', ')
    : '(none are switched on: do not use use_tool)';
  return (
    '\nAlso add "program": the steps the app itself runs on each check-in, ' +
    `in order (${STEP_FIELD_HINT[level]}). Each step is an object with ` +
    '"name" (short) and "kind", one of exactly: ask_model, use_tool, ' +
    'ask_user, wait, check, repeat, notify, save. Fields per kind:\n' +
    ' ask_model: "prompt" (may use {{step:N}} for the result of an earlier step N)\n' +
    ` use_tool: "tool" (only one of: ${tools}), "args" (object of plain values)\n` +
    ' ask_user: "question", "choices" (2 to 4 short strings)\n' +
    ' wait: "seconds"\n' +
    ' check: "step" (an earlier step number), "test" (contains, not_contains, ' +
    'changed, above, below), "value", "ifNot" ("skip_next" or "end")\n' +
    ` repeat: "count" (how many of the following steps), "times" (at most ${MAX_REPEAT_TIMES})\n` +
    ' notify: "text"\n' +
    ' save: "target" ("memory" or "workspace"), "text", "file" (workspace only, e.g. notes.md)\n' +
    'Optional on any step: "timeLimitSec", "onFail" ("retry", "skip" or "stop"). ' +
    'No other kinds, no code.'
  );
}

/** One line of plain text: no control characters, no braces, trimmed. */
export function cleanLine(text: unknown, max: number): string {
  if (typeof text !== 'string') {
    return '';
  }
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .trim()
  );
}

/** A step as written: one line, no list marker or tick box in front. */
export function cleanStep(text: unknown): string {
  return cleanLine(
    cleanLine(text, MAX_STEP * 2).replace(
      /^(?:(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*)+/,
      '',
    ),
    MAX_STEP,
  );
}

const STEP_FIELD_HINT: Record<DetailLevel, string> = {
  short: 'exactly 3 steps',
  normal: '5 to 7 steps',
  detailed: '10 to 15 steps',
};

/** The messages that ask the model for a draft. */
export function draftMessages(
  sentence: string,
  level: DetailLevel,
  /** A plan was asked for: the tools switched on now. */
  planOn?: string[],
): {role: 'system' | 'user'; content: string}[] {
  const goal = cleanLine(sentence, MAX_SENTENCE);
  return [
    {
      role: 'system',
      content:
        'You plan small recurring check-ins ("loops") for a phone app. ' +
        'Reply with ONE JSON object and nothing else: no prose, no code ' +
        'fences. Fields:\n' +
        '{"title": short name (max 6 words),\n' +
        ' "prompt": one or two sentences saying what each check-in should ' +
        'do, written as the user ("Help me ..."),\n' +
        ' "every": one of "hour", "3hours", "day", "week",\n' +
        ' "at": "HH:MM" (24-hour, only for "day" or "week"),\n' +
        ` "maxRuns": number of check-ins (1 to ${MAX_RUNS}),\n` +
        ` "days": how many days it lasts (1 to ${MAX_DAYS}),\n` +
        ' "steps": list of short, concrete steps as strings, in order}\n' +
        'Steps are things the user does; keep each under 15 words. ' +
        (planOn
          ? `Do not include links you are unsure of, or code.${planDraftHint(planOn, level)}`
          : 'Do not include tool calls, links you are unsure of, or code.'),
    },
    {
      role: 'user',
      content:
        `My goal: ${goal}\n` +
        `Plan it in ${STEP_FIELD_HINT[level]}.` +
        (planOn ? ' Include "program".' : '') +
        ' JSON only.',
    },
  ];
}

/**
 * The first complete JSON object in a reply (ignores reasoning in
 * <think> tags, code fences and any text around it), or undefined.
 */
export function extractJsonObject(text: string): unknown {
  const body = String(text ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
  for (let start = body.indexOf('{'); start >= 0; ) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < body.length; i++) {
      const c = body[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          inString = false;
        }
        continue;
      }
      if (c === '"') {
        inString = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) {
      return undefined;
    }
    try {
      const value = JSON.parse(body.slice(start, end + 1));
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
      }
    } catch {
      // Not JSON: try the next "{".
    }
    start = body.indexOf('{', start + 1);
  }
  return undefined;
}

/** "HH:MM" (or "H:MM") as an hour and minute, or undefined. */
export function parseAt(
  text: unknown,
): {hour: number; minute: number} | undefined {
  if (typeof text !== 'string') {
    return undefined;
  }
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text);
  if (!m) {
    return undefined;
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? {hour, minute} : undefined;
}

const clampInt = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) => {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** Steps as given: cleaned, empty and repeated ones dropped, capped. */
export function cleanSteps(list: unknown, max: number): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const raw =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? ((item as any).step ?? (item as any).title ?? (item as any).text)
          : undefined;
    const step = cleanStep(raw);
    const key = step.toLowerCase();
    if (step && !seen.has(key)) {
      seen.add(key);
      out.push(step);
    }
    if (out.length >= Math.min(max, MAX_PLAN_STEPS)) {
      break;
    }
  }
  return out;
}

/**
 * The model's reply as a draft the user can approve, or a plain error.
 * Every field is checked; anything missing or odd gets a safe default,
 * numbers are clamped to the hard limits, and a draft needs at least one
 * step.
 */
export function parseDraft(
  reply: string,
  level: DetailLevel,
  sentence = '',
  /** A plan was asked for: the tools a plan may name. */
  planTools?: PlanTools,
): {ok: true; draft: LoopDraft} | {ok: false; error: string} {
  const obj = extractJsonObject(reply) as Record<string, unknown> | undefined;
  if (!obj) {
    return {
      ok: false,
      error:
        'The model did not answer with a plan I can read. Try again, or write it yourself.',
    };
  }
  const steps = cleanSteps(obj.steps, DETAIL_LEVELS[level].max);
  let program: LoopDraft['program'];
  if (planTools) {
    const checked = validatePlan(
      {steps: obj.program, guards: DEFAULT_GUARDS},
      planTools,
    );
    if (checked.plan.steps.length === 0) {
      return {
        ok: false,
        error:
          'The plan had no steps the app can run. Try again, or write it yourself.',
      };
    }
    program = checked;
  } else if (steps.length === 0) {
    return {
      ok: false,
      error:
        'The plan had no steps I could use. Try again, or write it yourself.',
    };
  }
  const every: Every =
    typeof obj.every === 'string' && obj.every in EVERY_MS
      ? (obj.every as Every)
      : 'day';
  const at =
    every === 'day' || every === 'week'
      ? (parseAt(obj.at) ?? {hour: 9, minute: 0})
      : undefined;
  const fallbackGoal = cleanLine(sentence, MAX_GOAL);
  return {
    ok: true,
    draft: {
      title:
        cleanLine(obj.title, MAX_TITLE) ||
        cleanLine(sentence, MAX_TITLE) ||
        'My loop',
      prompt:
        cleanLine(obj.prompt, MAX_GOAL) ||
        (fallbackGoal ? `Help me ${fallbackGoal}` : 'Help me with my goal.'),
      every,
      at,
      maxRuns: clampInt(obj.maxRuns, 1, MAX_RUNS, 14),
      days: clampInt(obj.days, 1, MAX_DAYS, 14),
      steps,
      ...(program ? {program} : {}),
    },
  };
}

/** An empty plan draft for "write it myself": one model step to edit. */
export function blankPlanDraft(sentence: string): LoopDraft {
  const draft = blankDraft(sentence);
  return {
    ...draft,
    program: {
      plan: {
        steps: [{...newStep('ask_model'), prompt: draft.prompt}],
        guards: {...DEFAULT_GUARDS},
      },
      notes: [],
    },
  };
}

/** An empty draft for "write it myself". */
export function blankDraft(sentence: string): LoopDraft {
  const goal = cleanLine(sentence, MAX_GOAL);
  return {
    title: cleanLine(sentence, MAX_TITLE) || 'My loop',
    prompt: goal ? `Help me ${goal}` : '',
    every: 'day',
    at: {hour: 9, minute: 0},
    maxRuns: 14,
    days: 14,
    steps: [],
  };
}

/**
 * The loop's prompt: what each run does, plus the steps as a checklist
 * each run continues. This is the whole text the model will get each run;
 * the user sees it before Start.
 */
export function loopPromptOf(draft: LoopDraft): string {
  const steps = cleanSteps(draft.steps, MAX_PLAN_STEPS);
  const goal = cleanLine(draft.prompt, MAX_GOAL);
  const list = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const text = steps.length
    ? `${goal}\n\nThe plan, as a checklist:\n${list}\n\n` +
      'On the first run, show the checklist and start with step 1. On later ' +
      'runs, ask what I got done, tick off finished steps, and help me with ' +
      'the next unfinished one. Do not add or remove steps unless I ask.'
    : goal;
  return text.slice(0, MAX_CUSTOM_PROMPT);
}

/** A loop-shaped preview of a draft, for the plain summary. */
export function previewOf(draft: LoopDraft, now = Date.now()): Loop {
  const maxRuns = clampInt(draft.maxRuns, 1, MAX_RUNS, 14);
  const days = clampInt(draft.days, 1, MAX_DAYS, 14);
  const timed = draft.every === 'day' || draft.every === 'week';
  return {
    id: 'preview',
    templateId: 'custom',
    title: draft.title,
    prompt: loopPromptOf(draft),
    every: draft.every,
    at: timed ? draft.at : undefined,
    nextAt: now,
    runs: 0,
    maxRuns,
    endAt: now + days * EVERY_MS.day,
    paused: false,
    log: [],
    battery: cleanBattery(draft.battery),
  };
}

const CHECKLIST = '\n\nThe plan, as a checklist:\n';

/**
 * A custom loop's goal and steps, to edit them: as saved at Start, or read
 * back from its prompt (loops started before plans were saved). Undefined
 * when the prompt isn't one loopPromptOf made (then the whole prompt is
 * edited as text).
 */
export function planOfLoop(
  loop: Loop,
): {goal: string; steps: string[]} | undefined {
  if (loop.templateId !== CUSTOM_LOOP_ID) {
    return undefined;
  }
  if (loop.plan) {
    return loop.plan;
  }
  const at = loop.prompt.indexOf(CHECKLIST);
  const goal = at < 0 ? loop.prompt : loop.prompt.slice(0, at);
  const steps =
    at < 0
      ? []
      : loop.prompt
          .slice(at + CHECKLIST.length)
          .split('\n\n')[0]
          .split('\n')
          .map(l => l.replace(/^\d+\.\s*/, ''));
  const plan = {goal, steps};
  return loopPromptOf({...blankDraft(''), prompt: goal, steps}) === loop.prompt
    ? plan
    : undefined;
}

/** A running loop as a draft for the editor (Edit on its card). */
export function draftOfLoop(loop: Loop, now = Date.now()): LoopDraft {
  const plan = planOfLoop(loop);
  return {
    title: loop.title,
    prompt: plan ? plan.goal : loop.prompt,
    every: loop.every,
    at: loop.at,
    maxRuns: loop.maxRuns,
    days: daysOf(loop, now),
    steps: plan ? plan.steps : [],
    battery: cleanBattery(loop.battery),
  };
}

/** The prompt an edited draft gives: from the plan, or the text as is. */
export function editedPromptOf(draft: LoopDraft, withSteps: boolean): string {
  return withSteps ? loopPromptOf(draft) : cleanCustomPrompt(draft.prompt);
}

// ---------------------------------------------------------- asking the model

let current: {abort(): void} | null = null;

/** Stops a draft being written (the user pressed Cancel). */
export function cancelDraft(): void {
  current?.abort();
}

/**
 * Asks the loaded model (local or remote, through the same generation
 * lease the chat uses) for a draft. One completion, no tools, no thinking.
 */
export async function draftLoop(
  sentence: string,
  level: DetailLevel,
  /** Draft a plan (steps the app runs) too. */
  plan?: PlanDraftTools,
): Promise<{ok: true; draft: LoopDraft} | {ok: false; error: string}> {
  const goal = cleanLine(sentence, MAX_SENTENCE);
  if (!goal) {
    return {ok: false, error: 'Say what you want in one sentence'};
  }
  const {modelStore} = require('../../store');
  if (modelStore.activeModelId === undefined) {
    return {ok: false, error: 'Load a model first'};
  }
  if (modelStore.isGenerationBusy) {
    return {
      ok: false,
      error: 'The model is busy; try again when this reply is done',
    };
  }
  const lease = await modelStore.acquireGeneration();
  if (!lease) {
    return {ok: false, error: 'Load a model first'};
  }
  const onAbort = () => stopQuietly(() => lease.engine.stopCompletion());
  lease.signal.addEventListener('abort', onAbort, {once: true});
  current = lease;
  try {
    const result = await lease.engine.completion({
      messages: draftMessages(goal, level, plan?.on),
      n_predict: plan ? PLAN_DRAFT_MAX_TOKENS : DRAFT_MAX_TOKENS,
      temperature: 0.3,
      jinja: true,
      enable_thinking: false,
    } as any);
    if (lease.signal.aborted) {
      return {ok: false, error: 'Cancelled'};
    }
    return parseDraft(
      String(result?.content || result?.text || ''),
      level,
      goal,
      plan?.tools,
    );
  } catch (error) {
    if (lease.signal.aborted) {
      return {ok: false, error: 'Cancelled'};
    }
    console.warn('[makeLoop] draft failed', error);
    return {
      ok: false,
      error:
        'The model could not write a plan. Try again, or write it yourself.',
    };
  } finally {
    lease.signal.removeEventListener('abort', onAbort);
    lease.end();
    current = null;
  }
}
