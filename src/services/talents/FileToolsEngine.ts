import * as RNFS from '@dr.pogodin/react-native-fs';
import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  TalentExecuteContext,
} from './types';
import {
  assertEditableTextName,
  checkText,
  ensureWorkspace,
  FILE_ROOT,
  getWorkspaceLimits,
  isEditableTextName,
  readWorkspace,
  safeWorkspaceName,
  utf8Bytes,
  workspacePath,
} from './fileWorkspace';
import {requestFileApproval, type FileProposal} from './fileApprovalGate';
import {diffLines, splitLines} from './lineDiff';
import {
  listFileHistory,
  readFileSnapshot,
  saveFileSnapshot,
} from './fileHistory';

export const FILE_OPERATIONS = [
  'file_list',
  'file_read',
  'file_create',
  'file_edit',
  'file_info',
  'file_search',
  'file_read_range',
  'file_append',
  'file_patch',
  'file_diff',
  'file_history',
  'file_undo',
] as const;
type FileOperation = (typeof FILE_OPERATIONS)[number];
type WriteAction = FileProposal['action'];

function failed(error: unknown): TalentResult {
  const message = error instanceof Error ? error.message : String(error);
  return {type: 'error', summary: message, errorMessage: message};
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    count++;
  }
  return count;
}

export class FileToolsEngine implements TalentEngine {
  readonly name: FileOperation;
  constructor(name: FileOperation) {
    this.name = name;
  }

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    try {
      if (ctx?.signal?.aborted) throw new Error('Cancelled');
      await ensureWorkspace();
      if (this.name === 'file_list') {
        const entries = await RNFS.readDir(FILE_ROOT);
        const names = entries
          .filter(entry => entry.isFile())
          .map(entry => entry.name)
          .filter(name => {
            try {
              safeWorkspaceName(name);
              return true;
            } catch {
              return false;
            }
          });
        return {
          type: 'text',
          summary: names.length ? names.join('\n') : 'Workspace is empty',
        };
      }

      if (this.name === 'file_search') {
        const query = args.query;
        if (typeof query !== 'string' || !query.trim() || query.length > 200)
          throw new Error('Search query must be 1–200 characters');
        const entries = await RNFS.readDir(FILE_ROOT);
        const matches = entries
          .filter(
            entry =>
              entry.isFile() &&
              entry.name.toLowerCase().includes(query.toLowerCase()),
          )
          .map(entry => entry.name)
          .slice(0, 100);
        return {
          type: 'text',
          summary: matches.length
            ? matches.join('\n')
            : 'No matching filenames',
        };
      }
      const name = safeWorkspaceName(args.filename);
      const path = workspacePath(name);
      if (this.name === 'file_info') {
        const stat = await RNFS.stat(path);
        if (!stat.isFile()) throw new Error('Not a regular file');
        return {
          type: 'text',
          summary: JSON.stringify({
            filename: name,
            bytes: Number(stat.size),
            editableText: isEditableTextName(name),
          }),
        };
      }
      if (this.name === 'file_read_range') {
        const start = Number(args.start_line);
        const count = Number(args.line_count);
        if (
          !Number.isSafeInteger(start) ||
          start < 1 ||
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > 200
        )
          throw new Error('Use start_line >= 1 and line_count 1–200');
        const lines = splitLines(await readWorkspace(name));
        return {
          type: 'text',
          summary:
            lines
              .slice(start - 1, start - 1 + count)
              .map((line, index) => start + index + ': ' + line)
              .join('\n') || 'No lines in range',
        };
      }
      if (this.name === 'file_read') {
        return {type: 'text', summary: await readWorkspace(name)};
      }
      if (this.name === 'file_history') {
        const snapshots = await listFileHistory(name);
        return {
          type: 'text',
          summary: snapshots.length
            ? snapshots
                .map(
                  s => s.id + '  (' + new Date(s.savedAt).toISOString() + ')',
                )
                .join('\n')
            : 'No earlier versions of ' + name,
        };
      }
      if (this.name === 'file_diff') {
        const current = await readWorkspace(name);
        if (typeof args.content === 'string') {
          return {
            type: 'text',
            summary: diffLines(current, checkText(args.content)),
          };
        }
        const [latest] = await listFileHistory(name);
        if (!latest)
          return {
            type: 'text',
            summary: 'No earlier version of ' + name + ' to compare with',
          };
        return {
          type: 'text',
          summary:
            'Changes since ' +
            latest.id +
            ':\n' +
            diffLines(await readFileSnapshot(name, latest.id), current),
        };
      }

      // Never rewrite binary imports using a text-only edit tool.
      assertEditableTextName(name);
      const exists = await RNFS.exists(path);
      if (this.name === 'file_create') {
        if (exists)
          throw new Error(
            'File already exists. Use file_edit, file_patch or file_append after reviewing existing content.',
          );
        return await this.write(
          name,
          path,
          undefined,
          checkText(args.content),
          'file_create',
          ctx,
        );
      }
      if (!exists) throw new Error('File not found. Use file_create.');
      const previous = await readWorkspace(name);
      if (this.name === 'file_edit') {
        return await this.write(
          name,
          path,
          previous,
          checkText(args.content),
          'file_edit',
          ctx,
        );
      }
      if (this.name === 'file_append') {
        return await this.write(
          name,
          path,
          previous,
          previous + checkText(args.content),
          'file_append',
          ctx,
        );
      }
      if (this.name === 'file_patch') {
        const find = args.find;
        const replace = args.replace;
        if (typeof find !== 'string' || !find)
          throw new Error('find must be the exact, non-empty text to replace');
        if (typeof replace !== 'string')
          throw new Error('replace must be text (use "" to delete)');
        const hits = countOccurrences(previous, find);
        if (hits === 0)
          throw new Error(
            'find text not found in ' +
              name +
              '. Read the file and copy the text exactly.',
          );
        if (hits > 1)
          throw new Error(
            'find text appears ' +
              hits +
              ' times in ' +
              name +
              '. Include more surrounding text so it matches once.',
          );
        const at = previous.indexOf(find);
        const next =
          previous.slice(0, at) +
          checkText(replace) +
          previous.slice(at + find.length);
        return await this.write(name, path, previous, next, 'file_patch', ctx);
      }
      // file_undo
      const [latest] = await listFileHistory(name);
      if (!latest)
        throw new Error('No earlier version of ' + name + ' to restore');
      return await this.write(
        name,
        path,
        previous,
        await readFileSnapshot(name, latest.id),
        'file_undo',
        ctx,
      );
    } catch (error) {
      return failed(error);
    }
  }

  /** Approve → refuse if stale → snapshot previous → write → verify (restore on failure). */
  private async write(
    name: string,
    path: string,
    previous: string | undefined,
    next: string,
    action: WriteAction,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    if (utf8Bytes(next) > getWorkspaceLimits().maxFileBytes) {
      throw new Error('Text exceeds configured workspace file size limit');
    }
    if (previous !== undefined && next === previous) {
      return {type: 'text', summary: 'No changes to ' + name};
    }
    const exists = previous !== undefined;
    const approved = await requestFileApproval(
      {
        action,
        filename: name,
        content: next,
        previous,
        ...(exists ? {diff: diffLines(previous, next)} : {}),
      },
      ctx?.signal,
    );
    if (!approved || ctx?.signal?.aborted)
      throw new Error('User denied or cancelled file change');
    // Refuse a stale proposal if the file changed during review.
    if (
      (await RNFS.exists(path)) !== exists ||
      (exists && (await readWorkspace(name)) !== previous)
    ) {
      throw new Error(
        'File changed while awaiting approval; retry with latest content',
      );
    }
    if (exists) await saveFileSnapshot(name, previous);
    try {
      await RNFS.writeFile(path, next, 'utf8');
      if ((await RNFS.readFile(path, 'utf8')) !== next)
        throw new Error('Post-write verification failed');
    } catch (writeError) {
      if (exists) await RNFS.writeFile(path, previous, 'utf8');
      else if (await RNFS.exists(path)) await RNFS.unlink(path);
      throw writeError;
    }
    const verb = {
      file_create: 'Created ',
      file_edit: 'Updated ',
      file_append: 'Appended to ',
      file_patch: 'Patched ',
      file_undo: 'Restored previous version of ',
    }[action];
    return {
      type: 'text',
      summary:
        verb +
        name +
        ' in private workspace' +
        (exists ? ' (earlier version kept; file_undo restores it)' : ''),
    };
  }

  toToolDefinition(): ToolDefinition {
    const limit = getWorkspaceLimits().maxToolTextBytes;
    const n = this.name;
    const list = n === 'file_list' || n === 'file_search';
    const description: Record<FileOperation, string> = {
      file_list: 'List editable files in PocketAgent private workspace',
      file_search:
        'Search filenames in the private workspace (case insensitive)',
      file_info: 'Show file size and type in the private workspace',
      file_read_range:
        'Read numbered lines from a text file in the private workspace',
      file_read: 'Read a text/code file from PocketAgent private workspace',
      file_create:
        'Create a NEW private text/code file only, with explicit filename ending in .txt, .md, etc. User must approve full contents. If this fails, report the error; NEVER edit an unrelated existing file as a workaround.',
      file_edit:
        'Replace an EXISTING private text file only when the user explicitly requests editing that exact file. User must approve complete old/new contents before saving.',
      file_append:
        'Add text to the END of an existing private text file (exactly as given; include a leading newline if needed). User must approve.',
      file_patch:
        'Replace one exact snippet in an existing private text file. `find` must appear exactly once; read the file first and copy it exactly. User must approve.',
      file_diff:
        'Show line-by-line changes: between the file and proposed `content`, or (without content) since its last saved version. Read only.',
      file_history:
        'List earlier saved versions of a private text file (newest first). Read only.',
      file_undo:
        'Restore the most recent earlier version of a private text file (undo the last change). User must approve.',
    };
    const props: Record<string, unknown> = {};
    if (!list)
      props.filename = {
        type: 'string',
        description:
          'Complete basename including supported text/code extension (e.g. test.txt or notes.md). Never modify an unrelated existing file if creation fails.',
      };
    if (n === 'file_search')
      props.query = {
        type: 'string',
        description: 'Case-insensitive filename substring',
      };
    if (n === 'file_read_range') {
      props.start_line = {
        type: 'integer',
        description: 'First line, starting at 1',
      };
      props.line_count = {
        type: 'integer',
        description: 'Number of lines, 1–200',
      };
    }
    if (n === 'file_create' || n === 'file_edit')
      props.content = {
        type: 'string',
        description:
          'Complete replacement UTF-8 contents (' + limit + ' bytes maximum)',
      };
    if (n === 'file_append')
      props.content = {
        type: 'string',
        description: 'Text to add at the end (' + limit + ' bytes maximum)',
      };
    if (n === 'file_diff')
      props.content = {
        type: 'string',
        description:
          'Optional proposed full contents to compare with the current file',
      };
    if (n === 'file_patch') {
      props.find = {
        type: 'string',
        description: 'Exact existing text to replace; must occur exactly once',
      };
      props.replace = {
        type: 'string',
        description: 'Replacement text ("" deletes the snippet)',
      };
    }
    const required: Record<FileOperation, string[]> = {
      file_list: [],
      file_search: ['query'],
      file_info: ['filename'],
      file_read: ['filename'],
      file_read_range: ['filename', 'start_line', 'line_count'],
      file_create: ['filename', 'content'],
      file_edit: ['filename', 'content'],
      file_append: ['filename', 'content'],
      file_patch: ['filename', 'find', 'replace'],
      file_diff: ['filename'],
      file_history: ['filename'],
      file_undo: ['filename'],
    };
    return {
      type: 'function',
      function: {
        name: n,
        description: description[n],
        parameters: {type: 'object', properties: props, required: required[n]},
      },
    };
  }
}
