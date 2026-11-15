import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collectSystemPromptFragments,
  deriveToolSchemas,
} from '../services/talents';
import {
  changeToolSwitches,
  ensureCustomToolsLoaded,
  toolSwitchesChanged,
} from '../services/talents/customTools';

/**
 * Called when the stored tool switches change (customTools.ts). A function,
 * not a re-export: the two files import each other, and a re-export getter
 * is undefined while the cycle is still loading.
 */
export function onToolSwitchesChanged(listener: () => void): () => void {
  return require('../services/talents/customTools').onToolSwitchesChanged(
    listener,
  );
}

// Same key as GLOBAL_TOOLS_KEY in customTools.ts (which switches tools off).
const KEY = '@pocketagent/global-tools/v1';
const PROMPT_KEY = '@pocketagent/global-system-prompt/v1';

// Missing or malformed storage is fail-closed: no tools enabled.
export async function readGlobalTools(): Promise<string[]> {
  // Custom tools must be registered before names are checked against tools.
  deriveToolSchemas();
  await ensureCustomToolsLoaded();
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(v => typeof v === 'string'))
    return [];
  const known = new Set(deriveToolSchemas().map(t => t.function.name));
  return [...new Set(parsed.filter(name => known.has(name)))];
}

/**
 * Tools an assistant may use on its own, without a Toolbox switch: they only
 * compute or show something (no files, memory, web, phone or custom tools).
 */
export const ASSISTANT_ONLY_TOOLS: readonly string[] = [
  'render_html',
  'calculate',
  'datetime',
];

/** The part of an assistant's tool list it may use without a Toolbox switch. */
export function assistantOnlyTools(talents: {name: string}[]): string[] {
  return talents
    .map(t => t.name)
    .filter(name => ASSISTANT_ONLY_TOOLS.includes(name));
}

/** Replaces the whole list. To switch some tools, use setToolsEnabled. */
export function writeGlobalTools(names: string[]): Promise<void> {
  return changeToolSwitches(() => writeNow(names));
}

async function writeNow(names: string[]): Promise<void> {
  deriveToolSchemas();
  await ensureCustomToolsLoaded();
  const known = new Set(deriveToolSchemas().map(t => t.function.name));
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify([...new Set(names.filter(n => known.has(n)))]),
  );
  toolSwitchesChanged();
}

/**
 * Switches only these tools on or off, against the list as stored now (not a
 * copy a screen read earlier, which a sync may have changed since). Returns
 * the new list.
 */
export function setToolsEnabled(
  names: string[],
  on: boolean,
): Promise<string[]> {
  return changeToolSwitches(async () => {
    // Unreadable means no tools on (fail-closed), so start from none.
    const stored = await readGlobalTools().catch(() => [] as string[]);
    const rest = stored.filter(n => !names.includes(n));
    await writeNow(on ? [...rest, ...names] : rest);
    return readGlobalTools();
  });
}

/** Switches one tool on or off (see setToolsEnabled). */
export const setToolEnabled = (name: string, on: boolean) =>
  setToolsEnabled([name], on);

export async function readGlobalPrompt(): Promise<string> {
  return (await AsyncStorage.getItem(PROMPT_KEY)) ?? '';
}

export async function writeGlobalPrompt(prompt: string): Promise<void> {
  await AsyncStorage.setItem(PROMPT_KEY, prompt);
}

/**
 * The tool line added to the system prompt. Names only: each tool's full
 * how-to already reaches the model in the tool list itself, and repeating
 * it here doubled what a phone model must read before its first word.
 */
export function generatedToolPrompt(names: string[]): string {
  const tools = deriveToolSchemas(names);
  if (!tools.length) return '';
  return (
    "Available tools (request a tool call using the model's supported function-call format; never pretend a tool executed; each tool's how-to is in its description): " +
    tools.map(t => t.function.name).join(', ') +
    '.'
  );
}

/**
 * Everything about tools that goes into the system prompt for one turn, from
 * the tools actually sent that turn (never from an older list). No tools on:
 * no tool line and no tool guidance, so a plain chat gets a short prompt.
 */
export function toolPromptPieces(
  names: string[],
  settings: {toolGuidance: boolean},
  maxToolTurns: number,
  now: Date = new Date(),
): {guidance: string[]; toolLine: string} {
  if (!deriveToolSchemas(names).length) {
    return {guidance: [], toolLine: ''};
  }
  return {
    guidance: settings.toolGuidance
      ? collectSystemPromptFragments(names, {now, maxToolTurns})
      : [],
    toolLine: generatedToolPrompt(names),
  };
}

// Agent iteration ceiling; independent of model and enforced by the runner.
const AGENT_TURNS_KEY = '@pocketagent/agent/max-turns/v1';
export async function readAgentMaxTurns(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(AGENT_TURNS_KEY);
    const value = Number(raw);
    // Missing settings use the conservative default; malformed values fail closed.
    return raw !== null && Number.isInteger(value) && value >= 5 && value <= 500
      ? value
      : 20;
  } catch {
    return 20;
  }
}
export async function writeAgentMaxTurns(value: number): Promise<void> {
  if (!Number.isInteger(value) || value < 5 || value > 500)
    throw new Error('Agent limit must be 5–500');
  await AsyncStorage.setItem(AGENT_TURNS_KEY, String(value));
}
