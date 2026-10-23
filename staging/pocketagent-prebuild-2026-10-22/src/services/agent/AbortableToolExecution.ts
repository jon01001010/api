/** #24: Cancellation wrapper for cooperating tools.
 * Rejects immediately on cancellation; forwards the signal to the tool.
 * IMPORTANT: cancelling a Promise does NOT stop underlying native effects.
 * Destructive tools must check signal before each side effect.
 */
export async function runAbortableTool<T>(
  signal: AbortSignal,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw new Error('ToolCancelled');
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (fn: () => void) => {if (settled) return; settled = true; cleanup(); fn();};
    const onAbort = () => finish(() => reject(new Error('ToolCancelled')));
    signal.addEventListener('abort', onAbort, {once: true});
    if (signal.aborted) {onAbort(); return;}
    Promise.resolve().then(() => {if (signal.aborted) throw new Error('ToolCancelled'); return action(signal);})
      .then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}
