import {validateToolArguments} from '../ToolArgumentValidator';
describe('validateToolArguments', () => {
  it('accepts normal tool objects', () => expect(validateToolArguments('{"url":"https://example.com"}').ok).toBe(true));
  it('defaults empty to object', () => expect(validateToolArguments('')).toEqual({ok: true, args: {}}));
  it('rejects malformed JSON', () => expect(validateToolArguments('{').ok).toBe(false));
  it('rejects arrays, null and primitives', () => { for (const raw of ['[]', 'null', '3', '"hi"']) expect(validateToolArguments(raw).ok).toBe(false); });
  it('limits size', () => expect(validateToolArguments('{"x":"123456"}', 5)).toEqual({ok:false, reason:'too-large'}));
  it('limits depth', () => expect(validateToolArguments('{"a":{"b":{"c":1}}}', 32768, 1)).toEqual({ok:false, reason:'too-deep'}));
});
