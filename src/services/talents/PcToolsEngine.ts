/**
 * "On your PC" (phone only): the paired Home PC's tools, asked over the
 * home link (request "tool", src-tauri/src/link.rs; design:
 * docs/design/phone-uses-pc-tools.md, stages 1 to 3). Each tool is off
 * until switched on in Toolbox, like every tool; the PC refuses unless its
 * user allows device tools there and this device "May read" (the reads),
 * "May act" (the actions) or "May run commands" (pc_run_command). The PC
 * checks everything itself (a fixed list, workspace file names only, a
 * fixed list of media keys, its own command check, caps) and runs the same
 * code as its own tools.
 *
 * - pc_info: the PC's system, memory, disks and graphics.
 * - pc_workspace_list: the files in the PC's workspace folder.
 * - pc_workspace_read: one workspace file's text (text files and
 *   documents, at most 256 KB). Reading the workspace asks on the PC once
 *   per chat (this chat's random id is sent, never the chat itself); the
 *   PC shows a notification for each file read.
 * - pc_open, pc_print: open or print one workspace file with its app on
 *   the PC; pc_media: press a media key there; pc_clipboard_read: the
 *   PC's clipboard text. Each asks on the PC every time ("“<this device>”
 *   asks to …"; a device that may answer the PC's questions, this one
 *   too, can answer it) and the PC shows a notification for each.
 * - pc_run_command: one command run on the PC (PowerShell on Windows) in
 *   its workspace folder, at most 60 s. The PC shows the whole command
 *   and asks every time (never "always"), naming this device; it shows a
 *   notification and logs the whole command.
 *
 * What comes back is the PC's data (a file's or the clipboard's text, a
 * command's output, without the PC's own paths), so it is wrapped as
 * untrusted (it can hold instructions). The Home PC PIN,
 * when set, is asked first.
 */
import {v4 as uuidv4} from 'uuid';

import {askPcTool} from '../homeLink/homeLink';
import {unlockHomePc} from '../homeLink/homePcLock';
import {describePc, MEDIA_ACTIONS} from './DesktopToolsEngine';
import {pickHomePc} from './PcPictureEngine';
import {wrapUntrusted} from './untrustedContent';
import {
  TalentEngine,
  TalentExecuteContext,
  TalentResult,
  ToolDefinition,
} from './types';

export const PC_TOOL_NAMES = [
  'pc_info',
  'pc_workspace_list',
  'pc_workspace_read',
  'pc_open',
  'pc_print',
  'pc_media',
  'pc_clipboard_read',
  'pc_run_command',
] as const;
export type PcTool = (typeof PC_TOOL_NAMES)[number];

/** The phone's tool name → the PC's (link.rs REMOTE_TOOLS). */
export const REMOTE_NAMES: Record<PcTool, string> = {
  pc_info: 'pc_info',
  pc_workspace_list: 'workspace_list',
  pc_workspace_read: 'workspace_read',
  pc_open: 'pc_open',
  pc_print: 'pc_print',
  pc_media: 'pc_media',
  pc_clipboard_read: 'pc_clipboard_read',
  pc_run_command: 'pc_run_command',
};

/** The tools that act on the PC (the PC's "May act"; each asks there). */
export const PC_ACT_TOOLS: readonly PcTool[] = [
  'pc_open',
  'pc_print',
  'pc_media',
  'pc_clipboard_read',
];

/** The tool that runs a command on the PC (the PC's "May run commands"). */
export const PC_COMMAND_TOOLS: readonly PcTool[] = ['pc_run_command'];

/** As the PC checks it (pc.rs check_command): characters and lines. */
export const MAX_COMMAND = 2000;
export const MAX_COMMAND_LINES = 20;

const FILE_TOOLS: readonly PcTool[] = [
  'pc_workspace_read',
  'pc_open',
  'pc_print',
];

const STOP =
  'Answer the user now; do not call this tool again unless they ask.';

const DEFINITIONS: Record<PcTool, ToolDefinition['function']> = {
  pc_info: {
    name: 'pc_info',
    description:
      "Information about the user's paired Home PC: system, processor, memory, disks and graphics cards (read only).",
    parameters: {type: 'object', properties: {}, required: []},
  },
  pc_workspace_list: {
    name: 'pc_workspace_list',
    description:
      "List the files in the workspace folder on the user's paired Home PC (DesktopAgent's own folder; names, sizes, dates). The PC may ask its user once for this chat.",
    parameters: {type: 'object', properties: {}, required: []},
  },
  pc_workspace_read: {
    name: 'pc_workspace_read',
    description:
      "Read one file from the workspace folder on the user's paired Home PC: text files and documents (Word, Excel, PowerPoint, OpenDocument, PDF) as text, at most 256 KB. Use the exact file name from pc_workspace_list (no folders or paths). The PC may ask its user once for this chat.",
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Exact workspace file name on the PC, e.g. budget.xlsx.',
        },
      },
      required: ['filename'],
    },
  },
  pc_open: {
    name: 'pc_open',
    description:
      "Open one file from the workspace folder on the user's paired Home PC in its app there (documents, pictures, text and media; never programs or scripts). Use the exact file name from pc_workspace_list. The PC asks its user every time.",
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Exact workspace file name on the PC, e.g. report.docx.',
        },
      },
      required: ['filename'],
    },
  },
  pc_print: {
    name: 'pc_print',
    description:
      "Print one document or picture from the workspace folder on the user's paired Home PC, with the PC's default printer (its own app prints it). Use the exact file name from pc_workspace_list. The PC asks its user every time.",
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Exact workspace file name on the PC, e.g. letter.docx.',
        },
      },
      required: ['filename'],
    },
  },
  pc_media: {
    name: 'pc_media',
    description:
      "Press a media key on the user's paired Home PC for whatever plays there (music, video): play_pause, next, previous, stop, volume_up, volume_down, mute. The PC asks its user every time.",
    parameters: {
      type: 'object',
      properties: {
        action: {type: 'string', enum: Object.keys(MEDIA_ACTIONS)},
      },
      required: ['action'],
    },
  },
  pc_clipboard_read: {
    name: 'pc_clipboard_read',
    description:
      "Read the text on the clipboard of the user's paired Home PC (what they copied there). The PC shows the text and asks its user every time.",
    parameters: {type: 'object', properties: {}, required: []},
  },
  pc_run_command: {
    name: 'pc_run_command',
    description:
      "Run one command on the user's paired Home PC (PowerShell on Windows, a shell on Linux) in its workspace folder; stopped after 60 s; returns the exit code and output (at most 32 KB). At most 20 lines and 2000 characters; no hidden or control characters. The PC shows the whole command and asks its user every time. Only when the user asked for something on their PC that needs a command.",
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The exact command to run on the PC, e.g. Get-Date.',
        },
      },
      required: ['command'],
    },
  },
};

function homePc(): string | undefined {
  try {
    const {modelStore, serverStore} = require('../../store');
    return pickHomePc(serverStore.servers, modelStore.activeModel?.serverId);
  } catch {
    return undefined;
  }
}

/**
 * A random id per chat, sent instead of the chat's own id (the PC learns
 * nothing about the chat). Kept while the app runs: after a restart the PC
 * asks again.
 */
const chatIds = new Map<string, string>();
export function chatIdFor(session: string | null | undefined): string {
  const key = session || '(no chat)';
  let id = chatIds.get(key);
  if (!id) {
    id = uuidv4();
    chatIds.set(key, id);
  }
  return id;
}

function activeChat(): string | null {
  try {
    return require('../../store').chatSessionStore.activeSessionId ?? null;
  } catch {
    return null;
  }
}

const kb = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;

/** The PC's answer as text for the model (the PC's data, not wrapped yet). */
export function describeResult(tool: PcTool, result: any): string {
  if (tool === 'pc_info') {
    return describePc(result || {});
  }
  if (tool === 'pc_workspace_list') {
    const files: any[] = Array.isArray(result?.files) ? result.files : [];
    if (files.length === 0) {
      return 'The workspace on the PC has no files.';
    }
    const lines = files.map(
      f =>
        `${String(f.name)} (${kb(Number(f.size) || 0)}${f.modifiedMs ? `, ${new Date(Number(f.modifiedMs)).toISOString().slice(0, 10)}` : ''})`,
    );
    const more = Number(result?.more) || 0;
    return [
      `${files.length} file${files.length === 1 ? '' : 's'} in the workspace on the PC:`,
      ...lines,
      ...(more ? [`… and ${more} more`] : []),
    ].join('\n');
  }
  if (tool === 'pc_run_command') {
    const output = typeof result?.output === 'string' ? result.output : '';
    const ended = result?.timedOut
      ? 'Stopped after 60 s.'
      : `Exit code: ${result?.exitCode ?? 'none'}.`;
    return `Ran on the PC (its user allowed it there). ${ended}\nOutput:\n${output.trim() ? output : '(no output)'}`;
  }
  const text = typeof result?.text === 'string' ? result.text : '';
  if (tool === 'pc_clipboard_read') {
    return text;
  }
  return result?.cut
    ? `${text}\n[… cut: the file is longer than 256 KB]`
    : text;
}

/** What the model is told when the PC refused or couldn't be reached. */
export function refusal(tool: PcTool, error: string): string {
  if (/said no/i.test(error)) {
    return `The Home PC's user said no to ${tool} (asked on the PC): ${error} Tell the user; don't ask again unless they want to. ${STOP}`;
  }
  const needs = PC_COMMAND_TOOLS.includes(tool)
    ? `"Let paired devices use this PC's tools" and this device's "May run commands" allowed there; each command is asked on the PC`
    : PC_ACT_TOOLS.includes(tool)
      ? `"Let paired devices use this PC's tools" and this device's "May act" allowed there; each action is asked on the PC`
      : `"Let paired devices use this PC's tools" and this device's "May read" allowed there, and reading the workspace allowed for this chat`;
  return `The Home PC did not answer ${tool}: ${error}. Tell the user (the PC must be on with the home link, ${needs}). ${STOP}`;
}

/** What the model is told after an action the PC did (not the PC's data). */
export function doneText(
  tool: PcTool,
  args: {file?: string; key?: string},
): string | undefined {
  if (tool === 'pc_open') {
    return `Opened ${args.file} on the PC (the user allowed it there).`;
  }
  if (tool === 'pc_print') {
    return `Sent ${args.file} to the PC's printer (the user allowed it there; its app may show a print window).`;
  }
  if (tool === 'pc_media') {
    return `Done on the PC: ${MEDIA_ACTIONS[args.key ?? ''] ?? args.key} (the user allowed it there).`;
  }
  return undefined;
}

export class PcToolsEngine implements TalentEngine {
  constructor(readonly name: PcTool) {}

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const toolArgs: {file?: string; key?: string; command?: string} = {};
    if (FILE_TOOLS.includes(this.name)) {
      const file =
        typeof args.filename === 'string' ? args.filename.trim() : '';
      if (!file) {
        return {
          type: 'error',
          summary: `${this.name}: give the \`filename\`: a file name from pc_workspace_list.`,
          errorMessage:
            'Give the `filename`: a file name from pc_workspace_list.',
        };
      }
      toolArgs.file = file;
    }
    if (this.name === 'pc_media') {
      const key = String(args.action ?? '');
      if (!MEDIA_ACTIONS[key]) {
        const keys = Object.keys(MEDIA_ACTIONS).join(', ');
        return {
          type: 'error',
          summary: `pc_media: \`action\` must be one of: ${keys}.`,
          errorMessage: `\`action\` must be one of: ${keys}.`,
        };
      }
      toolArgs.key = key;
    }
    if (this.name === 'pc_run_command') {
      const command =
        typeof args.command === 'string' ? args.command.trim() : '';
      const problem = !command
        ? 'Give the `command` to run on the PC.'
        : command.length > MAX_COMMAND
          ? `The command is too long (at most ${MAX_COMMAND} characters).`
          : command.split('\n').length > MAX_COMMAND_LINES
            ? `The command has too many lines (at most ${MAX_COMMAND_LINES}).`
            : undefined;
      if (problem) {
        return {
          type: 'error',
          summary: `pc_run_command: ${problem}`,
          errorMessage: problem,
        };
      }
      toolArgs.command = command;
    }
    const pc = homePc();
    if (!pc) {
      return {
        type: 'text',
        summary: `No Home PC is paired, so the PC's tools can't be used. Pair it by scanning its QR code (on the PC: Settings, Use this PC's model from your phone), then allow this device's tools there. ${STOP}`,
      };
    }
    // The PC's PIN, if set on this device and locked: asked first.
    if (!(await unlockHomePc(pc))) {
      return {
        type: 'text',
        summary: `The Home PC is locked with a PIN on this device and it wasn't entered, so nothing was asked of the PC. ${STOP}`,
      };
    }
    const asked = askPcTool(
      pc,
      REMOTE_NAMES[this.name],
      chatIdFor(activeChat()),
      toolArgs,
    );
    // The chat's Stop stops waiting here (the PC may still be asking).
    const stopped = new Promise<'stopped'>(resolve => {
      if (ctx?.signal?.aborted) {
        resolve('stopped');
      }
      ctx?.signal?.addEventListener('abort', () => resolve('stopped'));
    });
    const answer = await Promise.race([asked, stopped]);
    if (answer === 'stopped') {
      return {type: 'text', summary: `Stopped waiting for the PC. ${STOP}`};
    }
    if (!answer.ok) {
      return {type: 'text', summary: refusal(this.name, answer.error)};
    }
    const done = doneText(this.name, toolArgs);
    if (done) {
      return {type: 'text', summary: `${done} ${STOP}`};
    }
    return {
      type: 'text',
      summary: wrapUntrusted(describeResult(this.name, answer.result)),
    };
  }

  toToolDefinition(): ToolDefinition {
    return {type: 'function', function: DEFINITIONS[this.name]};
  }
}
