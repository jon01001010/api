import {claudeFeatures, parseClaudeId} from '../models';

describe('claude model rules', () => {
  it('reads model ids, with or without a date', () => {
    expect(parseClaudeId('claude-opus-4-8')).toEqual({
      family: 'opus',
      major: 4,
      minor: 8,
    });
    expect(parseClaudeId('claude-haiku-4-5-20251001')).toEqual({
      family: 'haiku',
      major: 4,
      minor: 5,
    });
    expect(parseClaudeId('claude-sonnet-4-20250514')).toEqual({
      family: 'sonnet',
      major: 4,
      minor: 0,
    });
    expect(parseClaudeId('claude-3-5-sonnet-20241022')).toBeNull();
  });

  it('Opus 5.5: thinking always on, bound blocks, fallbacks', () => {
    expect(claudeFeatures('claude-opus-5-5')).toMatchObject({
      adaptive: true,
      thinkingAlwaysOn: true,
      bindsThinking: true,
      fallbacks: true,
    });
  });

  it('Sonnet 5.5: off is between_tools', () => {
    expect(claudeFeatures('claude-sonnet-5-5')).toMatchObject({
      adaptive: true,
      offIsBetweenTools: true,
      bindsThinking: true,
      fallbacks: true,
    });
  });

  it('Opus 4.6 has no xhigh; Opus 4.8 does', () => {
    expect(claudeFeatures('claude-opus-4-6').efforts).not.toContain('xhigh');
    expect(claudeFeatures('claude-opus-4-8').efforts).toContain('xhigh');
    expect(claudeFeatures('claude-opus-4-8').bindsThinking).toBe(false);
  });

  it('Fable 5.1 binds thinking and falls back; Fable 5 does neither', () => {
    expect(claudeFeatures('claude-fable-5-1')).toMatchObject({
      bindsThinking: true,
      fallbacks: true,
      thinkingAlwaysOn: true,
    });
    expect(claudeFeatures('claude-fable-5')).toMatchObject({
      bindsThinking: false,
      fallbacks: false,
    });
  });

  it('older models get no thinking options at all', () => {
    for (const id of ['claude-haiku-4-5', 'claude-3-5-sonnet-20241022']) {
      expect(claudeFeatures(id)).toMatchObject({
        adaptive: false,
        fallbacks: false,
        efforts: [],
      });
    }
  });
});
