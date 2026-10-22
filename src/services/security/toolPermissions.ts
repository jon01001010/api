/** Fail-closed, run-time tool permission gate. UI is responsible for explicit grants. */
export type ToolCapability = 'network' | 'file_read' | 'file_write' | 'file_delete' | 'external_action';
export type PermissionDecision = 'deny' | 'allow_once' | 'allow_always';
export interface PermissionRecord {tool: string; capability: ToolCapability; decision: PermissionDecision; at: number}
const sensitive: ReadonlySet<ToolCapability> = new Set(['network', 'file_read', 'file_write', 'file_delete', 'external_action']);
export class ToolPermissionPolicy {
  private grants = new Map<string, PermissionDecision>();
  private audit: PermissionRecord[] = [];
  private key(tool: string, capability: ToolCapability) { return `${tool}\u0000${capability}`; }
  grant(tool: string, capability: ToolCapability, decision: PermissionDecision) {
    if (!tool || tool.includes('\u0000')) throw new Error('Invalid tool name');
    this.grants.set(this.key(tool, capability), decision);
    this.audit.push({tool, capability, decision, at: Date.now()});
  }
  /** Consumes one-time grants synchronously, before awaiting tool execution. */
  authorize(tool: string, capability: ToolCapability): boolean {
    if (!sensitive.has(capability)) return false;
    const key = this.key(tool, capability);
    const decision = this.grants.get(key) ?? 'deny';
    if (decision === 'allow_once') this.grants.delete(key);
    return decision !== 'deny';
  }
  revoke(tool: string, capability: ToolCapability) { this.grants.delete(this.key(tool, capability)); }
  getAudit(): PermissionRecord[] { return this.audit.map(r => ({...r})); }
}
