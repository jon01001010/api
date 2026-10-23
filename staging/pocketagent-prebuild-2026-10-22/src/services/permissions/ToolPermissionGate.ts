import {classifyTool} from './ToolPermissionCatalog';
import {ToolPermissionPolicy, PermissionDecision, ToolPermissionRequest} from './ToolPermissionPolicy';

/** A user decision must originate from UI, never from model-generated arguments.
 * A rejected or dismissed prompt denies the call. Concurrent prompts for the
 * same tool are serialized so an allow-once grant cannot authorize two calls.
 */
export type AskPermission = (request: ToolPermissionRequest) => Promise<PermissionDecision>;
export class ToolPermissionGate {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly policy: ToolPermissionPolicy, private readonly ask: AskPermission) {}
  async authorize(tool: string, signal?: AbortSignal): Promise<boolean> {
    const classification = classifyTool(tool);
    if (classification.kind === 'unknown') return false;
    if (classification.kind === 'local') return !signal?.aborted;
    const request = classification.request;
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => {release = resolve;});
    await previous;
    try {
      if (signal?.aborted) return false;
      if (this.policy.isDenied(request)) return false;
      if (this.policy.consume(request)) return true;
      let decision: PermissionDecision;
      try { decision = await this.ask(request); } catch { return false; }
      if (signal?.aborted) return false;
      if (decision === 'deny') {this.policy.grant(request, 'deny'); return false;}
      this.policy.grant(request, decision);
      return this.policy.consume(request);
    } finally {release();}
  }
}
