/**
 * "Find the fit": how much memory a model needs before it is downloaded,
 * where it would run, and a few facts read from its name (size, mixture of
 * experts). Pure functions; the label component is components/FitLabel.
 *
 * Before download there is no GGUF metadata (layers, heads), so the room
 * for the conversation (KV cache) is a rough rule from the model's size:
 *   per token ≈ 64 KB + 12 KB per billion parameters, at most 384 KB
 * (f16 cache). Checked against real models: Llama 3.2 1B 32 KB, Qwen3 4B
 * 144 KB, Llama 3.1 8B 128 KB, Qwen2.5 32B 256 KB, Llama 3 70B 320 KB per
 * token; the rule is on the safe side for most. Plus 10 % for the runner's
 * own buffers, like utils/memoryEstimator. Once downloaded, the exact
 * estimate from the file's metadata (memoryEstimator) is used instead.
 */
import type {PcFit, PcHardware} from '../services/desktop/pcHardware';

const KB = 1024;
const GB = 1e9;

/** Parameters (billions) from a name like "Qwen3-30B-A3B" or "SmolLM-360M". */
export function paramsFromName(name: string | undefined): number | undefined {
  if (!name) {
    return undefined;
  }
  // Total size, not the active part ("A3B") or an expert count ("8x7B").
  const experts = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b\b/i.exec(name);
  if (experts) {
    return Number(experts[1]) * Number(experts[2]);
  }
  const re = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)\s*([bm])(?![a-z0-9])/gi;
  let best: number | undefined;
  for (const m of name.matchAll(re)) {
    const before = name[m.index! + m[0].indexOf(m[1]) - 1];
    if (before === 'a' || before === 'A') {
      continue; // "A3B": active parameters
    }
    const value = Number(m[1]) / (m[2].toLowerCase() === 'm' ? 1000 : 1);
    best = Math.max(best ?? 0, value);
  }
  return best;
}

/** Bytes per parameter for a quantization named in the file name. */
export function bytesPerParam(fileName: string): number {
  const n = fileName.toUpperCase();
  if (/F32/.test(n)) {
    return 4;
  }
  if (/(BF16|F16)/.test(n)) {
    return 2;
  }
  if (/Q8/.test(n)) {
    return 1.06;
  }
  if (/Q6/.test(n)) {
    return 0.82;
  }
  if (/Q5/.test(n)) {
    return 0.7;
  }
  if (/Q3|IQ3/.test(n)) {
    return 0.45;
  }
  if (/Q2|IQ2|IQ1/.test(n)) {
    return 0.35;
  }
  return 0.6; // Q4 and unknown
}

/** Billions of parameters: from the name, else from file size. */
export function estimateParams(
  name: string,
  fileBytes: number,
  knownParams?: number,
): number {
  if (knownParams && knownParams > 0) {
    return knownParams / 1e9;
  }
  return paramsFromName(name) ?? fileBytes / bytesPerParam(name) / 1e9;
}

/** Room for the conversation per token (bytes), rule above. */
export function kvBytesPerToken(paramsB: number): number {
  return Math.min(64 * KB + 12 * KB * paramsB, 384 * KB);
}

/** Memory a model needs before download: file + conversation + 10 %. */
export function estimateMemoryNeeded(
  fileBytes: number,
  contextTokens: number,
  paramsB: number,
): number {
  return (fileBytes + kvBytesPerToken(paramsB) * contextTokens) * 1.1;
}

/** Below about 3 billion parameters: think off unless asked. */
export const SMALL_MODEL_PARAMS_B = 3;

export function isSmallModel(
  model:
    | {name?: string; params?: number; size?: number; filename?: string}
    | undefined,
): boolean {
  if (!model) {
    return false;
  }
  const params =
    model.params && model.params > 0
      ? model.params / 1e9
      : (paramsFromName(model.name) ?? paramsFromName(model.filename));
  return params !== undefined && params < SMALL_MODEL_PARAMS_B;
}

/**
 * Mixture of experts: only a few billion parameters work per word, so it
 * runs well from plain memory. Names: "30B-A3B", "8x7B", "MoE", and
 * families that are all MoE.
 */
const MOE_NAME =
  /(?:\d\s*b[-_ ]a\d+(?:\.\d+)?b\b)|(?:(?:^|[^a-z0-9])\d+\s*x\s*\d+(?:\.\d+)?\s*b\b)|moe|mixtral|gpt-?oss|deepseek-?(?:v2|v3|coder-v2|r1(?![^/]*(?:distill|qwen|llama)))|llama-?4-?(?:scout|maverick)|olmoe|glm-?4\.5-?air|granite-[\d.]+-[\d.]+b-a\d/i;

export function isMixtureOfExperts(name: string | undefined): boolean {
  return !!name && MOE_NAME.test(name);
}

export const MOE_TEXT = 'Mixture of experts: good on PCs with lots of memory';

export type PhoneFit = 'fits' | 'tight' | 'too-big';

/**
 * Phones have no separate graphics memory: by memory only. `ceiling` is
 * what the app has seen load (or its safe guess); up to all memory is
 * tight (close other apps).
 */
export function phoneFit(
  bytes: number,
  {totalMemory, ceiling}: {totalMemory: number; ceiling: number},
): PhoneFit {
  if (bytes <= ceiling) {
    return 'fits';
  }
  return bytes <= totalMemory ? 'tight' : 'too-big';
}

/** The app's safe guess before any model has loaded (useMemoryCheck). */
export const coldStartCeiling = (totalMemory: number) =>
  Math.max(Math.min(totalMemory * 0.6, totalMemory - 1.2 * GB), 0);

export const PHONE_FIT_TEXT: Record<PhoneFit, string> = {
  fits: 'Fits on this phone',
  tight: 'Just fits: close other apps first',
  'too-big': 'Too big for this phone',
};

export type {PcFit, PcHardware};
