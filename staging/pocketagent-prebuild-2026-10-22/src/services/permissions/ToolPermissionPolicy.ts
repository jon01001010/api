/** #15/#16: Explicit permission policy for sensitive tools.
 * Defaults deny. Caller must supply grants from user-approved settings.
 * This module does not prompt or persist permission grants.
 */
export type PermissionDecision = 'allow-once' | 'allow-always' | 'deny';
export type PermissionCategory = 'files' | 'messages' | 'apps' | 'network' | 'notifications';
export interface ToolPermissionRequest {tool: string; category: PermissionCategory;}
export class ToolPermissionPolicy {
  private readonly always = new Set<string>();
  private readonly once = new Set<string>();
  private readonly denied = new Set<string>();
  private key(request: ToolPermissionRequest): string {
    return `${request.category}:${request.tool}`;
  }
  grant(request: ToolPermissionRequest, decision: PermissionDecision): void {
    const key = this.key(request);
    this.once.delete(key);
    this.denied.delete(key);
    if (decision === 'deny') { this.always.delete(key); this.denied.add(key); return; }
    if (decision === 'allow-always') { this.always.add(key); return; }
    this.once.add(key);
  }
  isDenied(request: ToolPermissionRequest): boolean {return this.denied.has(this.key(request));}
  consume(request: ToolPermissionRequest): boolean {
    const key = this.key(request);
    if (this.always.has(key)) return true;
    if (!this.once.has(key)) return false;
    this.once.delete(key);
    return true;
  }
  revoke(request: ToolPermissionRequest): void {
    const key = this.key(request); this.always.delete(key); this.once.delete(key); this.denied.delete(key);
  }
  reset(): void { this.always.clear(); this.once.clear(); this.denied.clear(); }
}
