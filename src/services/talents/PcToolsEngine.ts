/**
 * "On your PC" (phone only): the paired Home PC's read-only tools, asked
 * over the home link (request "tool", src-tauri/src/link.rs; design:
 * docs/design/phone-uses-pc-tools.md, stage 1). Each tool is off until
 * switched on in Toolbox, like every tool; the PC refuses unless its user
 * allows device tools there and this device "May read". The PC checks
 * everything itself (a fixed list, workspace file names only, caps) and
 * runs the same code as its own tools.
 *
 * - pc_info: the PC's system, memory, disks and graphics.
 * - pc_workspace_list: the files in the PC's workspace folder.
 * - pc_workspace_read: one workspace file's text (text files and
 *   documents, at most 256 KB). Reading the workspace asks on the PC once
 *   per chat (this chat's random id is sent, never the chat itself); the
 *   PC shows a notification for each file read.
 *
 * What comes back is the PC's data, so it is wrapped as untrusted (a file
 * can hold instructions). The Home PC PIN, when set, is asked first.
 */
import {v4 as uuidv4} from 'uuid';

import {askPcTool} from '../homeLink/homeLink';
import {unlockHomePc} from '../homeLink/homePcLock';
import {describePc} from './DesktopToolsEngine';
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
] as const;
export type PcTool = (typeof PC_TOOL_NAMES)[number];

/** The phone's tool name → the PC's (link.rs REMOTE_TOOLS). */
export const REMOTE_NAMES: Record<PcTool, string> = {
  pc_info: 'pc_info',
  pc_workspace_list: 'workspace_list',
  pc_workspace_read: 'workspace_read',
};

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
  const text = typeof result?.text === 'string' ? result.text : '';
  return result?.cut
    ? `${text}\n[… cut: the file is longer than 256 KB]`
    : text;
}

export class PcToolsEngine implements TalentEngine {
  constructor(readonly name: PcTool) {}

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const toolArgs: {file?: string} = {};
    if (this.name === 'pc_workspace_read') {
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
      return {
        type: 'text',
        summary: `The Home PC did not answer ${this.name}: ${answer.error}. Tell the user (the PC must be on with the home link, "Let paired devices use this PC's tools" and this device's "May read" allowed there, and reading the workspace allowed for this chat). ${STOP}`,
      };
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
