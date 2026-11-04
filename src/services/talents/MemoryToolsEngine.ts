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

// Short how-tos: small models follow these literally.
const DESCRIPTIONS: Record<MemoryAction, string> = {
  memory_get:
    'Read your long-term memory: notes you keep between chats, one per line. ' +
    'Call it when the user asks what you remember, and always before memory_replace. ' +
    'Its first line explains the format; follow it.',
  memory_replace:
    'Change your long-term memory (add, fix or remove notes). How: 1) call memory_get; ' +
    '2) write the WHOLE new memory in `content`, one note per line, keeping every note that ' +
    'should stay and only changing what the user asked; 3) put the text memory_get returned in ' +
    '`expected_previous`. The user approves. Example: to rename yourself, change only the line ' +
    'with your name.',
  memory_history:
    'List saved earlier versions of your memory, newest first (for memory_restore).',
  memory_restore:
    'Go back to an earlier version of your memory. Only when the user asks. How: ' +
    '1) memory_history; 2) put one of its version names in `snapshot`. The user approves.',
};
const CONTENT_HELP =
  'The whole new memory, one note per line. Keep every note that should stay and keep ' +
  'the line breaks: this replaces all of it.';
const PREVIOUS_HELP =
  'The text memory_get returned, copied exactly with its line breaks.';
const SNAPSHOT_HELP = 'A version name copied exactly from memory_history.';

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
      ? {
          content: {type: 'string', description: CONTENT_HELP},
          expected_previous: {type: 'string', description: PREVIOUS_HELP},
        }
      : this.name === 'memory_restore'
        ? {snapshot: {type: 'string', description: SNAPSHOT_HELP}}
        : {};
    return {type: 'function', function: {
      name: this.name,
      description: DESCRIPTIONS[this.name],
      parameters: {type: 'object', properties, required: this.name === 'memory_replace' ? ['content', 'expected_previous'] : this.name === 'memory_restore' ? ['snapshot'] : []},
    }};
  }
}
