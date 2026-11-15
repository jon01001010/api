/**
 * Guards around the model's tool calls, per chat (SECURITY.md rule 1,
 * "The model is treated as possibly hostile"). The chat loop
 * (AgentRunner.ts) asks this before and tells it after every tool call.
 *
 * - Read-then-leak: once a tool that reads private data (PRIVATE_READS)
 *   gave something back in a chat, every tool that sends data out of this
 *   device (outgoing(): a web search, a web address, a message or text
 *   handed to another app, anything sent to the paired PC) asks first in
 *   the app, showing exactly what goes out, even when it normally doesn't.
 *   The chat's own model request is not stopped (the user chose that
 *   model); a cloud model gets a one-line notice in the chat.
 * - Ask-rate limit: more than ASK_LIMIT questions within ASK_WINDOW_MS in
 *   one chat pauses the run: "The model is asking a lot. Continue / Stop"
 *   (in the app; the model has no way to answer it).
 * - "Don't allow anything more in this chat" (a button on the app's
 *   questions): from then on every tool that would ask (here or natively
 *   on the PC), send something out or read private data is refused in
 *   that chat before it is called.
 * - The model's thinking from just before a request is shown with each
 *   question ("The model was thinking:", after the facts), with a warning
 *   when it talks about hiding things or getting around checks. It is a
 *   warning sign, not a guard. The model is never told about it.
 *
 * Plain data and functions; the questions are passed in (makeToolGuard),
 * so this file has no screens and no stores.
 */
import type {TalentResult} from '../talents/types';

/** Questions in one chat within ASK_WINDOW_MS before the run pauses. */
export const ASK_LIMIT = 8;
export const ASK_WINDOW_MS = 2 * 60 * 1000;
/** Most characters of the model's thinking shown with a question. */
export const THINKING_SHOWN = 600;
/** The label above the model's thinking (the same on the PC: approval.rs). */
export const MODEL_THINKING = 'The model was thinking:';
/** The warning line when the thinking looks like hiding or getting around checks. */
export const THINKING_WARNING =
  'WARNING: the model’s thinking talks about hiding something from you or getting around checks. Read it before you allow anything.';

type Args = Record<string, any>;
/** What the guard may look at on a tool: a saved shortcut's steps, or a
 *  phone-side engine that sends to the paired PC. */
type EngineFields = {
  tool?: {kind?: string; steps?: {tool: string; args: Args}[]};
  sendsTo?: string;
};
/** Any tool engine (only the fields above are looked at). */
type EngineLike = object | null | undefined;
const fieldsOf = (engine: EngineLike): EngineFields | undefined =>
  (engine ?? undefined) as EngineFields | undefined;

const str = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : value === undefined
      ? ''
      : JSON.stringify(value);

/**
 * Tools that read private data, kept explicit: a file outside the
 * workspace (read or list), this PC's or the paired PC's clipboard, a file
 * of the paired PC's workspace, and a command's output (a command can
 * read anything the user can).
 */
export const PRIVATE_READS: Record<string, (args: Args) => boolean> = {
  outside_files: a => a?.action === 'read' || a?.action === 'list',
  clipboard_read: () => true,
  pc_clipboard_read: () => true,
  pc_workspace_read: () => true,
  run_command: () => true,
  pc_run_command: () => true,
};

/**
 * What a tool sends out of this device, exactly, or null when it sends
 * nothing out. Kept explicit: the web (search words, an address), text
 * handed to another app (a message, a share, a search in an app, a
 * destination for maps), and anything sent to the paired PC (a file
 * name, a command, the text to write, a picture's description).
 */
export const OUTGOING: Record<string, (args: Args) => string> = {
  web_search: a =>
    `A web search, sent to the search service:\n${str(a?.query)}`,
  read_url: a => `A web page, its address sent to that site:\n${str(a?.url)}`,
  compose_message: a =>
    `A ${str(a?.kind) || 'message'} filled in for ${str(a?.to) || str(a?.name) || '(you pick)'}:` +
    (a?.subject ? `\nSubject: ${str(a.subject)}` : '') +
    `\n${str(a?.body)}`,
  share_text: a =>
    `Text handed to ${str(a?.app) || 'an app you pick'}:\n${str(a?.text)}`,
  search_in_app: a =>
    `A search handed to ${str(a?.app) || 'an app'}:\n${str(a?.query)}`,
  navigate_to: a => `A place handed to the maps app:\n${str(a?.destination)}`,
  pc_workspace_read: a =>
    `A file name sent to your Home PC:\n${str(a?.filename)}`,
  pc_open: a =>
    `A file name sent to your Home PC (to open):\n${str(a?.filename)}`,
  pc_print: a =>
    `A file name sent to your Home PC (to print):\n${str(a?.filename)}`,
  pc_run_command: a => `A command sent to your Home PC:\n${str(a?.command)}`,
  pc_workspace_write: a =>
    `Text sent to your Home PC, for ${str(a?.filename)}:\n${str(a?.content)}`,
  pc_workspace_append: a =>
    `Text sent to your Home PC, added to ${str(a?.filename)}:\n${str(a?.content)}`,
  pc_workspace_undo: a =>
    `A file name sent to your Home PC (undo):\n${str(a?.filename)}`,
};

/** A phone action chain's and a shortcut's steps: {tool, args}. */
function stepsOf(name: string, args: Args, engineLike: EngineLike) {
  const engine = fieldsOf(engineLike);
  if (name === 'phone_actions_chain' && Array.isArray(args?.steps)) {
    return (args.steps as any[]).map(s => ({
      tool: String(s?.action ?? ''),
      args: (s?.args ?? s ?? {}) as Args,
    }));
  }
  if (engine?.tool?.kind === 'shortcut' && Array.isArray(engine.tool.steps)) {
    // The steps with the call's fill-ins put in, as the run will.
    const fill = (value: unknown): unknown =>
      typeof value === 'string'
        ? value.replace(/\{\{(\w+)\}\}/g, (all, key: string) =>
            args?.[key.toLowerCase()] !== undefined
              ? String(args[key.toLowerCase()])
              : all,
          )
        : value;
    return engine.tool.steps.map(s => ({
      tool: s.tool,
      args: Object.fromEntries(
        Object.entries(s.args ?? {}).map(([k, v]) => [k, fill(v)]),
      ) as Args,
    }));
  }
  return [];
}

/** Exactly what this call sends out of the device, or null. */
export function outgoing(
  name: string,
  args: Args,
  engine?: EngineLike,
): string | null {
  const sendsTo = fieldsOf(engine)?.sendsTo;
  if (sendsTo) {
    return `Sent to ${sendsTo}:\n${str(args?.prompt ?? args)}`;
  }
  const one = OUTGOING[name];
  if (one) {
    return one(args ?? {});
  }
  const out = stepsOf(name, args ?? {}, engine)
    .map(s => outgoing(s.tool, s.args))
    .filter((s): s is string => s !== null);
  return out.length ? out.join('\n\n') : null;
}

/** True when this call reads private data (PRIVATE_READS, or a step of a
 *  chain / shortcut that does). */
export function readsPrivate(
  name: string,
  args: Args,
  engine?: EngineLike,
): boolean {
  const one = PRIVATE_READS[name];
  if (one) {
    return one(args ?? {});
  }
  return stepsOf(name, args ?? {}, engine).some(s =>
    readsPrivate(s.tool, s.args),
  );
}

/**
 * Tools that ask the user every time they run (in the app, or natively on
 * this PC or the paired PC). Counted for the ask-rate limit.
 */
export const ASKING_TOOLS: readonly string[] = [
  // Workspace changes and memory changes (in the app).
  'file_create',
  'file_edit',
  'file_append',
  'file_patch',
  'file_undo',
  'memory_replace',
  'memory_restore',
  'tool_save',
  'tool_delete',
  // Phone actions (each asks), and a chain of them.
  'set_timer',
  'show_timers',
  'set_alarm',
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
  'phone_actions_chain',
  // This PC's own tools that ask natively (pc.rs, pc_extra.rs, outside.rs).
  'run_command',
  'open_file',
  'clipboard_read',
  'media_control',
  'print_file',
  'outside_files',
  // The paired PC's tools that ask there every time (link.rs).
  'pc_open',
  'pc_print',
  'pc_media',
  'pc_clipboard_read',
  'pc_run_command',
  'pc_workspace_write',
  'pc_workspace_append',
  'pc_workspace_undo',
  // Handing a task to another model (asks in the app every time).
  'ask_other_model',
];
/** Tools that may ask once per chat (the paired PC's workspace reads). */
const ASKS_ONCE = ['pc_workspace_list', 'pc_workspace_read'];

/** True when this call shows the user a question (or may: ASKS_ONCE). */
export function asksUser(name: string, engine?: EngineLike): boolean {
  return (
    ASKING_TOOLS.includes(name) ||
    ASKS_ONCE.includes(name) ||
    fieldsOf(engine)?.tool?.kind === 'shortcut'
  );
}

/** Characters a question must never show as they are (line tricks,
 *  bidi, zero-width): the same set as the PC's remote_ask::hidden_char. */
export function hiddenChar(c: string): boolean {
  const n = c.codePointAt(0) ?? 0;
  return (
    n < 0x20 ||
    (n >= 0x7f && n <= 0x9f) ||
    n === 0xad ||
    n === 0x61c ||
    n === 0x180e ||
    (n >= 0x200b && n <= 0x200f) ||
    (n >= 0x2028 && n <= 0x202e) ||
    (n >= 0x2060 && n <= 0x206f) ||
    n === 0xfeff ||
    (n >= 0xfff9 && n <= 0xfffb) ||
    (n >= 0xe0000 && n <= 0xe007f)
  );
}

/**
 * The model's thinking as a question shows it: the last THINKING_SHOWN
 * characters (what led to the request), line breaks and hidden characters
 * written as escapes, saying how much came before. Empty when there is none.
 */
export function thinkingShown(text: string | undefined | null): string {
  const chars = Array.from((text ?? '').trim());
  if (!chars.length) {
    return '';
  }
  const kept = chars.slice(-THINKING_SHOWN);
  const body = kept
    .map(c =>
      c === '\n'
        ? '\\n'
        : c === '\t'
          ? ' '
          : hiddenChar(c)
            ? `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`
            : c,
    )
    .join('');
  return chars.length > kept.length
    ? `[… ${chars.length - kept.length} characters before] ${body}`
    : body;
}

/**
 * Phrases in the model's thinking that call for a warning: hiding things
 * from the user, getting around checks or questions, logs switched off,
 * security switched off. Lower case; the thinking is lower-cased, with
 * curly quotes made straight and spaces joined, before they are looked
 * for. The same list is in the PC's approval.rs (a test keeps them equal).
 */
export const THINKING_RED_FLAGS: readonly string[] = [
  "won't notice",
  'will not notice',
  'wont notice',
  "doesn't need to know",
  'does not need to know',
  "don't tell the user",
  'do not tell the user',
  'not tell the user',
  'without the user knowing',
  'without them knowing',
  'without telling',
  'without asking',
  'hide it from',
  'hide this from',
  'hide from the user',
  'hide it so',
  'keep it secret',
  'keep this secret',
  'secretly',
  'covertly',
  'sneak',
  'bypass',
  'get around',
  'work around the approval',
  'work around the check',
  'circumvent',
  'evade',
  'avoid the approval',
  'avoid asking',
  'avoid the question',
  'skip the approval',
  'skip the check',
  'disable the log',
  'disable logging',
  'turn off logging',
  'delete the log',
  'clear the log',
  'remove the log',
  'cover my tracks',
  'cover tracks',
  'exfiltrate',
  'disable defender',
  'disable the antivirus',
  'disable antivirus',
  'trick the user',
];

/** The warning line for this thinking, or null. A warning sign only. */
export function thinkingWarning(
  text: string | undefined | null,
): string | null {
  const plain = (text ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ');
  return THINKING_RED_FLAGS.some(flag => plain.includes(flag))
    ? THINKING_WARNING
    : null;
}

/** Where a tool's question comes from: the raw thinking and the chat. */
export type ApprovalFrom = {thinking?: string; chat?: string};

/**
 * The parts of a tool's context its question shows (fileApprovalGate
 * turns them into the thinking as shown, the warning and the chat);
 * nothing without them.
 */
export function fromContext(ctx?: ApprovalFrom | null): {from?: ApprovalFrom} {
  return ctx && (ctx.thinking || ctx.chat)
    ? {from: {thinking: ctx.thinking, chat: ctx.chat}}
    : {};
}

// ---------------------------------------------------------------- per chat

type ChatState = {
  /** What private data was read first (a tool name), or null. */
  privateRead: string | null;
  /** When each question was asked (ms), for the ask-rate limit. */
  asks: number[];
  /** "Don't allow anything more in this chat". */
  noMore: boolean;
  /** The cloud notice was shown since the chat was marked. */
  cloudNoticeShown: boolean;
};
const chats = new Map<string, ChatState>();

function stateOf(chat: string): ChatState {
  let s = chats.get(chat);
  if (!s) {
    s = {privateRead: null, asks: [], noMore: false, cloudNoticeShown: false};
    chats.set(chat, s);
  }
  return s;
}

/** The chat read private data (with which tool). */
export function markPrivateRead(chat: string, tool: string): void {
  const s = stateOf(chat);
  if (!s.privateRead) {
    s.privateRead = tool;
    s.cloudNoticeShown = false;
  }
}
/** Which tool read private data in this chat, or null. */
export function privateReadIn(chat: string): string | null {
  return chats.get(chat)?.privateRead ?? null;
}
/** "Don't allow anything more in this chat". */
export function allowNothingMore(chat: string): void {
  stateOf(chat).noMore = true;
}
export function nothingMoreAllowed(chat: string): boolean {
  return chats.get(chat)?.noMore ?? false;
}
/** Notes one question; true when it is more than ASK_LIMIT within the window. */
export function noteAsk(chat: string, now: number): boolean {
  const s = stateOf(chat);
  s.asks = s.asks.filter(t => now - t < ASK_WINDOW_MS);
  s.asks.push(now);
  return s.asks.length > ASK_LIMIT;
}
/** After "Continue": the count starts again. */
export function resetAsks(chat: string): void {
  stateOf(chat).asks = [];
}
/** For tests. */
export function resetChatGuards(): void {
  chats.clear();
}

// ------------------------------------------------------------ the guard

export const REFUSED_NOTHING_MORE =
  'Refused: the user allowed nothing more in this chat. Do not call tools that ask or send anything; answer with what you have.';
export const REFUSED_OUTGOING =
  'The user said no: nothing was sent. Do not try to send it another way; answer with what you have.';
export const STOPPED_ASKING =
  'Stopped by the user: the model asked too many questions. Do not call more tools.';

/** One question the guard asks in the app. */
export type GuardQuestion =
  | {
      kind: 'outgoing';
      /** The facts: what goes out, exactly. */
      what: string;
      /** Which tool read private data in this chat. */
      privateRead: string;
      tool: string;
      thinking: string;
      warning: string | null;
      chat: string;
    }
  | {kind: 'too_many'; count: number; chat: string};

export interface GuardCall {
  name: string;
  args: Args;
  engine?: EngineLike;
  /** The model's thinking from just before this request (raw). */
  thinking?: string;
}
export type GuardVerdict =
  | {ok: true}
  | {ok: false; message: string; stop?: boolean};

export interface ToolGuard {
  readonly chat: string;
  before(call: GuardCall): Promise<GuardVerdict>;
  after(call: GuardCall, result: TalentResult): void;
  /** Before each request to the chat's model. */
  beforeModelRequest(): void;
}

export interface GuardDeps {
  chat: string;
  /** Asks in the app; true only for Allow / Continue. */
  ask: (question: GuardQuestion) => Promise<boolean>;
  /** True when the chat's model runs on a cloud server. */
  isCloudModel?: () => boolean;
  /** Shows one line in the chat. */
  notice?: (text: string) => void;
  now?: () => number;
}

export const cloudNotice = (tool: string) =>
  `This chat read private data (${tool}); it goes to the cloud model you chose with the rest of the chat.`;

/** The guard for one chat (the chat loop's, or a loop plan's). */
export function makeToolGuard(deps: GuardDeps): ToolGuard {
  const {chat} = deps;
  const now = deps.now ?? Date.now;
  return {
    chat,
    async before({name, args, engine, thinking}) {
      const out = outgoing(name, args, engine);
      const asks = asksUser(name, engine);
      const guarded = asks || out !== null || readsPrivate(name, args, engine);
      if (nothingMoreAllowed(chat) && guarded) {
        return {ok: false, message: REFUSED_NOTHING_MORE};
      }
      const marked = privateReadIn(chat);
      const guardAsks = marked !== null && out !== null;
      // The guard's own question and the tool's own each count.
      const count = (asks ? 1 : 0) + (guardAsks ? 1 : 0);
      for (let i = 0; i < count; i++) {
        if (noteAsk(chat, now())) {
          const go = await deps.ask({
            kind: 'too_many',
            count: ASK_LIMIT,
            chat,
          });
          if (!go) {
            return {ok: false, message: STOPPED_ASKING, stop: true};
          }
          resetAsks(chat);
          noteAsk(chat, now());
        }
      }
      // Answered "allow nothing more" meanwhile (another question).
      if (nothingMoreAllowed(chat) && guarded) {
        return {ok: false, message: REFUSED_NOTHING_MORE};
      }
      if (guardAsks) {
        const allowed = await deps.ask({
          kind: 'outgoing',
          what: out,
          privateRead: marked,
          tool: name,
          thinking: thinkingShown(thinking),
          warning: thinkingWarning(thinking),
          chat,
        });
        if (!allowed) {
          return {ok: false, message: REFUSED_OUTGOING};
        }
      }
      return {ok: true};
    },
    after({name, args, engine}, result) {
      if (result.type !== 'error' && readsPrivate(name, args, engine)) {
        markPrivateRead(chat, name);
      }
    },
    beforeModelRequest() {
      const marked = privateReadIn(chat);
      if (!marked || !deps.isCloudModel?.()) {
        return;
      }
      const s = stateOf(chat);
      if (!s.cloudNoticeShown) {
        s.cloudNoticeShown = true;
        deps.notice?.(cloudNotice(marked));
      }
    },
  };
}
