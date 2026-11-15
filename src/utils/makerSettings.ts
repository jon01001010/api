/**
 * The model maker's recommended sampling settings, per model family.
 * Offered in Chat settings ("Use the maker's settings"), never forced: a
 * value the user changed from the app's default is kept.
 *
 * Sources (the makers' own model cards on Hugging Face):
 * - Qwen3 (Qwen/Qwen3-*): thinking temperature 0.6, top_p 0.95, top_k 20,
 *   min_p 0; non-thinking 0.7 / 0.8 / 20 / 0. The GGUF cards suggest
 *   presence_penalty 1.5 for quantized models against endless repeats.
 *   "Instruct" models (2507, Coder, VL) never think: non-thinking values;
 *   "Thinking" ones always think.
 * - QwQ-32B (Qwen/QwQ-32B): temperature 0.6, top_p 0.95, min_p 0, top_k
 *   between 20 and 40.
 * - DeepSeek-R1 and its distills (deepseek-ai/DeepSeek-R1): temperature
 *   0.5–0.7, 0.6 recommended; top_p 0.95.
 * - Phi-4-reasoning (microsoft/Phi-4-reasoning): temperature 0.8, top_k 50,
 *   top_p 0.95.
 * - gpt-oss (openai/gpt-oss-*): temperature 1.0, top_p 1.0.
 * - Magistral (mistralai/Magistral-*): temperature 0.7, top_p 0.95.
 * - Gemma 3 / 3n (google/gemma-3-*, generation_config): temperature 1.0,
 *   top_k 64, top_p 0.95, min_p 0.
 */
import type {CompletionParams} from './completionTypes';

export type MakerKey =
  | 'temperature'
  | 'top_p'
  | 'top_k'
  | 'min_p'
  | 'penalty_present';

export type MakerValues = Partial<Record<MakerKey, number>>;

export interface MakerSettings {
  family: string;
  values: MakerValues;
}

interface Family {
  family: string;
  match: RegExp;
  thinking: MakerValues;
  /** When thinking is off; same as `thinking` if not given. */
  plain?: MakerValues;
  /** Thinking only or never thinking, whatever the switch says. */
  fixed?: 'thinking' | 'plain';
}

const QWEN3_THINKING: MakerValues = {
  temperature: 0.6,
  top_p: 0.95,
  top_k: 20,
  min_p: 0,
  penalty_present: 1.5,
};
const QWEN3_PLAIN: MakerValues = {
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  min_p: 0,
  penalty_present: 1.5,
};

/** First match wins: more specific names first. */
const FAMILIES: Family[] = [
  {
    family: 'DeepSeek-R1',
    match: /deepseek[-_ ]?r1/i,
    thinking: {temperature: 0.6, top_p: 0.95},
  },
  {
    family: 'QwQ',
    match: /\bqwq/i,
    thinking: {temperature: 0.6, top_p: 0.95, top_k: 40, min_p: 0},
  },
  {
    family: 'Qwen3 Thinking',
    match: /qwen-?3(?![.\d])[^/]*thinking/i,
    thinking: QWEN3_THINKING,
    fixed: 'thinking',
  },
  {
    family: 'Qwen3 Instruct',
    match: /qwen-?3(?![.\d])[^/]*instruct/i,
    thinking: QWEN3_PLAIN,
    fixed: 'plain',
  },
  {
    family: 'Qwen3',
    match: /qwen-?3(?![.\d])/i,
    thinking: QWEN3_THINKING,
    plain: QWEN3_PLAIN,
  },
  {
    family: 'Phi-4-reasoning',
    match: /phi-?4[^/]*reasoning/i,
    thinking: {temperature: 0.8, top_k: 50, top_p: 0.95},
  },
  {
    family: 'gpt-oss',
    match: /gpt-?oss/i,
    thinking: {temperature: 1.0, top_p: 1.0},
  },
  {
    family: 'Magistral',
    match: /magistral/i,
    thinking: {temperature: 0.7, top_p: 0.95},
  },
  {
    family: 'Gemma 3',
    match: /gemma-?3/i,
    thinking: {temperature: 1.0, top_k: 64, top_p: 0.95, min_p: 0},
  },
];

/** The maker's settings for a model's name, or null if not known. */
export function makerSettingsFor(
  name: string | undefined,
  thinking: boolean,
): MakerSettings | null {
  if (!name) {
    return null;
  }
  const found = FAMILIES.find(f => f.match.test(name));
  if (!found) {
    return null;
  }
  const useThinking =
    found.fixed === 'thinking' || (found.fixed !== 'plain' && thinking);
  const values = useThinking ? found.thinking : (found.plain ?? found.thinking);
  return {family: found.family, values};
}

export interface MakerFill {
  settings: CompletionParams;
  /** Set to the maker's value. */
  filled: MakerKey[];
  /** Changed by the user before: left as it was. */
  kept: MakerKey[];
}

const same = (a: unknown, b: unknown) =>
  a !== undefined && b !== undefined && Number(a) === Number(b);

/**
 * Fills in the maker's values where the setting is still the app's default
 * (or not set). A value the user changed is kept and listed in `kept`.
 */
export function fillMakerSettings(
  current: CompletionParams,
  appDefaults: CompletionParams,
  values: MakerValues,
): MakerFill {
  const settings = {...current} as CompletionParams & Record<string, unknown>;
  const filled: MakerKey[] = [];
  const kept: MakerKey[] = [];
  for (const [key, value] of Object.entries(values) as [MakerKey, number][]) {
    const now = (current as Record<string, unknown>)[key];
    if (same(now, value)) {
      continue;
    }
    if (now === undefined || same(now, (appDefaults as any)[key])) {
      settings[key] = value;
      filled.push(key);
    } else {
      kept.push(key);
    }
  }
  return {settings, filled, kept};
}

/** "temperature 0.6, top_p 0.95" for a short line in the sheet. */
export function describeMakerValues(values: MakerValues): string {
  return Object.entries(values)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
}
