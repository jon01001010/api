import {ExecutionBudget} from './ExecutionBudget';
import {ToolCallJournal} from '../diagnostics/ToolCallJournal';

/** Adapter for central talent dispatch. Caller supplies the actual engine action.
 * Each call is counted once, including failed calls. No arguments or outputs are logged.
 * This does not abort a running tool; pass AbortSignal to the engine separately.
 */
export class GuardedToolExecution {
  constructor(
    private readonly budget: ExecutionBudget,
    private readonly journal: ToolCallJournal,
  ) {}

  async run<T>(name: string, action: () => Promise<T>): Promise<T> {
    this.budget.recordStart();
    const id = this.journal.start(name);
    try {
      const result = await action();
      this.journal.finish(id, 'success');
      return result;
    } catch (error) {
      this.journal.finish(id, 'error', 'ToolExecutionFailed');
      throw error;
    }
  }
}
