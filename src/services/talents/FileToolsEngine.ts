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
    // Each is a short how-to: when to use it, then the steps. Small models
    // follow these literally, so they say exactly what to send.
    const description: Record<FileOperation, string> = {
      file_list:
        'List the files in your private workspace. Use it first when you need a file name you do not know. No arguments.',
      file_search:
        'Find workspace files whose name contains `query` (ignores upper/lower case). Example: "notes" finds notes.md and old-notes.txt.',
      file_info:
        "Show a workspace file's size and whether it can be edited as text. Read only.",
      file_read_range:
        'Read part of a long text file, with line numbers. Example: start_line 1, line_count 50 reads lines 1-50; then start_line 51 for the next part.',
      file_read:
        'Read a whole text file from your private workspace. Always read a file before changing it. For very long files use file_read_range.',
      file_create:
        'Make a NEW text file. Only when the user asks for a new file. How: a name with an extension (notes.md, list.txt, page.html) and the full text in `content`. The user approves it. It fails if the name exists: then tell the user; never change a different file instead.',
      file_edit:
        'Replace ALL the text of an existing file. Only when the user asks to rewrite that file. How: 1) file_read it; 2) send the complete new text in `content` (everything, not just the changed part). The user approves. For a small change use file_patch; to add at the end use file_append.',
      file_append:
        'Add text at the END of an existing file, keeping what is there. How: put only the new text in `content`; start it with a line break if it should begin on a new line. The user approves.',
      file_patch:
        'Change one part of an existing file. How: 1) file_read the file; 2) copy the exact text to change into `find` (it must appear only once; copy more of the line if needed); 3) put the new text in `replace` ("" deletes it). The user approves.',
      file_diff:
        'Show changes line by line. With `content`: compare the file with your proposed new text (check before file_edit). Without `content`: show what changed since its last saved version. Read only.',
      file_history:
        'List the saved earlier versions of a file, newest first. Read only. Use file_undo to go back one version.',
      file_undo:
        'Undo the last change to a file by restoring its most recent earlier version. The user approves.',
    };
    const props: Record<string, unknown> = {};
    if (!list)
      props.filename = {
        type: 'string',
        description:
          n === 'file_create'
            ? 'New file name with a text extension, e.g. notes.md or list.txt (no folders).'
            : 'Exact name of the workspace file, e.g. notes.md (from file_list if unsure).',
      };
    if (n === 'file_search')
      props.query = {
        type: 'string',
        description: 'Part of the file name to look for, e.g. "notes"',
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
          'The complete text of the file (up to ' + limit + ' bytes)',
      };
    if (n === 'file_append')
      props.content = {
        type: 'string',
        description:
          'Only the new text to add at the end (up to ' + limit + ' bytes)',
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
        description:
          'Text copied exactly from the file (from file_read); must appear only once',
      };
      props.replace = {
        type: 'string',
        description: 'The new text to put there ("" deletes it)',
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
