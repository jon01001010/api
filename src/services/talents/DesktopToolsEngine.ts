/**
 * The PC's own tools (desktop app only; registered there, not on the
 * phone). Each starts off (Toolbox switch). The native side does the work
 * and asks itself where needed (src-tauri/src/pc.rs, SECURITY.md rule 6):
 *
 * - pc_info: memory, disk space, graphics cards, processor, system. Read only.
 * - run_command: one command, shown in full in a native dialog every time.
 * - open_file: a workspace file in its app (documents, pictures, text and
 *   media only; never programs or scripts). Asks.
 * - clipboard_read: the clipboard's text, after a native dialog showing it.
 * - media_control: play / pause, next, previous, volume. Asks in the app.
 * - print_file: a workspace document or picture printed. Asks.
 */
import {TalentEngine, TalentResult, ToolDefinition} from './types';
import {requestFileApproval} from './fileApprovalGate';

export const DESKTOP_TOOL_NAMES = [
  'pc_info',
  'run_command',
  'open_file',
  'clipboard_read',
  'media_control',
  'print_file',
] as const;
type DesktopTool = (typeof DESKTOP_TOOL_NAMES)[number];

const invoke = <T>(cmd: string, args?: object): Promise<T> => {
  const t = (globalThis as any).__TAURI_INTERNALS__;
  if (!t) {
    return Promise.reject(new Error('This tool needs the desktop app.'));
  }
  return t.invoke(cmd, args) as Promise<T>;
};

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

const STOP =
  'Answer the user now; do not call this tool again unless they ask.';

export function describePc(info: any): string {
  const lines = [
    `System: ${info.system || 'unknown'}`,
    `Processor: ${info.processor || 'unknown'} (${info.cores} threads)`,
    `Memory: ${gb(info.totalMemory)} total, ${gb(info.availableMemory)} free`,
    ...(info.gpus || []).map(
      (g: any) =>
        `Graphics: ${g.name}${g.shared ? " (uses the PC's memory)" : `, ${gb(g.totalMemory)} of its own (${gb(g.freeMemory)} free)`}`,
    ),
    ...(info.gpus?.length
      ? []
      : ['Graphics: none found (models run in memory)']),
    ...(info.disks || []).map(
      (d: any) =>
        `Disk ${d.mount}${d.name ? ` (${d.name})` : ''}: ${gb(d.free)} free of ${gb(d.total)}`,
    ),
    `Up for ${Math.round((info.uptimeSeconds || 0) / 3600)} hours`,
  ];
  return lines.join('\n');
}

export const MEDIA_ACTIONS: Record<string, string> = {
  play_pause: 'play or pause',
  next: 'skip to the next track',
  previous: 'go back a track',
  stop: 'stop the music',
  volume_up: 'turn the volume up',
  volume_down: 'turn the volume down',
  mute: 'mute or unmute',
};

const DEFINITIONS: Record<DesktopTool, ToolDefinition['function']> = {
  clipboard_read: {
    name: 'clipboard_read',
    description:
      "Read the text the user copied (the clipboard). The user sees the text and must allow it first. Use it when they say 'what I copied' or 'the clipboard'.",
    parameters: {type: 'object', properties: {}, required: []},
  },
  media_control: {
    name: 'media_control',
    description:
      'Press a media key on this PC for whatever is playing (music, video): play_pause, next, previous, stop, volume_up, volume_down, mute. The user is asked first.',
    parameters: {
      type: 'object',
      properties: {
        action: {type: 'string', enum: Object.keys(MEDIA_ACTIONS)},
      },
      required: ['action'],
    },
  },
  print_file: {
    name: 'print_file',
    description:
      'Print a workspace document or picture on the default printer (its own app prints it). The user is asked first.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Exact workspace file name, e.g. letter.docx.',
        },
      },
      required: ['filename'],
    },
  },
  pc_info: {
    name: 'pc_info',
    description:
      "Read this PC's hardware: system version, processor, memory, graphics cards and their memory, free disk space. Read only. Use it to answer questions about the PC or to judge which model size fits.",
    parameters: {type: 'object', properties: {}, required: []},
  },
  run_command: {
    name: 'run_command',
    description:
      'Run one command on this PC (PowerShell on Windows, the shell on Linux), in the workspace folder. The user sees the whole command and must allow it every time; prefer read-only commands and explain what it does first. Output comes back (cut if long; stopped after 60 s). On Windows chain commands with ; (Windows PowerShell has no &&).',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The exact command, e.g. "Get-Volume" or "ipconfig".',
        },
      },
      required: ['command'],
    },
  },
  open_file: {
    name: 'open_file',
    description:
      'Open a workspace file in its app on this PC (e.g. a .docx in Word, a picture in the photo viewer). Documents, pictures, text and media only. The user is asked first.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description:
            'Exact workspace file name (from file_list), e.g. report.docx.',
        },
      },
      required: ['filename'],
    },
  },
};

export class DesktopToolsEngine implements TalentEngine {
  constructor(readonly name: DesktopTool) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    try {
      if (this.name === 'pc_info') {
        return {type: 'text', summary: describePc(await invoke('pc_info'))};
      }
      if (this.name === 'run_command') {
        const command = typeof args.command === 'string' ? args.command : '';
        if (!command.trim()) {
          throw new Error('Give the `command` to run.');
        }
        const ran = await invoke<{
          exitCode: number | null;
          output: string;
          timedOut: boolean;
        }>('run_command', {command});
        const how = ran.timedOut
          ? 'Stopped after 60 s.'
          : `Finished (exit code ${ran.exitCode ?? 'unknown'}).`;
        return {
          type: 'text',
          summary: `${how}\n${ran.output.trim() || '(no output)'}\n${STOP}`,
        };
      }
      if (this.name === 'clipboard_read') {
        const text = await invoke<string>('clipboard_read');
        return {
          type: 'text',
          summary: `The clipboard (the user allowed it):\n${text}`,
        };
      }
      if (this.name === 'media_control') {
        const action = String(args.action ?? '');
        const what = MEDIA_ACTIONS[action];
        if (!what) {
          throw new Error(
            `\`action\` must be one of: ${Object.keys(MEDIA_ACTIONS).join(', ')}.`,
          );
        }
        const ok = await requestFileApproval({
          action: 'phone_action',
          filename: `On this PC: ${what}?`,
          content: '',
        });
        if (!ok) {
          throw new Error('The user said no.');
        }
        await invoke('media_key', {key: action});
        return {type: 'text', summary: `Done: ${what}. ${STOP}`};
      }
      const filename = typeof args.filename === 'string' ? args.filename : '';
      if (this.name === 'print_file') {
        await invoke('print_file', {name: filename});
        return {
          type: 'text',
          summary: `Sent ${filename} to the printer (its app may show a print window). ${STOP}`,
        };
      }
      await invoke('open_workspace_file', {name: filename});
      return {type: 'text', summary: `Opened ${filename} on the PC. ${STOP}`};
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      const said = /said no/i.test(message);
      return {
        type: said ? 'text' : 'error',
        summary: said
          ? `The user said no. Nothing was done. Do not try it again unless they ask.`
          : `${this.name}: ${message}`,
        ...(said ? {} : {errorMessage: message}),
      } as TalentResult;
    }
  }

  toToolDefinition(): ToolDefinition {
    return {type: 'function', function: DEFINITIONS[this.name]};
  }
}
