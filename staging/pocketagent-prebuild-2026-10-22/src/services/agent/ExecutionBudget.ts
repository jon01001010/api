/** Per-run iteration/time budget. No timers or background work are started here.
 * Call assertCanStart before EACH tool action and recordStart immediately after.
 */
export class ExecutionBudget {
  private used = 0;
  private readonly startedAt: number;
  constructor(
    readonly maxActions: number,
    readonly maxElapsedMs: number,
    startedAt = Date.now(),
  ) {
    if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 1000 ||
        !Number.isFinite(maxElapsedMs) || maxElapsedMs < 1000) {
      throw new Error('Invalid execution limits');
    }
    this.startedAt = startedAt;
  }
  canStart(now = Date.now()): boolean {
    return this.used < this.maxActions && now >= this.startedAt &&
      now - this.startedAt < this.maxElapsedMs;
  }
  recordStart(now = Date.now()): void {
    if (!this.canStart(now)) throw new Error('Agent execution budget exceeded');
    this.used++;
  }
  snapshot(now = Date.now()) {
    return {
      used: this.used,
      remaining: Math.max(0, this.maxActions - this.used),
      elapsedMs: Math.max(0, now - this.startedAt),
      canStart: this.canStart(now),
    };
  }
}
