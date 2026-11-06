/**
 * Custom tools, made by the user (Toolbox) or by a model (tool_save, after
 * the user approves). Two kinds, neither runs code nor reaches the network:
 *
 * - instructions: a named how-to; calling it returns the stored text.
 * - shortcut: a short list of steps using built-in tools, with {{fill-ins}}
 *   for values given at each call. The user approves the whole run once (all
 *   steps shown); phone actions then run without asking again.
 *
 * Saved tools are registered with the talent registry so the model can call
 * them, but like every tool they are off until switched on in Toolbox.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {requestFileApproval} from './fileApprovalGate';
import {talentRegistry} from './TalentRegistry';
import type {
  TalentEngine,
  TalentExecuteContext,
  TalentResult,
  ToolDefinition,
} from './types';

export interface ShortcutStep {
  tool: string;
  args: Record<string, unknown>;
}

export type CustomTool =
  | {
      kind: 'instructions';
      name: string;
      description: string;
      instructions: string;
      createdBy: 'user' | 'model';
    }
  | {
      kind: 'shortcut';
      name: string;
      description: string;
      steps: ShortcutStep[];
      createdBy: 'user' | 'model';
    };

const STORAGE_KEY = '@pocketagent/custom-tools/v1';
export const MAX_STEPS = 8;
const MAX_INSTRUCTIONS = 8000;

/** Tools a shortcut may not use: no tool-making, no nesting. */
const NOT_IN_SHORTCUTS = new Set(['tool_save', 'tool_delete']);

/**
 * Phone steps that leave PocketAgent's screen. Android stops a background app
 * from opening more apps or asking, so one of these may only be the last step.
 * (Timers and alarms stay in the background inside a shortcut.)
 */
const OPENS_ANOTHER_APP = new Set([
  'show_timers',
  'show_alarms',
  'open_app',
  'navigate_to',
  'play_music',
  'open_camera',
  'open_settings',
  'add_reminder',
  'compose_message',
  'share_text',
  'search_in_app',
]);

const NAME = /^[a-z][a-z0-9_]{2,39}$/;
const FILL_IN = /\{\{\s*([a-z][a-z0-9_]{0,30})\s*\}\}/gi;

/** The fill-in names a shortcut's steps use, in order of first use. */
export function fillInsOf(steps: ShortcutStep[]): string[] {
  const names: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(FILL_IN)) {
        const n = m[1].toLowerCase();
        if (!names.includes(n)) {
          names.push(n);
        }
      }
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  steps.forEach(s => walk(s.args));
  return names;
}

/** Step arguments with each {{fill-in}} replaced by the value given. */
export function fillIn(v: unknown, values: Record<string, unknown>): unknown {
  if (typeof v === 'string') {
    return v.replace(FILL_IN, (_m, n: string) => {
      const value = values[n.toLowerCase()];
      return value === undefined || value === null ? '' : String(value);
    });
  }
  if (Array.isArray(v)) {
    return v.map(x => fillIn(x, values));
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, fillIn(x, values)]),
    );
  }
  return v;
}

/** Names of the built-in tools (everything registered that isn't custom). */
export function builtInToolNames(): string[] {
  return talentRegistry
    .getAll()
    .filter(e => !(e instanceof CustomToolEngine))
    .map(e => e.name);
}

/**
 * A checked, tidied copy of a tool definition, or why it can't be saved.
 * `replacing` is the name of the tool being edited, if any.
 */
export function checkCustomTool(
  input: unknown,
  opts: {builtIns: string[]; existing: string[]; replacing?: string},
): CustomTool | string {
  const t = (input ?? {}) as Record<string, unknown>;
  const name = typeof t.name === 'string' ? t.name.trim().toLowerCase() : '';
  if (!NAME.test(name)) {
    return 'The name must be 3-40 characters: lowercase letters, digits and _, starting with a letter (e.g. morning_routine).';
  }
  if (opts.builtIns.includes(name)) {
    return `"${name}" is a built-in tool's name. Choose another.`;
  }
  if (name !== opts.replacing && opts.existing.includes(name)) {
    return `A custom tool called "${name}" already exists. Choose another name, or edit that one.`;
  }
  const description =
    typeof t.description === 'string' ? t.description.trim().slice(0, 500) : '';
  if (!description) {
    return 'Give a short `description`: when the model should use this tool.';
  }
  const createdBy = t.createdBy === 'model' ? 'model' : 'user';
  if (t.kind === 'instructions') {
    const instructions =
      typeof t.instructions === 'string' ? t.instructions.trim() : '';
    if (!instructions) {
      return 'Saved instructions need the `instructions` text.';
    }
    if (instructions.length > MAX_INSTRUCTIONS) {
      return `The instructions are too long (at most ${MAX_INSTRUCTIONS} characters).`;
    }
    return {kind: 'instructions', name, description, instructions, createdBy};
  }
  if (t.kind === 'shortcut') {
    const raw = Array.isArray(t.steps) ? t.steps : [];
    if (!raw.length || raw.length > MAX_STEPS) {
      return `A shortcut needs 1 to ${MAX_STEPS} steps.`;
    }
    const steps: ShortcutStep[] = [];
    for (const [i, step] of raw.entries()) {
      const s = (step ?? {}) as Record<string, unknown>;
      const tool = typeof s.tool === 'string' ? s.tool.trim() : '';
      if (!opts.builtIns.includes(tool) || NOT_IN_SHORTCUTS.has(tool)) {
        return `Step ${i + 1}: "${tool}" is not a built-in tool a shortcut can use.`;
      }
      const args =
        s.args && typeof s.args === 'object' && !Array.isArray(s.args)
          ? (s.args as Record<string, unknown>)
          : {};
      steps.push({tool, args});
    }
    const leaving = steps.findIndex(s => OPENS_ANOTHER_APP.has(s.tool));
    if (leaving !== -1 && leaving !== steps.length - 1) {
      return `Step ${leaving + 1} (${steps[leaving].tool}) opens another app, which stops the steps after it. Put it last; only one step may open another app.`;
    }
    return {kind: 'shortcut', name, description, steps, createdBy};
  }
  return '`kind` must be "instructions" or "shortcut".';
}

/** The definition in plain words, for approval dialogs and the Toolbox. */
export function describeCustomTool(tool: CustomTool): string {
  if (tool.kind === 'instructions') {
    return `Saved instructions "${tool.name}": ${tool.description}\n\n${tool.instructions}`;
  }
  const fills = fillInsOf(tool.steps);
  const lines = tool.steps.map(
    (s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args)}`,
  );
  return (
    `Shortcut "${tool.name}": ${tool.description}\n` +
    (fills.length ? `Fill-ins: ${fills.join(', ')}\n` : '') +
    lines.join('\n')
  );
}

export class CustomToolEngine implements TalentEngine {
  readonly name: string;
  constructor(readonly tool: CustomTool) {
    this.name = tool.name;
  }

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const tool = this.tool;
    if (tool.kind === 'instructions') {
      return {type: 'text', summary: tool.instructions};
    }
    const values = Object.fromEntries(
      Object.entries(args ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const missing = fillInsOf(tool.steps).filter(
      n => values[n] === undefined || String(values[n]).trim() === '',
    );
    if (missing.length) {
      return {
        type: 'error',
        summary: `${tool.name}: give ${missing.map(m => `\`${m}\``).join(', ')}.`,
        errorMessage: `missing ${missing.join(', ')}`,
      };
    }
    const steps = tool.steps.map(s => ({
      tool: s.tool,
      args: fillIn(s.args, values) as Record<string, unknown>,
    }));
    // One approval for the whole run, every step shown exactly.
    const approved = await requestFileApproval(
      {
        action: 'phone_action',
        filename: `Run the "${tool.name}" shortcut (${steps.length} step${steps.length > 1 ? 's' : ''})?`,
        content: steps
          .map((s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.args)}`)
          .join('\n'),
      },
      ctx?.signal,
    );
    if (!approved || ctx?.signal?.aborted) {
      return {
        type: 'text',
        summary: `The user said no to the "${tool.name}" shortcut. Nothing was done.`,
      };
    }
    const done: string[] = [];
    for (const [i, step] of steps.entries()) {
      const engine = talentRegistry.get(step.tool);
      if (!engine || engine instanceof CustomToolEngine) {
        return stopped(tool.name, i, step.tool, 'is no longer available', done);
      }
      const result = await engine.execute(step.args, {
        signal: ctx?.signal ?? new AbortController().signal,
        inApprovedShortcut: true,
      });
      if (result.type === 'error' || /said no|Not done/.test(result.summary)) {
        return stopped(tool.name, i, step.tool, result.summary, done);
      }
      done.push(`${i + 1}. ${step.tool}: ${result.summary}`);
    }
    return {
      type: 'text',
      summary:
        `Shortcut "${tool.name}" finished:\n${done.join('\n')}\n` +
        'This request is complete: confirm it to the user in one short sentence and call no other tool for it.',
    };
  }

  toToolDefinition(): ToolDefinition {
    const tool = this.tool;
    const fills = tool.kind === 'shortcut' ? fillInsOf(tool.steps) : [];
    return {
      type: 'function',
      function: {
        name: tool.name,
        description:
          tool.kind === 'instructions'
            ? `${tool.description} (Saved instructions: call it to read them, then follow them.)`
            : `${tool.description} (Shortcut: runs ${tool.steps.map(s => s.tool).join(' → ')} after one approval.)`,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            fills.map(f => [
              f,
              {type: 'string', description: `Value for {{${f}}}.`},
            ]),
          ),
          ...(fills.length ? {required: fills} : {}),
        },
      },
    };
  }
}

function stopped(
  name: string,
  index: number,
  tool: string,
  why: string,
  done: string[],
): TalentResult {
  const summary =
    `Shortcut "${name}" stopped at step ${index + 1} (${tool}): ${why}` +
    (done.length
      ? `\nDone before that:\n${done.join('\n')}`
      : '\nNothing was done.');
  return {type: 'error', summary, errorMessage: summary};
}

// --- storage and registration ----------------------------------------------

let tools: CustomTool[] = [];
let loaded: Promise<void> | null = null;

function register(list: CustomTool[]) {
  for (const engine of talentRegistry.getAll()) {
    if (engine instanceof CustomToolEngine) {
      talentRegistry.unregister(engine.name);
    }
  }
  for (const tool of list) {
    if (!talentRegistry.has(tool.name)) {
      talentRegistry.register(new CustomToolEngine(tool));
    }
  }
}

/** Load saved tools once and register them. Bad entries are skipped. */
export function ensureCustomToolsLoaded(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        const builtIns = builtInToolNames();
        const list: CustomTool[] = [];
        for (const item of Array.isArray(parsed) ? parsed : []) {
          const checked = checkCustomTool(item, {
            builtIns,
            existing: list.map(t => t.name),
          });
          if (typeof checked !== 'string') {
            list.push(checked);
          }
        }
        tools = list;
      } catch {
        tools = [];
      }
      register(tools);
    })();
  }
  return loaded;
}

export async function listCustomTools(): Promise<CustomTool[]> {
  await ensureCustomToolsLoaded();
  return [...tools];
}

async function persist(next: CustomTool[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  tools = next;
  register(tools);
}

/** Save (add or replace) a checked tool. Returns why not, or null. */
export async function saveCustomTool(
  input: unknown,
  replacing?: string,
): Promise<CustomTool | string> {
  await ensureCustomToolsLoaded();
  const checked = checkCustomTool(input, {
    builtIns: builtInToolNames(),
    existing: tools.map(t => t.name),
    replacing,
  });
  if (typeof checked === 'string') {
    return checked;
  }
  const rest = tools.filter(
    t => t.name !== checked.name && t.name !== replacing,
  );
  await persist([...rest, checked]);
  return checked;
}

export async function deleteCustomTool(name: string): Promise<boolean> {
  await ensureCustomToolsLoaded();
  if (!tools.some(t => t.name === name)) {
    return false;
  }
  await persist(tools.filter(t => t.name !== name));
  return true;
}

/** Test helper. */
export function resetCustomToolsForTests(): void {
  tools = [];
  loaded = null;
}
