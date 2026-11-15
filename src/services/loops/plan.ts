/**
 * Plans as a program (TODO.md "Agentic planning: the plan is a program"): a
 * loop can be a list of steps that a fixed runner in the app runs one by
 * one (planRunner.ts). A plan is data, never code (SECURITY.md rule 4):
 * the runner knows a short, fixed list of step kinds; the model can't add
 * kinds, and a step is only ever read as the fields below.
 *
 * This file: the step kinds, the strict validator (anything unknown is
 * dropped with a note), filling in `{{step:N}}` as plain text, checks,
 * moving / removing steps (references follow), and the dry run (pure: it
 * calls nothing).
 */
import {fingerprint} from './loops';

export const STEP_KINDS = [
  'ask_model',
  'use_tool',
  'ask_user',
  'wait',
  'check',
  'repeat',
  'notify',
  'save',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const KIND_LABEL: Record<StepKind, string> = {
  ask_model: 'Ask the model',
  use_tool: 'Use a tool',
  ask_user: 'Ask me',
  wait: 'Wait',
  check: 'Check',
  repeat: 'Repeat',
  notify: 'Notify me',
  save: 'Save',
};

export type OnFail = 'retry' | 'skip' | 'stop';
export const ON_FAIL_LABEL: Record<OnFail, string> = {
  retry: 'Retry once',
  skip: 'Skip',
  stop: 'Stop and ask',
};
export type CheckTest =
  | 'contains'
  | 'not_contains'
  | 'changed'
  | 'above'
  | 'below';
export const CHECK_TESTS: CheckTest[] = [
  'contains',
  'not_contains',
  'changed',
  'above',
  'below',
];
export const CHECK_LABEL: Record<CheckTest, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  changed: 'changed since the last run',
  above: 'has a number above',
  below: 'has a number below',
};
export type IfNot = 'skip_next' | 'end';

export type ArgValue = string | number | boolean;

export interface PlanStep {
  /** A name the user can read. */
  name: string;
  kind: StepKind;
  /** Seconds the step may take (not used by wait / ask me / repeat). */
  timeLimitSec: number;
  onFail: OnFail;
  /** ask_model: the prompt; `{{step:N}}` = the result of step N. */
  prompt?: string;
  /** use_tool: a built-in tool, switched on in the Toolbox. */
  tool?: string;
  args?: Record<string, ArgValue>;
  /** ask_user: a question and 2–4 choices (buttons). */
  question?: string;
  choices?: string[];
  /** wait: how long. */
  seconds?: number;
  /** check: which earlier step (1-based), the test and its value. */
  ref?: number;
  test?: CheckTest;
  value?: string;
  /** check: when it isn't true, skip the next step or end (the repeat or the run). */
  ifNot?: IfNot;
  /** repeat: the next `count` steps, up to `times` rounds. */
  count?: number;
  times?: number;
  /** notify / save: the text (`{{step:N}}` allowed). */
  text?: string;
  /** save: where (asks first, through the tool's own approval). */
  target?: 'memory' | 'workspace';
  /** save to workspace: a plain file name (.md or .txt). */
  file?: string;
}

/** Per-run guards (only the user raises them, up to GUARD_CAPS). */
export interface PlanGuards {
  maxSteps: number;
  maxMinutes: number;
  maxModelCalls: number;
  maxToolCalls: number;
}
export const DEFAULT_GUARDS: PlanGuards = {
  maxSteps: 50,
  maxMinutes: 10,
  maxModelCalls: 10,
  maxToolCalls: 10,
};
export const GUARD_CAPS: PlanGuards = {
  maxSteps: 500,
  maxMinutes: 120,
  maxModelCalls: 100,
  maxToolCalls: 100,
};
export const GUARD_LABEL: Record<keyof PlanGuards, string> = {
  maxSteps: 'Steps per run',
  maxMinutes: 'Minutes per run (working time)',
  maxModelCalls: 'Model calls per run',
  maxToolCalls: 'Tool calls per run',
};

export interface Plan {
  steps: PlanStep[];
  guards: PlanGuards;
}

export const MAX_PLAN_STEPS = 20;
export const MAX_REPEAT_TIMES = 10;
export const MAX_WAIT_SEC = 24 * 3600;
export const MAX_NAME = 60;
export const MAX_PROMPT = 1500;
export const MAX_QUESTION = 200;
export const MAX_CHOICE = 40;
export const MAX_TEXT = 2000;
export const MAX_VALUE = 200;
export const MAX_ARG = 1000;
export const MAX_ARGS = 8;
export const MIN_TIME_LIMIT = 5;
export const MAX_TIME_LIMIT = 600;
/** Longest result kept per step (and filled into later steps). */
export const MAX_RESULT = 2000;

/**
 * Built-in tools a plan may never use: they change tools themselves
 * (runaway stop: a plan can't edit its own tools). Custom tools are not
 * built-in, so they are never offered either.
 */
export const FORBIDDEN_PLAN_TOOLS = ['tool_save', 'tool_delete'];

/** The built-in tools a plan may name, each with its argument names. */
export type PlanTools = Record<string, string[]>;

const DEFAULT_LIMIT: Record<StepKind, number> = {
  ask_model: 120,
  use_tool: 120,
  ask_user: 0,
  wait: 0,
  check: 10,
  repeat: 0,
  notify: 10,
  save: 120,
};

// ------------------------------------------------------------ plain text

/** One line: no control characters or braces except `{{step:N}}`. */
export function cleanOneLine(text: unknown, max: number): string {
  if (typeof text !== 'string') {
    return '';
  }
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
      .trim()
  );
}

/** Text that may keep line breaks (prompts, notes to save). */
export function cleanText(text: unknown, max: number): string {
  if (typeof text !== 'string') {
    return '';
  }
  return (
    text
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, max)
      .trim()
  );
}

const toInt = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.round(n)
    : undefined;
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,58}\.(md|txt)$/;
export const DEFAULT_SAVE_FILE = 'plan-notes.md';

/** A workspace file name for a save step: plain, .md or .txt, no folders. */
export function cleanFileName(name: unknown): string | undefined {
  const n = cleanOneLine(name, 64);
  return FILE_NAME.test(n) && !n.includes('..') ? n : undefined;
}

// ------------------------------------------------------------ references

const REF = /\{\{\s*step\s*:\s*(\d{1,3})\s*\}\}/gi;

/** The step numbers a text refers to. */
export function refsIn(text: string | undefined): number[] {
  const out: number[] = [];
  for (const m of String(text ?? '').matchAll(REF)) {
    out.push(Number(m[1]));
  }
  return out;
}

/**
 * Fills `{{step:N}}` with step N's result, as plain text. One pass over the
 * step's own text: a result is never read again, so a result that itself
 * says `{{step:2}}` stays as those characters.
 */
export function fillRefs(
  text: string | undefined,
  results: Record<string, string>,
): string {
  return String(text ?? '').replace(REF, (_, n) => {
    const r = results[String(Number(n))];
    return r === undefined ? '(no result yet)' : r.slice(0, MAX_RESULT);
  });
}

/** Text fields of a step that may hold references. */
const TEXT_FIELDS = ['prompt', 'question', 'text'] as const;

/**
 * The step with its references renumbered (`map(old)` gives the new
 * number, or undefined when that step is gone: then "(removed step)").
 */
function renumberStep(
  step: PlanStep,
  map: (n: number) => number | undefined,
): PlanStep {
  const fix = (t: string) =>
    t.replace(REF, (_, n) => {
      const to = map(Number(n));
      return to === undefined ? '(removed step)' : `{{step:${to}}}`;
    });
  const out: PlanStep = {...step};
  for (const f of TEXT_FIELDS) {
    if (typeof out[f] === 'string') {
      out[f] = fix(out[f] as string);
    }
  }
  if (out.args) {
    out.args = Object.fromEntries(
      Object.entries(out.args).map(([k, v]) => [
        k,
        typeof v === 'string' ? fix(v) : v,
      ]),
    );
  }
  if (out.ref !== undefined) {
    out.ref = map(out.ref);
  }
  return out;
}

/** Moves step i to j; references to steps follow them. */
export function moveStep(steps: PlanStep[], i: number, j: number): PlanStep[] {
  if (i < 0 || j < 0 || i >= steps.length || j >= steps.length || i === j) {
    return steps;
  }
  const order = steps.map((_, k) => k);
  const [moved] = order.splice(i, 1);
  order.splice(j, 0, moved);
  const newNumber = new Map(order.map((old, k) => [old + 1, k + 1]));
  return order.map(old =>
    renumberStep(steps[old], n => newNumber.get(n) ?? undefined),
  );
}

/** Removes step i; later references shift, references to it are cleared. */
export function removeStep(steps: PlanStep[], i: number): PlanStep[] {
  return steps
    .filter((_, k) => k !== i)
    .map(s =>
      renumberStep(s, n => (n === i + 1 ? undefined : n > i + 1 ? n - 1 : n)),
    );
}

/** A new step of a kind, with plain defaults (the editor's "Add step"). */
export function newStep(kind: StepKind): PlanStep {
  const base = {
    name: KIND_LABEL[kind],
    kind,
    timeLimitSec: DEFAULT_LIMIT[kind],
    onFail: 'stop' as OnFail,
  };
  switch (kind) {
    case 'ask_model':
      return {...base, prompt: ''};
    case 'use_tool':
      return {...base, tool: '', args: {}};
    case 'ask_user':
      return {...base, question: '', choices: ['Yes', 'No']};
    case 'wait':
      return {...base, seconds: 60};
    case 'check':
      return {...base, ref: 1, test: 'contains', value: '', ifNot: 'skip_next'};
    case 'repeat':
      return {...base, count: 1, times: 3};
    case 'notify':
      return {...base, text: ''};
    case 'save':
      return {...base, target: 'memory', text: ''};
  }
}

// ------------------------------------------------------------ validator

export interface Checked {
  plan: Plan;
  /** Plain notes on what was dropped or changed. */
  notes: string[];
}

export function cleanGuards(raw: unknown): PlanGuards {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const out = {...DEFAULT_GUARDS};
  for (const key of Object.keys(DEFAULT_GUARDS) as (keyof PlanGuards)[]) {
    const n = toInt(g[key]);
    if (n !== undefined) {
      out[key] = clamp(n, 1, GUARD_CAPS[key]);
    }
  }
  return out;
}

/**
 * One raw step as a PlanStep, or why it was dropped. References are still
 * in the raw numbering; `number` is this step's raw number (1-based).
 */
function checkStep(
  raw: unknown,
  number: number,
  tools: PlanTools,
): {step: PlanStep; notes: string[]} | {error: string} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {error: 'not a step'};
  }
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (
    typeof kind !== 'string' ||
    !(STEP_KINDS as readonly string[]).includes(kind)
  ) {
    return {
      error: `unknown kind "${cleanOneLine(String(kind ?? ''), 30)}" (only: ${STEP_KINDS.join(', ')})`,
    };
  }
  const k = kind as StepKind;
  const notes: string[] = [];
  const limit = toInt(r.timeLimitSec);
  const step: PlanStep = {
    name: cleanOneLine(r.name, MAX_NAME) || KIND_LABEL[k],
    kind: k,
    timeLimitSec:
      DEFAULT_LIMIT[k] === 0
        ? 0
        : clamp(limit ?? DEFAULT_LIMIT[k], MIN_TIME_LIMIT, MAX_TIME_LIMIT),
    onFail:
      r.onFail === 'retry' || r.onFail === 'skip' || r.onFail === 'stop'
        ? r.onFail
        : 'stop',
  };
  switch (k) {
    case 'ask_model': {
      step.prompt = cleanText(r.prompt, MAX_PROMPT);
      if (!step.prompt) {
        return {error: 'asks the model nothing'};
      }
      break;
    }
    case 'use_tool': {
      const tool = typeof r.tool === 'string' ? r.tool.trim() : '';
      if (FORBIDDEN_PLAN_TOOLS.includes(tool)) {
        return {error: `"${tool}" changes tools; a plan can't use it`};
      }
      if (!Object.prototype.hasOwnProperty.call(tools, tool)) {
        return {
          error: `"${cleanOneLine(tool, 40)}" isn't a built-in tool a plan can use`,
        };
      }
      step.tool = tool;
      step.args = {};
      const known = tools[tool];
      const args =
        r.args && typeof r.args === 'object' && !Array.isArray(r.args)
          ? (r.args as Record<string, unknown>)
          : {};
      for (const [key, value] of Object.entries(args)) {
        if (Object.keys(step.args).length >= MAX_ARGS) {
          notes.push(`more than ${MAX_ARGS} inputs; the rest dropped`);
          break;
        }
        if (!known.includes(key)) {
          notes.push(
            `input "${cleanOneLine(key, 30)}" isn't one ${tool} takes; dropped`,
          );
          continue;
        }
        if (typeof value === 'string') {
          step.args[key] = cleanText(value, MAX_ARG);
        } else if (typeof value === 'number' && Number.isFinite(value)) {
          step.args[key] = value;
        } else if (typeof value === 'boolean') {
          step.args[key] = value;
        } else {
          notes.push(
            `input "${key}" isn't plain text, a number or yes/no; dropped`,
          );
        }
      }
      break;
    }
    case 'ask_user': {
      step.question = cleanOneLine(r.question, MAX_QUESTION);
      const seen = new Set<string>();
      const choices: string[] = [];
      for (const c of Array.isArray(r.choices) ? r.choices : []) {
        const t = cleanOneLine(c, MAX_CHOICE);
        if (t && !seen.has(t.toLowerCase())) {
          seen.add(t.toLowerCase());
          choices.push(t);
        }
      }
      if (!step.question) {
        return {error: 'asks no question'};
      }
      if (choices.length < 2) {
        return {error: 'needs 2 to 4 choices'};
      }
      if (choices.length > 4) {
        notes.push('more than 4 choices; kept the first 4');
      }
      step.choices = choices.slice(0, 4);
      break;
    }
    case 'wait': {
      const s = toInt(r.seconds);
      if (s === undefined || s < 1) {
        return {error: 'waits no time'};
      }
      if (s > MAX_WAIT_SEC) {
        notes.push('wait cut to 24 hours');
      }
      step.seconds = clamp(s, 1, MAX_WAIT_SEC);
      break;
    }
    case 'check': {
      const ref = toInt(r.ref ?? r.step);
      if (ref === undefined || ref < 1 || ref >= number) {
        return {error: 'checks no earlier step'};
      }
      const test = r.test as CheckTest;
      if (!CHECK_TESTS.includes(test)) {
        return {error: 'unknown check'};
      }
      step.ref = ref;
      step.test = test;
      if (test === 'above' || test === 'below') {
        const v = typeof r.value === 'number' ? r.value : Number(r.value);
        if (!Number.isFinite(v)) {
          return {error: 'needs a number to compare with'};
        }
        step.value = String(v);
      } else if (test === 'contains' || test === 'not_contains') {
        step.value = cleanOneLine(r.value, MAX_VALUE);
        if (!step.value) {
          return {error: 'needs words to look for'};
        }
      }
      step.ifNot = r.ifNot === 'end' ? 'end' : 'skip_next';
      break;
    }
    case 'repeat': {
      const count = toInt(r.count);
      const times = toInt(r.times);
      if (
        count === undefined ||
        count < 1 ||
        times === undefined ||
        times < 1
      ) {
        return {error: 'repeats nothing'};
      }
      if (times > MAX_REPEAT_TIMES) {
        notes.push(`repeat cut to ${MAX_REPEAT_TIMES} times`);
      }
      step.count = count;
      step.times = clamp(times, 1, MAX_REPEAT_TIMES);
      break;
    }
    case 'notify': {
      step.text = cleanOneLine(r.text, 300);
      if (!step.text) {
        return {error: 'says nothing'};
      }
      break;
    }
    case 'save': {
      step.target = r.target === 'workspace' ? 'workspace' : 'memory';
      step.text = cleanText(r.text, MAX_TEXT);
      if (!step.text) {
        return {error: 'saves nothing'};
      }
      if (step.target === 'workspace') {
        const file =
          r.file === undefined ? DEFAULT_SAVE_FILE : cleanFileName(r.file);
        if (!file) {
          return {error: 'needs a plain file name ending in .md or .txt'};
        }
        step.file = file;
      }
      break;
    }
  }
  return {step, notes};
}

/**
 * A plan from untrusted data (the model's draft, a saved copy, the editor),
 * checked strictly: only the fixed step kinds and their fields; a tool must
 * be one of `tools` (built-in, never tool_save / tool_delete); unknown or
 * empty steps are dropped with a note, numbers clamped, at most 20 steps.
 * References follow the steps kept; a reference to a dropped or later step
 * becomes "(removed step)" (a check on one is dropped). A repeat covers
 * only the steps kept after it, never another repeat.
 */
export function validatePlan(raw: unknown, tools: PlanTools): Checked {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(r.steps)
      ? r.steps
      : [];
  const notes: string[] = [];
  if (list.length > MAX_PLAN_STEPS) {
    notes.push(
      `More than ${MAX_PLAN_STEPS} steps; kept the first ${MAX_PLAN_STEPS}.`,
    );
  }
  // Pass 1: each step on its own.
  const kept = new Map<number, PlanStep>();
  list.slice(0, MAX_PLAN_STEPS).forEach((item, i) => {
    const c = checkStep(item, i + 1, tools);
    if ('error' in c) {
      notes.push(`Step ${i + 1} dropped: ${c.error}.`);
    } else {
      kept.set(i + 1, c.step);
      for (const n of c.notes) {
        notes.push(`Step ${i + 1}: ${n}.`);
      }
    }
  });
  // Pass 2: checks on a dropped step go too (until nothing changes).
  for (let changed = true; changed; ) {
    changed = false;
    for (const [n, s] of kept) {
      if (s.kind === 'check' && !kept.has(s.ref ?? 0)) {
        kept.delete(n);
        notes.push(`Step ${n} dropped: the step it checks was dropped.`);
        changed = true;
      }
    }
  }
  // Pass 3: repeat blocks over the steps kept, never holding a repeat.
  const numbers = [...kept.keys()];
  for (const n of numbers) {
    const s = kept.get(n);
    if (!s || s.kind !== 'repeat') {
      continue;
    }
    const inside = numbers.filter(
      m => m > n && m <= n + (s.count ?? 0) && kept.has(m),
    );
    const stop = inside.findIndex(m => kept.get(m)?.kind === 'repeat');
    const body = stop < 0 ? inside : inside.slice(0, stop);
    if (stop >= 0) {
      notes.push(
        `Step ${n}: a repeat can't hold another repeat; its block ends before step ${inside[stop]}.`,
      );
    }
    if (!body.length) {
      kept.delete(n);
      notes.push(`Step ${n} dropped: nothing left to repeat.`);
    } else {
      kept.set(n, {...s, count: body.length});
    }
  }
  // Pass 4: renumber references to the steps kept.
  const order = [...kept.keys()].sort((a, b) => a - b);
  const newNumber = new Map(order.map((old, i) => [old, i + 1]));
  const steps = order.map((old, i) => {
    const s = renumberStep(kept.get(old)!, n =>
      n < old ? newNumber.get(n) : undefined,
    );
    for (const f of TEXT_FIELDS) {
      if (
        /\(removed step\)/.test(s[f] ?? '') &&
        !/\(removed step\)/.test((kept.get(old)![f] as string) ?? '')
      ) {
        notes.push(
          `Step ${i + 1}: refers to a step that isn't before it; that part will be empty.`,
        );
        break;
      }
    }
    return s;
  });
  return {plan: {steps, guards: cleanGuards(r.guards)}, notes};
}

// ------------------------------------------------------------ checks

/** The first number in a text (also "1,5" or "1.5"), if any. */
export function firstNumber(text: string): number | undefined {
  const m = /-?\d+(?:[.,]\d+)?/.exec(text);
  return m ? Number(m[0].replace(',', '.')) : undefined;
}

/**
 * A check on an earlier step's result. `previous`: that step's result
 * fingerprint from the last run (for "changed"; none = changed).
 */
export function evalCheck(
  step: PlanStep,
  results: Record<string, string>,
  previous?: Record<string, string>,
): boolean {
  const result = results[String(step.ref)] ?? '';
  const value = step.value ?? '';
  switch (step.test) {
    case 'contains':
      return result.toLowerCase().includes(value.toLowerCase());
    case 'not_contains':
      return !result.toLowerCase().includes(value.toLowerCase());
    case 'changed': {
      const before = previous?.[String(step.ref)];
      return before === undefined || before !== fingerprint(result);
    }
    case 'above':
    case 'below': {
      const n = firstNumber(result);
      const v = Number(value);
      if (n === undefined || !Number.isFinite(v)) {
        return false;
      }
      return step.test === 'above' ? n > v : n < v;
    }
    default:
      return false;
  }
}

// ------------------------------------------------------------ plain words

export function durationText(sec: number): string {
  if (sec % 3600 === 0) {
    return `${sec / 3600} hour${sec === 3600 ? '' : 's'}`;
  }
  if (sec % 60 === 0) {
    return `${sec / 60} minute${sec === 60 ? '' : 's'}`;
  }
  return `${sec} second${sec === 1 ? '' : 's'}`;
}

const quote = (t: string | undefined, max = 120) => {
  const s = String(t ?? '');
  return `"${s.length > max ? `${s.slice(0, max - 1)}…` : s}"`;
};

/** What a step does, in one plain line. */
export function describeStep(step: PlanStep, n: number): string {
  switch (step.kind) {
    case 'ask_model':
      return `Asks the model: ${quote(step.prompt)}`;
    case 'use_tool':
      return `Uses the tool ${step.tool} with ${JSON.stringify(step.args ?? {})}`;
    case 'ask_user':
      return `Asks you: ${quote(step.question)} [${(step.choices ?? []).join(' / ')}]`;
    case 'wait':
      return `Waits ${durationText(step.seconds ?? 0)}`;
    case 'check':
      return (
        `Checks whether step ${step.ref}'s result ${CHECK_LABEL[step.test ?? 'contains']}` +
        (step.test === 'changed' ? '' : ` ${quote(step.value, 40)}`) +
        (step.ifNot === 'end'
          ? '; if not, it ends here (or ends the repeat)'
          : '; if not, it skips the next step')
      );
    case 'repeat': {
      const last = n + (step.count ?? 1);
      return `Repeats step${step.count === 1 ? ` ${n + 1}` : `s ${n + 1}–${last}`} up to ${step.times} times`;
    }
    case 'notify':
      return `Shows you: ${quote(step.text)}`;
    case 'save':
      return step.target === 'workspace'
        ? `Asks to add to ${step.file ?? DEFAULT_SAVE_FILE} in the workspace: ${quote(step.text)}`
        : `Asks to add to memory: ${quote(step.text)}`;
  }
}

/** The plan as a numbered list (the loop's description on its card). */
export function planText(plan: Plan): string {
  return plan.steps
    .map((s, i) => `${i + 1}. ${s.name}: ${describeStep(s, i + 1)}`)
    .join('\n');
}

// ------------------------------------------------------------ dry run

export interface DryRunLine {
  n: number;
  name: string;
  kind: StepKind;
  what: string;
  /** In a repeat: how many rounds it may run. */
  rounds: number;
  /** Something that would stop it or ask (a switch off, an approval). */
  warn?: string;
}

export interface PlanDryRun {
  lines: DryRunLine[];
  /** The questions it would ask you, in order. */
  questions: string[];
  /** The most it could do in one run (repeats counted in full). */
  most: {steps: number; model: number; tools: number};
  /** Guards it would hit at the most. */
  guardNotes: string[];
}

/** The tool calls a step makes (save to memory reads then writes). */
const toolCallsOf = (s: PlanStep) =>
  s.kind === 'use_tool'
    ? 1
    : s.kind === 'save'
      ? s.target === 'memory'
        ? 2
        : 1
      : 0;

/** Tools a save step needs switched on. */
export function saveTools(s: PlanStep): string[] {
  return s.target === 'workspace'
    ? ['file_append', 'file_create']
    : ['memory_get', 'memory_replace'];
}

/**
 * Walks the plan without doing anything: no model, no tools, nothing
 * outside the app. Shows what each step would do, the questions it would
 * ask, the most it could use and which guard that would hit. `on`: the
 * tools switched on in the Toolbox now.
 */
export function dryRunPlan(plan: Plan, on: string[]): PlanDryRun {
  const lines: DryRunLine[] = [];
  const questions: string[] = [];
  const most = {steps: 0, model: 0, tools: 0};
  let blockEnd = -1;
  let rounds = 1;
  plan.steps.forEach((s, i) => {
    if (i > blockEnd) {
      rounds = 1;
    }
    let warn: string | undefined;
    if (s.kind === 'use_tool' && !on.includes(s.tool ?? '')) {
      warn = `${s.tool} is switched off in the Toolbox: this step would fail.`;
    } else if (s.kind === 'use_tool') {
      warn = 'Switched on. If the tool asks before it acts, it still asks.';
    } else if (s.kind === 'save') {
      const missing = saveTools(s).filter(t => !on.includes(t));
      warn =
        s.target === 'workspace'
          ? missing.length === 2
            ? 'File tools are switched off in the Toolbox: this step would fail.'
            : 'It asks you before anything is saved.'
          : missing.length
            ? `${missing.join(' and ')} switched off in the Toolbox: this step would fail.`
            : 'It asks you before anything is saved.';
    } else if (s.kind === 'ask_model') {
      warn = 'Earlier results are filled in as plain text when it runs.';
    }
    lines.push({
      n: i + 1,
      name: s.name,
      kind: s.kind,
      what: describeStep(s, i + 1),
      rounds,
      ...(warn ? {warn} : {}),
    });
    if (s.kind === 'ask_user') {
      questions.push(`${s.question} [${(s.choices ?? []).join(' / ')}]`);
    }
    most.steps += rounds;
    most.model += s.kind === 'ask_model' ? rounds : 0;
    most.tools += toolCallsOf(s) * rounds;
    if (s.kind === 'repeat') {
      blockEnd = i + (s.count ?? 0);
      rounds = s.times ?? 1;
    }
  });
  const g = plan.guards;
  const guardNotes: string[] = [];
  if (most.steps > g.maxSteps) {
    guardNotes.push(
      `At the most it runs ${most.steps} steps: it would pause at ${g.maxSteps} and ask.`,
    );
  }
  if (most.model > g.maxModelCalls) {
    guardNotes.push(
      `At the most it asks the model ${most.model} times: it would pause at ${g.maxModelCalls} and ask.`,
    );
  }
  if (most.tools > g.maxToolCalls) {
    guardNotes.push(
      `At the most it uses tools ${most.tools} times: it would pause at ${g.maxToolCalls} and ask.`,
    );
  }
  return {lines, questions, most, guardNotes};
}
