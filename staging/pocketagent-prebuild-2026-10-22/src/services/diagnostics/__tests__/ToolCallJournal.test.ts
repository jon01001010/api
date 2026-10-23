import {ToolCallJournal} from '../ToolCallJournal';

describe('ToolCallJournal', () => {
  it('records timing, status and safe error types', () => {
    const journal = new ToolCallJournal(2);
    const id = journal.start('datetime', 100);
    journal.finish(id, 'error', 'Timeout: secret=abc', 145);
    expect(journal.snapshot()).toEqual([{
      id, tool: 'datetime', startedAt: 100, elapsedMs: 45,
      status: 'error', errorType: 'Timeoutsecretabc',
    }]);
  });
  it('bounds memory and returns defensive snapshots', () => {
    const journal = new ToolCallJournal(1);
    journal.start('first', 1);
    journal.start('second', 2);
    expect(journal.snapshot()).toHaveLength(1);
    journal.snapshot()[0].tool = 'changed';
    expect(journal.snapshot()[0].tool).toBe('second');
    journal.clear();
    expect(journal.snapshot()).toEqual([]);
  });
});
