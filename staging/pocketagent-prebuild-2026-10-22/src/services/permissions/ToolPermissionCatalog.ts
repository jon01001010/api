import type {PermissionCategory, ToolPermissionRequest} from './ToolPermissionPolicy';
/** Explicit classification; unknown tools are blocked rather than silently bypassing approval. */
const TOOL_CATEGORIES: Readonly<Record<string, PermissionCategory>> = {
  read_url: 'network', web_search: 'network', http_get: 'network',
  create_file: 'files', read_file: 'files', edit_file: 'files', delete_file: 'files',
  open_app: 'apps', navigate_app: 'apps',
  send_message: 'messages', send_whatsapp: 'messages',
  schedule_notification: 'notifications',
};
/** Only these audited built-in operations bypass extra sensitive-tool approval. */
const LOCAL_ONLY = new Set(['calculate', 'datetime', 'render_html']);
export type ToolClassification =
  | {kind: 'sensitive'; request: ToolPermissionRequest}
  | {kind: 'local'}
  | {kind: 'unknown'};
export function classifyTool(tool: string): ToolClassification {
  if (Object.prototype.hasOwnProperty.call(TOOL_CATEGORIES, tool)) {
    return {kind: 'sensitive', request: {tool, category: TOOL_CATEGORIES[tool]}};
  }
  if (LOCAL_ONLY.has(tool)) return {kind: 'local'};
  return {kind: 'unknown'};
}
export function permissionForTool(tool: string): ToolPermissionRequest | null {
  const classification = classifyTool(tool);
  return classification.kind === 'sensitive' ? classification.request : null;
}
