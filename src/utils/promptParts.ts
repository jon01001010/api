/**
 * Everything the app adds to what the model sees, besides your own messages:
 * each part has a switch (Toolbox → What the model sees) and is shown, as
 * sent, in "Show exactly what the model sees". Nothing is added in secret.
 *
 * The same functions build the real message and the preview, so the preview
 * can't drift from what is sent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** How the model is told the date and time. */
export type TimeMode = 'off' | 'date' | 'datetime';

export interface PromptPartSettings {
  /** Off / date only / date and time. */
  time: TimeMode;
  /** Your memory notes (Toolbox → Memory). */
  memory: boolean;
  /** The "Available tools: …" line (the tools themselves still go as tools). */
  toolList: boolean;
  /** Guidance a tool adds when it is on (e.g. web search: search first, cite). */
  toolGuidance: boolean;
  /** The model file's own built-in system prompt (used when no assistant is picked). */
  modelDefaultPrompt: boolean;
}

/**
 * Date only by default: small models fixated on a clock time stuck to the
 * user's message (2026-11-08); the time is there for those who want it.
 */
export const DEFAULT_PROMPT_PARTS: PromptPartSettings = {
  time: 'date',
  memory: true,
  toolList: true,
  toolGuidance: true,
  modelDefaultPrompt: true,
};

const KEY = '@pocketagent/prompt-parts/v1';

export async function readPromptPartSettings(): Promise<PromptPartSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      return {...DEFAULT_PROMPT_PARTS};
    }
    const saved = JSON.parse(raw);
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    return {
      time: ['off', 'date', 'datetime'].includes(saved?.time)
        ? saved.time
        : DEFAULT_PROMPT_PARTS.time,
      memory: bool(saved?.memory, DEFAULT_PROMPT_PARTS.memory),
      toolList: bool(saved?.toolList, DEFAULT_PROMPT_PARTS.toolList),
      toolGuidance: bool(
        saved?.toolGuidance,
        DEFAULT_PROMPT_PARTS.toolGuidance,
      ),
      modelDefaultPrompt: bool(
        saved?.modelDefaultPrompt,
        DEFAULT_PROMPT_PARTS.modelDefaultPrompt,
      ),
    };
  } catch {
    return {...DEFAULT_PROMPT_PARTS};
  }
}

export async function writePromptPartSettings(
  settings: PromptPartSettings,
): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The one date/time line, in this device's own time zone (never UTC, so it
 * can't disagree with itself late in the evening).
 */
export function timeLine(now: Date, mode: TimeMode): string {
  if (mode === 'off') {
    return '';
  }
  const date = `${DAYS[now.getDay()]}, ${now.getDate()} ${
    MONTHS[now.getMonth()]
  } ${now.getFullYear()}`;
  if (mode === 'date') {
    return `Background: today is ${date}.`;
  }
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const zone = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `Background: today is ${date}; the local time is ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())} (${zone}).`;
}

/** One labelled piece of what the model sees. */
export interface PromptPart {
  id: string;
  /** What it is, for people. */
  label: string;
  /** Where to change it. */
  source: string;
  text: string;
}

/**
 * The parts added after the assistant's (or model's) own prompt, in the
 * order they are sent. Empty parts are left out.
 */
export function buildBackgroundParts(input: {
  now: Date;
  settings: PromptPartSettings;
  globalInstructions: string;
  memoryContext: string;
  summaryContext: string;
  toolLine: string;
}): PromptPart[] {
  const {now, settings} = input;
  const parts: PromptPart[] = [
    {
      id: 'time',
      label: 'Date and time',
      source: 'Toolbox → What the model sees → Date and time',
      text: timeLine(now, settings.time),
    },
    {
      id: 'global',
      label: 'Your global instructions',
      source: 'Toolbox → Global System Prompt',
      text: input.globalInstructions.trim(),
    },
    {
      id: 'memory',
      label: 'Memory',
      source: 'Toolbox → Memory (switch: What the model sees → Memory)',
      text: settings.memory ? input.memoryContext : '',
    },
    {
      id: 'summary',
      label: 'Summary of the earlier conversation',
      source: 'Made automatically when a chat gets too long for the model',
      text: input.summaryContext,
    },
    {
      id: 'tools',
      label: 'List of tools',
      source: 'Toolbox tool switches (switch: What the model sees → Tool list)',
      text: settings.toolList ? input.toolLine : '',
    },
  ];
  return parts.filter(p => p.text.trim().length > 0);
}

export const joinParts = (parts: PromptPart[]): string =>
  parts.map(p => p.text).join('\n\n');

/**
 * The whole background the model gets before your messages, as labelled
 * parts, in order: the model's built-in prompt (or the assistant's), tool
 * guidance, then the background parts. Same pieces as sending (see
 * useChatSession); used by "Show exactly what the model sees".
 */
export function buildPromptPreview(input: {
  now: Date;
  settings: PromptPartSettings;
  modelDefaultPrompt: string;
  toolGuidance: string[];
  globalInstructions: string;
  memoryContext: string;
  toolLine: string;
}): PromptPart[] {
  const {settings} = input;
  const head: PromptPart[] = [
    {
      id: 'model',
      label: "The model's built-in prompt",
      source:
        'Comes with the model file; an assistant’s prompt replaces it (switch: What the model sees → Model’s built-in prompt)',
      text: settings.modelDefaultPrompt ? input.modelDefaultPrompt.trim() : '',
    },
    ...(settings.toolGuidance ? input.toolGuidance : []).map((text, i) => ({
      id: `guidance-${i}`,
      label: 'Tool guidance',
      source:
        'Added by a tool that is switched on (switch: What the model sees → Tool guidance)',
      text,
    })),
  ];
  return [
    ...head,
    ...buildBackgroundParts({
      now: input.now,
      settings,
      globalInstructions: input.globalInstructions,
      memoryContext: input.memoryContext,
      summaryContext: '',
      toolLine: input.toolLine,
    }),
  ].filter(p => p.text.trim().length > 0);
}
