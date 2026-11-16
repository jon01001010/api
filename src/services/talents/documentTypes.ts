/**
 * Which workspace files are documents (Word, Excel, PowerPoint, OpenDocument,
 * PDF): shared by documentText.ts (phone) and documentText.web.ts (desktop).
 * The .web file must never re-export from its own base name (it resolves to
 * itself on the desktop and loops forever).
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
