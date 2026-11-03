/** Cooperative pause at safe boundaries between model turns and tool calls. */
export class AgentPauseController {
  private paused = false;
  private waiters = new Set<() => void>();
  get isPaused() {return this.paused;}
  pause() {this.paused = true;}
  resume() {this.paused = false; this.release();}
  cancel() {this.resume();}
  private release() {for (const wake of this.waiters) wake(); this.waiters.clear();}
  async wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('AgentCancelled');
    if (!this.paused) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => {this.waiters.delete(wake); signal?.removeEventListener('abort', abort);};
      const wake = () => {done(); resolve();};
      const abort = () => {done(); reject(new Error('AgentCancelled'));};
      this.waiters.add(wake);
      signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) abort();
      else if (!this.paused) wake();
    });
    if (signal?.aborted) throw new Error('AgentCancelled');
  }
}
