/**
 * Lets a model save or delete a custom tool (saved instructions or a
 * shortcut, see customTools.ts). The user approves the full definition
 * first; a saved tool starts switched off, and the user turns it on in
 * Toolbox. Replacing a tool also switches it off again, so a changed tool
 * never runs before the user has seen it.
 */
import {requestFileApproval} from './fileApprovalGate';
import {
  builtInToolNames,
  checkCustomTool,
  deleteCustomTool,
  describeCustomTool,
  listCustomTools,
  saveCustomTool,
} from './customTools';
import type {
  TalentEngine,
  TalentExecuteContext,
  TalentResult,
  ToolDefinition,
} from './types';
import {
  readGlobalTools,
  writeGlobalTools,
} from '../../utils/globalToolSettings';

export const TOOL_MAKER_NAMES = ['tool_save', 'tool_delete'] as const;
type ToolMakerName = (typeof TOOL_MAKER_NAMES)[number];

const err = (summary: string): TalentResult => ({
  type: 'error',
  summary,
  errorMessage: summary,
});

export class ToolMakerEngine implements TalentEngine {
  constructor(readonly name: ToolMakerName) {}

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const existing = await listCustomTools();
    if (this.name === 'tool_delete') {
      const name = typeof args?.name === 'string' ? args.name.trim() : '';
      const tool = existing.find(t => t.name === name);
      if (!tool) {
        return err(
          `tool_delete: no custom tool is called "${name}". Custom tools: ${existing.map(t => t.name).join(', ') || 'none'}.`,
        );
      }
      const approved = await requestFileApproval(
        {
          action: 'custom_tool',
          filename: `Delete the custom tool "${name}"?`,
          content: describeCustomTool(tool),
        },
        ctx?.signal,
      );
      if (!approved || ctx?.signal?.aborted) {
        return {type: 'text', summary: `The user said no. "${name}" was kept.`};
      }
      await deleteCustomTool(name);
      return {type: 'text', summary: `Deleted the custom tool "${name}".`};
    }

    const input = {...(args ?? {}), createdBy: 'model'};
    const replacing = existing.some(
      t =>
        t.name ===
        String(args?.name ?? '')
          .trim()
          .toLowerCase(),
    );
    const checked = checkCustomTool(input, {
      builtIns: builtInToolNames(),
      existing: existing.map(t => t.name),
      replacing: replacing ? String(args.name).trim().toLowerCase() : undefined,
    });
    if (typeof checked === 'string') {
      return err(`tool_save: ${checked}`);
    }
    const approved = await requestFileApproval(
      {
        action: 'custom_tool',
        filename: `${replacing ? 'Replace' : 'Save'} the custom tool "${checked.name}"? It starts switched off.`,
        content: describeCustomTool(checked),
      },
      ctx?.signal,
    );
    if (!approved || ctx?.signal?.aborted) {
      return {type: 'text', summary: 'The user said no. Nothing was saved.'};
    }
    const saved = await saveCustomTool(
      input,
      replacing ? checked.name : undefined,
    );
    if (typeof saved === 'string') {
      return err(`tool_save: ${saved}`);
    }
    if (replacing) {
      const enabled = await readGlobalTools();
      if (enabled.includes(saved.name)) {
        await writeGlobalTools(enabled.filter(n => n !== saved.name));
      }
    }
    return {
      type: 'text',
      summary: `Saved the custom tool "${saved.name}", switched off. The user can turn it on in Toolbox → Custom tools. Tell them so in one short sentence.`,
    };
  }

  toToolDefinition(): ToolDefinition {
    if (this.name === 'tool_delete') {
      return {
        type: 'function',
        function: {
          name: 'tool_delete',
          description:
            'Delete a custom tool (one made with tool_save or in Toolbox). The user approves it first. ' +
            "How: `name` is the custom tool's exact name.",
          parameters: {
            type: 'object',
            properties: {name: {type: 'string'}},
            required: ['name'],
          },
        },
      };
    }
    return {
      type: 'function',
      function: {
        name: 'tool_save',
        description:
          'Save a reusable custom tool when the user asks you to remember a routine or how to do something. ' +
          'Two kinds: "instructions" stores a how-to you can read back later; "shortcut" stores steps that call built-in tools in order, ' +
          'with {{fill-ins}} for values given each time. The user sees the full definition and approves it; it starts switched off. ' +
          'How: `kind`, `name` (lowercase_with_underscores), `description` (when to use it), then `instructions` (text) or `steps` ' +
          '(a list of {"tool": "<built-in tool name>", "args": {...}}; at most 8; a step that opens another app must be last). ' +
          "Saving with an existing custom tool's name replaces it.",
        parameters: {
          type: 'object',
          properties: {
            kind: {type: 'string', enum: ['instructions', 'shortcut']},
            name: {type: 'string'},
            description: {type: 'string'},
            instructions: {type: 'string'},
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  tool: {type: 'string'},
                  args: {type: 'object'},
                },
                required: ['tool'],
              },
            },
          },
          required: ['kind', 'name', 'description'],
        },
      },
    };
  }
}
