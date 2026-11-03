import {ExecutionBudget} from '../ExecutionBudget';
import {GuardedToolExecution} from '../GuardedToolExecution';
import {ToolCallJournal} from '../../diagnostics/ToolCallJournal';

describe('GuardedToolExecution', () => {
  it('counts calls and records only metadata', async () => {
    const journal = new ToolCallJournal();
    const runner = new GuardedToolExecution(new ExecutionBudget(1, 60000), journal);
    await expect(runner.run('datetime', async () => 'private response')).resolves.toBe('private response');
    expect(journal.snapshot()).toMatchObject([{tool: 'datetime', status: 'success'}]);
    expect(JSON.stringify(journal.snapshot())).not.toContain('private response');
    await expect(runner.run('datetime', async () => 'never')).rejects.toThrow('budget');
    expect(journal.snapshot()).toHaveLength(1);
  });
  it('records errors without their potentially sensitive messages', async () => {
    const journal = new ToolCallJournal();
    const runner = new GuardedToolExecution(new ExecutionBudget(2, 60000), journal);
    await expect(runner.run('read_url', async () => {throw new Error('secret-token');})).rejects.toThrow('secret-token');
    expect(journal.snapshot()[0]).toMatchObject({status: 'error', errorType: 'ToolExecutionFailed'});
    expect(JSON.stringify(journal.snapshot())).not.toContain('secret-token');
  });
});
