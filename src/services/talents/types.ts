export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Result shape returned by a TalentEngine.
 * - `type: 'html'` with `html` populated means a visual preview is available.
 * - `type: 'text'` means only a textual summary is produced.
 * - `type: 'search'` carries structured hits for the UI; the model still reads
 *   `summary` (the wrapped menu) exactly as it would a `text` result.
 * - `type: 'image'` means a picture was made (`path`: the app's own path,
 *   /pocketagent/…; shown in the chat, can be saved with Save a copy).
 * - `type: 'audio'` means an audio file was produced (future TTS support).
 * - `type: 'model_answer'` is another model's answer (ask_other_model).
 * - `type: 'model_answers'` is several models' answers side by side
 *   (ask_models), or a fallback chain's answer with its "ran out" lines
 *   (ask_model_chain).
 * - `type: 'error'` means the engine failed; errorMessage describes what went wrong.
 * `summary` is always present and is what gets fed back to the model as the
 * `{role: 'tool', content}` payload on subsequent turns.
 */
export type TalentResult =
  | {type: 'html'; html: string; title?: string; summary: string}
  | {type: 'text'; summary: string; links?: string[]}
  | {
      type: 'search';
      query: string;
      results: WebSearchResultItem[];
      summary: string;
    }
  | {type: 'image'; path: string; name: string; summary: string}
  | {type: 'audio'; audioUri: string; summary: string}
  // Another model's answer (ask_other_model): shown to the user labelled
  // with the model's name; the model reads `summary` (wrapped untrusted).
  | {
      type: 'model_answer';
      model: string;
      where: string;
      answer: string;
      summary: string;
    }
  // Several models (ask_models, ask_model_chain): each answer labelled
  // with its model; `lines` are the app's own (where answers differ, "<model>
  // ran out (<why>): continuing with <next>"). The model reads `summary`
  // (every answer wrapped untrusted).
  | {
      type: 'model_answers';
      mode: 'and' | 'or';
      answers: ModelAnswerItem[];
      lines: string[];
      summary: string;
    }
  | {type: 'error'; summary: string; errorMessage: string};

/** One model's part of a `model_answers` result. */
export interface ModelAnswerItem {
  model: string;
  where: string;
  /** The answer, or empty when there is none. */
  answer: string;
  /** Why there is no (whole) answer: "did not answer within 120 seconds". */
  problem?: string;
}

/** OpenAI function-calling tool schema shape. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * Passed in (rather than read from the clock/config) so fragments stay pure
 * and testable — inject a fixed `now`.
 */
export interface SystemPromptContext {
  now: Date;
  maxToolTurns: number;
  /** Talents active for this request, so a fragment references a sibling tool
   *  (e.g. web_search → read_url) only when it is actually enabled. */
  activeTalents: ReadonlySet<string>;
}

/** Aborts when the run is stopped. */
export interface TalentExecuteContext {
  signal: AbortSignal;
  /**
   * Set by a custom shortcut the user already approved as a whole: phone
   * actions run without asking again, and timers/alarms stay in the
   * background so later steps can still run.
   */
  inApprovedShortcut?: boolean;
  /**
   * The model's thinking from just before this request (raw). Shown with
   * the tool's question only, after the facts ("The model was thinking:");
   * never parsed, never sent anywhere else.
   */
  thinking?: string;
  /** The chat asking (for "Don't allow anything more in this chat"). */
  chat?: string;
}

export interface TalentEngine {
  readonly name: string;
  /**
   * Optional hint for the n_ctx this talent tends to need room for. Read only
   * by the pal-load hint and the heavy-talent banner sub-copy; never moves a
   * banner trigger threshold.
   */
  readonly recommendedContextTokens?: number;
  execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult>;
  toToolDefinition(): ToolDefinition;
  /**
   * Optional system-prompt fragment; folded into the single leading system
   * message by `assembleMessages` — a talent must never emit its own.
   */
  systemPromptFragment?(ctx: SystemPromptContext): string | null;
}
