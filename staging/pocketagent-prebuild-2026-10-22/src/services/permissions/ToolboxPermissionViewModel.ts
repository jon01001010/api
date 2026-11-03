import {classifyTool} from './ToolPermissionCatalog';
import type {PermissionCategory} from './ToolPermissionPolicy';
export interface ToolboxPermissionRow {
  name: string;
  category: PermissionCategory | 'local' | 'unknown';
  needsApproval: boolean;
  blocked: boolean;
  description: string;
}
/** Tool enable switches are never permission grants. Unknown tools are blocked. */
export function toolboxPermissionRows(tools: ReadonlyArray<{name: string; description: string}>): ToolboxPermissionRow[] {
  return tools.map(tool => {
    const classification = classifyTool(tool.name);
    return {
      name: tool.name,
      category: classification.kind === 'sensitive' ? classification.request.category : classification.kind,
      needsApproval: classification.kind === 'sensitive',
      blocked: classification.kind === 'unknown',
      description: tool.description,
    };
  });
}
