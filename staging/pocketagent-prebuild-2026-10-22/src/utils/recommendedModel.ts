/** Single replaceable recommendation. This is guidance, not a compatibility guarantee. */
export interface ModelRecommendation {
  family: string;
  displayName: string;
  officialUrl: string;
  capabilities: readonly ('text' | 'vision' | 'tools')[];
  caveat: string;
}

export const RECOMMENDED_MODEL: ModelRecommendation = {
  family: 'Qwen3.5-2B',
  displayName: 'Qwen3.5-2B',
  officialUrl: 'https://huggingface.co/Qwen/Qwen3.5-2B',
  capabilities: ['text', 'vision', 'tools'],
  caveat:
    'Vision and calculator tool use have been observed in PocketAgent on a Motorola Razr 2023. Other GGUF variants, vision projectors, and devices require separate testing.',
};

/** Never assume model capability solely from a filename or family name. */
export function matchesRecommendedFamily(modelName: string): boolean {
  return /(?:^|[^a-z0-9])qwen[\s._-]*3[.\s_-]*5[\s._-]*2b(?:[^a-z0-9]|$)/i.test(modelName);
}
