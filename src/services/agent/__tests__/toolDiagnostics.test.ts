import {safeToolArguments, makeToolDiagnostic} from '../toolDiagnostics';
test('redacts secrets in exported arguments', () => {
  expect(safeToolArguments('{"timezone":"America/Vancouver","api_key":"secret"}'))
    .toBe('{"timezone":"America/Vancouver","api_key":"[REDACTED]"}');
});
test('records status and timing', () => {
  const record = makeToolDiagnostic('call_1', 'datetime', '{"timezone":"UTC"}', Date.now(), 'success', 'OK');
  expect(record.status).toBe('success');
  expect(record.durationMs).toBeGreaterThanOrEqual(0);
});
