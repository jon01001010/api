import RNFS from '@dr.pogodin/react-native-fs';
import type {TalentEngine, TalentResult, ToolDefinition, TalentExecuteContext} from './types';
import {checkText, ensureWorkspace, MAX_FILE_BYTES, readWorkspace, safeWorkspaceName, workspacePath} from './fileWorkspace';
import {requestFileApproval} from './fileApprovalGate';

type FileOperation = 'file_list' | 'file_read' | 'file_create' | 'file_edit';
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
        const entries = await RNFS.readDir(workspacePath('list.txt').replace(/\/list\.txt$/, ''));
        const names = entries.filter(entry => entry.isFile())
          .map(entry => entry.name).filter(name => {
            try { safeWorkspaceName(name); return true; } catch { return false; }
          });
        return {type: 'text', summary: names.length ? names.join('\n') : 'Workspace is empty'};
      }

      const name = safeWorkspaceName(args.filename);
      const path = workspacePath(name);
      if (this.name === 'file_read') {
        return {type: 'text', summary: await readWorkspace(name)};
      }

      const content = checkText(args.content);
      const exists = await RNFS.exists(path);
      if (this.name === 'file_create' && exists) {
        throw new Error('File already exists. Use file_edit after reviewing existing content.');
      }
      if (this.name === 'file_edit' && !exists) {
        throw new Error('File not found. Use file_create.');
      }
      const previous = exists ? await readWorkspace(name) : undefined;
      const approved = await requestFileApproval({
        action: this.name, filename: name, content, previous,
      }, ctx?.signal);
      if (!approved || ctx?.signal?.aborted) throw new Error('User denied or cancelled file change');
      // Refuse a stale proposal if the file changed during review.
      if ((await RNFS.exists(path)) !== exists ||
          (exists && (await readWorkspace(name)) !== previous)) {
        throw new Error('File changed while awaiting approval; retry with latest content');
      }
      const temp = workspacePath('pending-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.txt');
      try {
        await RNFS.writeFile(temp, content, 'utf8');
        // Write only a private workspace file. Original Android document is never overwritten.
        if (exists) await RNFS.unlink(path);
        await RNFS.moveFile(temp, path);
      } finally {
        if (await RNFS.exists(temp)) await RNFS.unlink(temp);
      }
      return {type: 'text', summary: (exists ? 'Updated ' : 'Created ') + name + ' in private workspace'};
    } catch (error) {
      return failed(error);
    }
  }

  toToolDefinition(): ToolDefinition {
    const write = this.name === 'file_create' || this.name === 'file_edit';
    const list = this.name === 'file_list';
    return {type: 'function', function: {
      name: this.name,
      description: this.name === 'file_list' ? 'List editable files in PocketAgent private workspace' :
        this.name === 'file_read' ? 'Read a text/code file from PocketAgent private workspace' :
        this.name === 'file_create' ? 'Propose a new private text file. User must approve the complete contents before saving.' :
        'Propose replacing an existing private text file. User must approve complete old/new contents before saving.',
      parameters: {type: 'object', properties: {
        ...(list ? {} : {filename: {type: 'string', description: 'Filename from file_list or new filename without any paths'}}),
        ...(write ? {content: {type: 'string', description: 'Complete replacement UTF-8 contents (16 KiB maximum)'}} : {}),
      }, required: list ? [] : write ? ['filename', 'content'] : ['filename']},
    }};
  }
}
