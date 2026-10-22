import {ToolCapability, ToolPermissionPolicy, PermissionDecision} from './toolPermissions';

export type PendingPermission = {
  id: number;
  tool: string;
  capability: ToolCapability;
  /** A human-readable description, not the raw (possibly secret) arguments. */
  description: string;
};
type Listener = (pending: PendingPermission | null) => void;

/** In-memory user approval broker. Never automatically approves a sensitive action. */
export class PermissionRequests {
  readonly policy = new ToolPermissionPolicy();
  private listeners = new Set<Listener>();
  private pending: {request: PendingPermission; resolve: (ok: boolean) => void} | null = null;
  private nextId = 1;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.pending?.request ?? null);
    return () => {this.listeners.delete(listener);};
  }
  private publish() {
    const current = this.pending?.request ?? null;
    this.listeners.forEach(listener => listener(current));
  }
  async authorize(tool: string, capability: ToolCapability, description: string, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    if (this.policy.authorize(tool, capability)) return true;
    // Avoid concurrent dialogs and avoid hanging requests without a mounted UI.
    if (this.pending || this.listeners.size === 0) return false;
    return new Promise<boolean>(resolve => {
      const request = {id: this.nextId++, tool, capability, description: description.slice(0, 240)};
      const finish = (ok: boolean) => {
        if (this.pending?.request.id !== request.id) return;
        this.pending = null;
        signal?.removeEventListener('abort', onAbort);
        this.publish();
        resolve(ok);
      };
      const onAbort = () => finish(false);
      this.pending = {request, resolve: finish};
      signal?.addEventListener('abort', onAbort, {once: true});
      this.publish();
    });
  }
  respond(id: number, decision: PermissionDecision): void {
    if (this.pending?.request.id !== id) return;
    const {tool, capability} = this.pending.request;
    if (decision !== 'deny') this.policy.grant(tool, capability, decision);
    // The grant is consumed here, so Allow Once only authorizes this request.
    this.pending.resolve(decision !== 'deny' && this.policy.authorize(tool, capability));
  }
  cancel(): void {this.pending?.resolve(false);}
}
export const permissionRequests = new PermissionRequests();
