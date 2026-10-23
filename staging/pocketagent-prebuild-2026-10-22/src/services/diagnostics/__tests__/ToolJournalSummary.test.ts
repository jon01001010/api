import {summarizeToolJournal} from '../ToolJournalSummary';
it('summarizes status counts without exposing arguments', () => {
  const result = summarizeToolJournal([{id:1,tool:'clock',startedAt:1,status:'success',elapsedMs:10},{id:2,tool:'web',startedAt:2,status:'denied',elapsedMs:20}]);
  expect(result).toEqual({total:2,running:0,success:1,error:0,denied:1,averageElapsedMs:15});
});
