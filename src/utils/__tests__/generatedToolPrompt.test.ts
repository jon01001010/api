import {generatedToolPrompt} from '../globalToolSettings';
import {deriveToolSchemas} from '../../services/talents';

describe('the tool line in the system prompt', () => {
  it('names the tools without repeating their how-tos', () => {
    const names = ['memory_get', 'set_alarm', 'open_app'];
    const line = generatedToolPrompt(names);
    for (const n of names) {
      expect(line).toContain(n);
    }
    for (const t of deriveToolSchemas(names)) {
      expect(line).not.toContain(t.function.description);
    }
    // Far shorter than the descriptions it used to repeat.
    const old = deriveToolSchemas(names)
      .map(t => t.function.description)
      .join(' ');
    expect(line.length).toBeLessThan(old.length / 2);
  });

  it('is empty with no tools', () => {
    expect(generatedToolPrompt([])).toBe('');
  });
});
