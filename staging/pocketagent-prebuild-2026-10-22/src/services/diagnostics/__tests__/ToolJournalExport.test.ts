import {exportToolJournal} from '../ToolJournalExport';
it('exports a minimal JSON journal', () => {
  const parsed = JSON.parse(exportToolJournal([{id:1,tool:'web_search',startedAt:100,status:'success',elapsedMs:20}]));
  expect(parsed.schema).toBe(1);
  expect(parsed.entries[0].tool).toBe('web_search');
  expect(parsed.entries[0]).not.toHaveProperty('arguments');
});
