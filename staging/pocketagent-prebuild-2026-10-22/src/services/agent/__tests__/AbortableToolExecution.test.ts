import {runAbortableTool} from '../AbortableToolExecution';
describe('runAbortableTool', () => {
  it('returns a successful tool result', async () => {const c = new AbortController(); await expect(runAbortableTool(c.signal, async () => 42)).resolves.toBe(42);});
  it('never starts an already-cancelled action', async () => {const c = new AbortController(); c.abort(); const fn = jest.fn(async () => 1); await expect(runAbortableTool(c.signal, fn)).rejects.toThrow('ToolCancelled'); expect(fn).not.toHaveBeenCalled();});
  it('rejects when aborted during a pending action', async () => {const c = new AbortController(); let finish!: (n: number) => void; const p = runAbortableTool(c.signal, () => new Promise<number>(resolve => {finish=resolve;})); await Promise.resolve(); c.abort(); await expect(p).rejects.toThrow('ToolCancelled'); finish?.(7);});
});
