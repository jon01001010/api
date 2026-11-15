import {generatedToolPrompt, toolPromptPieces} from '../globalToolSettings';
import {
  collectSystemPromptFragments,
  deriveToolSchemas,
} from '../../services/talents';
import {
  buildPromptPreview,
  DEFAULT_PROMPT_PARTS,
  joinParts,
} from '../promptParts';

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

describe('the system prompt with no tools switched on', () => {
  const settings = {...DEFAULT_PROMPT_PARTS};
  const now = new Date(2026, 10, 15, 9, 0);
  const preview = (names: string[]) => {
    const pieces = toolPromptPieces(names, settings, 5, now);
    return buildPromptPreview({
      now,
      settings,
      modelDefaultPrompt: '',
      toolGuidance: pieces.guidance,
      globalInstructions: 'Answer in English.',
      memoryContext:
        'Memory (saved notes):\nNotes the user wrote:\nI like tea.',
      toolLine: pieces.toolLine,
    });
  };

  it('no tools: no tool line, no tool guidance, only your own parts', () => {
    expect(toolPromptPieces([], settings, 5, now)).toEqual({
      guidance: [],
      toolLine: '',
    });
    // Unknown names count as no tools too.
    expect(toolPromptPieces(['no_such_tool'], settings, 5, now)).toEqual({
      guidance: [],
      toolLine: '',
    });
    const parts = preview([]);
    expect(parts.map(p => p.id)).toEqual(['time', 'global', 'memory']);
    const text = joinParts(parts);
    expect(text).not.toMatch(/tool|web_search|function/i);
    expect(text).toContain('Answer in English.');
    expect(text).toContain('I like tea.');
    expect(text).toContain('Sunday, 15 November 2026');
    expect(text.length).toBeLessThan(200);
  });

  it('with tools: the same tool line and guidance as before', () => {
    const names = ['web_search', 'read_url'];
    const pieces = toolPromptPieces(names, settings, 5, now);
    expect(pieces.toolLine).toBe(generatedToolPrompt(names));
    expect(pieces.guidance).toEqual(
      collectSystemPromptFragments(names, {now, maxToolTurns: 5}),
    );
    expect(pieces.guidance.join(' ')).toContain('web_search');
    const ids = preview(names).map(p => p.id);
    expect(ids).toEqual(['guidance-0', 'time', 'global', 'memory', 'tools']);
  });

  it('the guidance switch still turns guidance off', () => {
    const pieces = toolPromptPieces(
      ['web_search'],
      {toolGuidance: false},
      5,
      now,
    );
    expect(pieces.guidance).toEqual([]);
    expect(pieces.toolLine).toContain('web_search');
  });
});
