import type {TalentEngine, TalentExecuteContext, TalentResult, ToolDefinition} from './types';
import {memoryGet, memoryReplace, memoryHistory, memoryReadSnapshot} from './agentMemory';
import {requestFileApproval} from './fileApprovalGate';

/**
 * The stale-edit check compares words, not spacing: small models often
 * flatten line breaks when copying text back. Different wording still
 * fails, and the user approves the change either way.
 */
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();
const sameText = (given: unknown, current: string) =>
  typeof given === 'string' && normalise(given) === normalise(current);

type MemoryAction = 'memory_get' | 'memory_replace' | 'memory_history' | 'memory_restore';

export class MemoryToolsEngine implements TalentEngine {
  readonly name: MemoryAction;
  constructor(name: MemoryAction) { this.name = name; }

  async execute(args: Record<string, any>, ctx?: TalentExecuteContext): Promise<TalentResult> {
    try {
      if (ctx?.signal?.aborted) throw new Error('Cancelled');
      if (this.name === 'memory_get') {
        return {type: 'text', summary: await memoryGet()};
      }
      if (this.name === 'memory_history') {
        const snapshots = await memoryHistory();
        return {type: 'text', summary: snapshots.length ? snapshots.slice(0, 100).join('\n') : 'No memory snapshots'};
      }
      const previous = await memoryGet();
      const next = this.name === 'memory_restore'
        ? await memoryReadSnapshot(args.snapshot)
        : args.content;
      if (typeof next !== 'string') throw new Error('Memory content must be text');
      if (this.name === 'memory_replace' && !sameText(args.expected_previous, previous)) {
        // Hand back the current memory so the model can retry with it.
        throw new Error(
          'Memory changed or was not reviewed: expected_previous must match the current memory. ' +
            'Current memory (copy it exactly into expected_previous, keeping line breaks):\n' +
            previous,
        );
      }
      const approved = await requestFileApproval({
        action: 'file_edit', filename: 'PocketAgent memory (internal)',
        previous, content: next,
      }, ctx?.signal);
      if (!approved || ctx?.signal?.aborted) throw new Error('Memory change denied or cancelled');
      await memoryReplace(next, previous);
      return {type: 'text', summary: 'Memory updated with a history snapshot'};
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {type: 'error', summary: message, errorMessage: message};
    }
  }

  toToolDefinition(): ToolDefinition {
    const properties = this.name === 'memory_replace'
      ? {content: {type: 'string', description: 'Complete new memory including editable first-line sigil mapping'}, expected_previous: {type: 'string', description: 'The content returned by memory_get, copied exactly (keep its line breaks); prevents stale edits'}}
      : this.name === 'memory_restore'
        ? {snapshot: {type: 'string', description: 'Snapshot name returned by memory_history'}}
        : {};
    return {type: 'function', function: {
      name: this.name,
      description: this.name === 'memory_get' ? 'Read the complete private persistent assistant memory, including its user-editable self-describing format' :
        this.name === 'memory_history' ? 'List previous memory snapshots' :
        this.name === 'memory_restore' ? 'Restore a prior memory snapshot after explicit user approval' :
        'Replace the complete persistent memory after reviewing the current version and explicit user approval. Never assume fixed line numbers or sigils.',
      parameters: {type: 'object', properties, required: this.name === 'memory_replace' ? ['content', 'expected_previous'] : this.name === 'memory_restore' ? ['snapshot'] : []},
    }};
  }
}
