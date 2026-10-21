import AsyncStorage from '@react-native-async-storage/async-storage';
import {deriveToolSchemas} from '../services/talents';

const KEY = '@pocketagent/global-tools/v1';
const PROMPT_KEY = '@pocketagent/global-system-prompt/v1';

// Missing or malformed storage is fail-closed: no tools enabled.
export async function readGlobalTools(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(v => typeof v === 'string')) return [];
  const known = new Set(deriveToolSchemas().map(t => t.function.name));
  return [...new Set(parsed.filter(name => known.has(name)))];
}

export async function writeGlobalTools(names: string[]): Promise<void> {
  const known = new Set(deriveToolSchemas().map(t => t.function.name));
  await AsyncStorage.setItem(KEY, JSON.stringify([...new Set(names.filter(n => known.has(n)))]));
}

export async function readGlobalPrompt(): Promise<string> {
  return (await AsyncStorage.getItem(PROMPT_KEY)) ?? '';
}

export async function writeGlobalPrompt(prompt: string): Promise<void> {
  await AsyncStorage.setItem(PROMPT_KEY, prompt);
}

export function generatedToolPrompt(names: string[]): string {
  const tools = deriveToolSchemas(names);
  if (!tools.length) return '';
  return 'Available tools (request a tool call using the model\'s supported function-call format; never pretend a tool executed):\n' +
    tools.map(t => '- ' + t.function.name + ': ' + t.function.description).join('\n');
}

// Agent iteration ceiling; independent of model and enforced by the runner.
const AGENT_TURNS_KEY = '@pocketagent/agent/max-turns/v1';
export async function readAgentMaxTurns(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(AGENT_TURNS_KEY);
    const value = Number(raw);
    // Missing settings use the conservative default; malformed values fail closed.
    return raw !== null && Number.isInteger(value) && value >= 5 && value <= 500 ? value : 20;
  } catch {
    return 20;
  }
}
export async function writeAgentMaxTurns(value: number): Promise<void> {
  if (!Number.isInteger(value) || value < 5 || value > 500) throw new Error('Agent limit must be 5–500');
  await AsyncStorage.setItem(AGENT_TURNS_KEY, String(value));
}
