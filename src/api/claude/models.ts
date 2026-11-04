/**
 * What each Claude model accepts, by model id. The model list comes live
 * from Anthropic; this only decides which request options are safe to send,
 * because newer models reject some settings with a 400 and older ones
 * reject the newer settings.
 */
export interface ClaudeFeatures {
  /** `thinking: {type: 'adaptive'}` and `output_config.effort`. */
  adaptive: boolean;
  /** Thinking can't be turned off (only lowered with effort). */
  thinkingAlwaysOn: boolean;
  /** Off is `{type: 'between_tools'}` instead of `disabled`. */
  offIsBetweenTools: boolean;
  /** Thinking off only allowed at effort high or lower. */
  offNeedsHighOrLower: boolean;
  /** Thinking blocks are bound to the conversation (send drop_block). */
  bindsThinking: boolean;
  /** Server-side refusal fallback (`fallbacks: 'default'`). */
  fallbacks: boolean;
  /** Effort levels accepted. */
  efforts: string[];
}

const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** "claude-opus-4-8" -> {family: 'opus', major: 4, minor: 8}. */
export function parseClaudeId(id: string): {
  family: string;
  major: number;
  minor: number;
} | null {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?![\d])/.exec(id);
  if (!m) {
    return null;
  }
  const minor = m[3] && m[3].length <= 2 ? Number(m[3]) : 0;
  return {family: m[1], major: Number(m[2]), minor};
}

export function claudeFeatures(modelId: string): ClaudeFeatures {
  const p = parseClaudeId(modelId);
  const none: ClaudeFeatures = {
    adaptive: false,
    thinkingAlwaysOn: false,
    offIsBetweenTools: false,
    offNeedsHighOrLower: false,
    bindsThinking: false,
    fallbacks: false,
    efforts: [],
  };
  if (!p) {
    return none;
  }
  const v = p.major + p.minor / 10;
  const is = (family: string, major: number, minor = 0) =>
    p.family === family && p.major === major && p.minor === minor;

  // Fable / Mythos: thinking always on, model-bound blocks from 5.1.
  if (p.family === 'fable' || p.family === 'mythos') {
    const bound = v >= 5.1;
    return {
      ...none,
      adaptive: true,
      thinkingAlwaysOn: true,
      bindsThinking: bound,
      fallbacks: is('fable', 5, 1),
      efforts: ALL_EFFORTS,
    };
  }
  if (p.family === 'opus') {
    if (v >= 5.5) {
      return {
        ...none,
        adaptive: true,
        thinkingAlwaysOn: true,
        bindsThinking: true,
        fallbacks: true,
        efforts: ALL_EFFORTS,
      };
    }
    if (v >= 5) {
      return {
        ...none,
        adaptive: true,
        offNeedsHighOrLower: true,
        fallbacks: true,
        efforts: ALL_EFFORTS,
      };
    }
    if (v >= 4.7) {
      return {...none, adaptive: true, efforts: ALL_EFFORTS};
    }
    if (v >= 4.6) {
      return {
        ...none,
        adaptive: true,
        efforts: ['low', 'medium', 'high', 'max'],
      };
    }
    return none;
  }
  if (p.family === 'sonnet') {
    if (v >= 5.5) {
      return {
        ...none,
        adaptive: true,
        offIsBetweenTools: true,
        bindsThinking: true,
        fallbacks: true,
        efforts: ALL_EFFORTS,
      };
    }
    if (v >= 5) {
      return {...none, adaptive: true, efforts: ALL_EFFORTS};
    }
    if (v >= 4.6) {
      return {
        ...none,
        adaptive: true,
        efforts: ['low', 'medium', 'high', 'max'],
      };
    }
    return none;
  }
  if (p.family === 'haiku' && v >= 5.5) {
    return {
      ...none,
      adaptive: true,
      offNeedsHighOrLower: true,
      bindsThinking: true,
      efforts: ALL_EFFORTS,
    };
  }
  return none;
}
