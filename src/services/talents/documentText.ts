/**
 * Word, Excel, PowerPoint, OpenDocument and PDF files as text. On the phone
 * not yet (documentText.web.ts does it in the desktop app, converted on the
 * PC by src-tauri/src/docs.rs; nothing is uploaded).
 */
export const DOCUMENT_EXTENSIONS = [
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'pdf',
] as const;

export function isDocumentName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
}

export async function readDocumentText(_path: string): Promise<string> {
  throw new Error(
    'Reading Word, Excel, PowerPoint and PDF files works in the desktop app for now.',
  );
}
