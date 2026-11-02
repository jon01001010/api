import * as RNFS from '@dr.pogodin/react-native-fs';
import type {TalentEngine, TalentResult, ToolDefinition, TalentExecuteContext} from './types';
import {assertEditableTextName, checkText, ensureWorkspace, FILE_ROOT, getWorkspaceLimits, readWorkspace, safeWorkspaceName, workspacePath} from './fileWorkspace';
import {requestFileApproval} from './fileApprovalGate';

type FileOperation = 'file_list' | 'file_read' | 'file_create' | 'file_edit' | 'file_info' | 'file_search' | 'file_read_range';
function failed(error: unknown): TalentResult {
  const message = error instanceof Error ? error.message : String(error);
  return {type: 'error', summary: message, errorMessage: message};
}
export class FileToolsEngine implements TalentEngine {
  readonly name: FileOperation;
  constructor(name: FileOperation) { this.name = name; }

  async execute(args: Record<string, any>, ctx?: TalentExecuteContext): Promise<TalentResult> {
    try {
      if (ctx?.signal?.aborted) throw new Error('Cancelled');
      await ensureWorkspace();
      if (this.name === 'file_list') {
        const entries = await RNFS.readDir(FILE_ROOT);
        const names = entries.filter(entry => entry.isFile())
          .map(entry => entry.name).filter(name => {
            try { safeWorkspaceName(name); return true; } catch { return false; }
          });
        return {type: 'text', summary: names.length ? names.join('\n') : 'Workspace is empty'};
      }

      if (this.name === 'file_search') {
        const query = args.query;
        if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Search query must be 1–200 characters');
        const entries = await RNFS.readDir(FILE_ROOT);
        const matches = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().includes(query.toLowerCase()))
          .map(entry => entry.name).slice(0, 100);
        return {type: 'text', summary: matches.length ? matches.join('\\n') : 'No matching filenames'};
      }
      const name = safeWorkspaceName(args.filename);
      const path = workspacePath(name);
      if (this.name === 'file_info') {
        const stat = await RNFS.stat(path);
        if (!stat.isFile()) throw new Error('Not a regular file');
        return {type: 'text', summary: JSON.stringify({filename: name, bytes: Number(stat.size), editableText: /\\.(txt|md|json|csv|xml|html|css|js|jsx|ts|tsx|py|java|kt|log|yaml|yml|sh|sql)$/i.test(name)})};
      }
      if (this.name === 'file_read_range') {
        const start = Number(args.start_line);
        const count = Number(args.line_count);
        if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error('Use start_line >= 1 and line_count 1–200');
        const text = await readWorkspace(name);
        const lines = text.split('\\n');
        return {type: 'text', summary: lines.slice(start - 1, start - 1 + count).map((line, index) => (start + index) + ': ' + line).join('\\n') || 'No lines in range'};
      }
      if (this.name === 'file_read') {
        return {type: 'text', summary: await readWorkspace(name)};
      }

      // Never rewrite binary imports using a text-only edit tool.
      assertEditableTextName(name);
      const content = checkText(args.content);
      if (encodeURIComponent(content).replace(/%[a-fA-F0-9]{2}/g, 'x').length > getWorkspaceLimits().maxFileBytes) {
        throw new Error('Text exceeds configured workspace file size limit');
      }
      const exists = await RNFS.exists(path);
      if (this.name === 'file_create' && exists) {
        throw new Error('File already exists. Use file_edit after reviewing existing content.');
      }
      if (this.name === 'file_edit' && !exists) {
        throw new Error('File not found. Use file_create.');
      }
      const previous = exists ? await readWorkspace(name) : undefined;
      const approved = await requestFileApproval({
        action: this.name === 'file_create' ? 'file_create' : 'file_edit', filename: name, content, previous,
      }, ctx?.signal);
      if (!approved || ctx?.signal?.aborted) throw new Error('User denied or cancelled file change');
      // Refuse a stale proposal if the file changed during review.
      if ((await RNFS.exists(path)) !== exists ||
          (exists && (await readWorkspace(name)) !== previous)) {
        throw new Error('File changed while awaiting approval; retry with latest content');
      }
      const backup = workspacePath('backup-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
      if (exists) await RNFS.copyFile(path, backup);
      try {
        await RNFS.writeFile(path, content, 'utf8');
        if (await RNFS.readFile(path, 'utf8') !== content) throw new Error('Post-write verification failed');
      } catch (writeError) {
        if (exists) await RNFS.copyFile(backup, path);
        else if (await RNFS.exists(path)) await RNFS.unlink(path);
        throw writeError;
      } finally {
        if (exists && await RNFS.exists(backup)) await RNFS.unlink(backup);
      }
      return {type: 'text', summary: (exists ? 'Updated ' : 'Created ') + name + ' in private workspace'};
    } catch (error) {
      return failed(error);
    }
  }

  toToolDefinition(): ToolDefinition {
    const write = this.name === 'file_create' || this.name === 'file_edit';
    const limit = getWorkspaceLimits().maxToolTextBytes;
    const list = this.name === 'file_list' || this.name === 'file_search';
    return {type: 'function', function: {
      name: this.name,
      description: this.name === 'file_list' ? 'List editable files in PocketAgent private workspace' :
        this.name === 'file_search' ? 'Search filenames in the private workspace (case insensitive)' :
        this.name === 'file_info' ? 'Show file size and type in the private workspace' :
        this.name === 'file_read_range' ? 'Read numbered lines from a text file in the private workspace' :
        this.name === 'file_read' ? 'Read a text/code file from PocketAgent private workspace' :
        this.name === 'file_create' ? 'Create a NEW private text/code file only, with explicit filename ending in .txt, .md, etc. User must approve full contents. If this fails, report the error; NEVER edit an unrelated existing file as a workaround.' :
        'Replace an EXISTING private text file only when the user explicitly requests editing that exact file. User must approve complete old/new contents before saving.',
      parameters: {type: 'object', properties: {
        ...(list ? {} : {filename: {type: 'string', description: 'Complete basename including supported text/code extension (e.g. test.txt or notes.md). Never modify an unrelated existing file if creation fails.'}}),
        ...(this.name === 'file_search' ? {query: {type: 'string', description: 'Case-insensitive filename substring'}} : {}),
        ...(this.name === 'file_read_range' ? {start_line: {type: 'integer', description: 'First line, starting at 1'}, line_count: {type: 'integer', description: 'Number of lines, 1–200'}} : {}),
        ...(write ? {content: {type: 'string', description: 'Complete replacement UTF-8 contents (' + limit + ' bytes maximum)'}} : {}),
      }, required: this.name === 'file_list' ? [] : this.name === 'file_search' ? ['query'] : write ? ['filename', 'content'] : this.name === 'file_read_range' ? ['filename', 'start_line', 'line_count'] : ['filename']},
    }};
  }
}
