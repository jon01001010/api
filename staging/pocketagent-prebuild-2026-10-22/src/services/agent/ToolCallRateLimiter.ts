/** Optional per-tool sliding-window throttle; does not schedule background work. */
export class ToolCallRateLimiter {
  private history = new Map<string, number[]>();
  constructor(private readonly maxCalls = 5, private readonly windowMs = 60000) {
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || windowMs <= 0) throw new Error('Invalid rate limit');
  }
  tryAcquire(tool: string, now = Date.now()): boolean {
    const recent = (this.history.get(tool) ?? []).filter(t => t > now - this.windowMs && t <= now);
    if (recent.length >= this.maxCalls) { this.history.set(tool, recent); return false; }
    recent.push(now); this.history.set(tool, recent); return true;
  }
  clear(): void { this.history.clear(); }
}
