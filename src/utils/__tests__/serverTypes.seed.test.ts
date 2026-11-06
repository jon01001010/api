import {seedServerType} from '../serverTypes';

describe('seedServerType', () => {
  it('recognises the cloud APIs by address', () => {
    expect(seedServerType(undefined, 'https://api.openai.com/v1')).toBe(
      'OpenAI',
    );
    expect(seedServerType(undefined, 'https://api.anthropic.com')).toBe(
      'Claude',
    );
    expect(seedServerType(undefined, 'https://api.deepseek.com')).toBe(
      'DeepSeek',
    );
    expect(seedServerType(undefined, 'https://api.deepseek.com/v1')).toBe(
      'DeepSeek',
    );
  });

  it('seeds the free cloud APIs', () => {
    expect(
      seedServerType(
        undefined,
        'https://generativelanguage.googleapis.com/v1beta/openai',
      ),
    ).toBe('Gemini');
    expect(seedServerType(undefined, 'https://api.groq.com/openai/v1')).toBe(
      'OpenAI',
    );
    expect(seedServerType(undefined, 'https://openrouter.ai/api/v1')).toBe(
      'OpenAI',
    );
  });

  it('a detected type wins; anything else is unknown', () => {
    expect(seedServerType('llama.cpp', 'https://api.deepseek.com')).toBe(
      'llama.cpp',
    );
    expect(seedServerType(undefined, 'http://192.168.1.5:8080')).toBe(
      'unknown',
    );
  });
});
