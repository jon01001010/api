import AsyncStorage from '@react-native-async-storage/async-storage';
import {deriveToolSchemas} from '../services/talents';
import {ensureCustomToolsLoaded} from '../services/talents/customTools';

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

export async function writeGlobalTools(names: string[]): Promise<void> {
  deriveToolSchemas();
  await ensureCustomToolsLoaded();
  const known = new Set(deriveToolSchemas().map(t => t.function.name));
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify([...new Set(names.filter(n => known.has(n)))]),
  );
}

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
