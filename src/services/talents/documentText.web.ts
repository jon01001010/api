/**
 * Desktop app: documents in the workspace read as text on the PC
 * (src-tauri/src/docs.rs). Workspace files only; nothing is uploaded.
 */
import {invoke} from '@tauri-apps/api/core';

export {DOCUMENT_EXTENSIONS, isDocumentName} from './documentText';

export async function readDocumentText(path: string): Promise<string> {
  return invoke<string>('doc_to_text', {path});
}
