/**
 * Word, Excel, PowerPoint, OpenDocument and PDF files as text. On the phone
 * not yet (documentText.web.ts does it in the desktop app, converted on the
 * PC by src-tauri/src/docs.rs; nothing is uploaded).
 */
export {DOCUMENT_EXTENSIONS, isDocumentName} from './documentTypes';

export async function readDocumentText(_path: string): Promise<string> {
  throw new Error(
    'Reading Word, Excel, PowerPoint and PDF files works in the desktop app for now.',
  );
}
