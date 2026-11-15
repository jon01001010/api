import {
  describeMakerValues,
  fillMakerSettings,
  makerSettingsFor,
} from '../makerSettings';
import {defaultCompletionParams} from '../completionSettingsVersions';

describe('makerSettingsFor', () => {
  it('knows Qwen3 with thinking on and off', () => {
    expect(makerSettingsFor('Qwen3-8B-Q4_K_M.gguf', true)).toEqual({
      family: 'Qwen3',
      values: {
        temperature: 0.6,
        top_p: 0.95,
        top_k: 20,
        min_p: 0,
        penalty_present: 1.5,
      },
    });
    expect(makerSettingsFor('qwen3:1.7b', false)?.values).toMatchObject({
      temperature: 0.7,
      top_p: 0.8,
    });
  });

  it('uses the fixed variant for Thinking / Instruct models', () => {
    expect(
      makerSettingsFor('Qwen3-4B-Thinking-2507', false)?.values.temperature,
    ).toBe(0.6);
    expect(
      makerSettingsFor('Qwen3-4B-Instruct-2507', true)?.values.temperature,
    ).toBe(0.7);
  });

  it('picks the more specific family first', () => {
    expect(makerSettingsFor('DeepSeek-R1-Distill-Qwen-7B', true)?.family).toBe(
      'DeepSeek-R1',
    );
    expect(makerSettingsFor('Qwen/QwQ-32B-GGUF', true)?.family).toBe('QwQ');
    expect(makerSettingsFor('Phi-4-reasoning-plus', true)?.family).toBe(
      'Phi-4-reasoning',
    );
    expect(makerSettingsFor('gpt-oss-20b', true)?.values).toEqual({
      temperature: 1,
      top_p: 1,
    });
    expect(makerSettingsFor('gemma-3-4b-it', false)?.values.top_k).toBe(64);
  });

  it('knows nothing about other models', () => {
    expect(makerSettingsFor('Llama-3.2-3B-Instruct', true)).toBeNull();
    expect(makerSettingsFor('Qwen3.5-9B', true)).toBeNull();
    expect(makerSettingsFor('gemma-4-e2b', true)).toBeNull();
    expect(makerSettingsFor(undefined, true)).toBeNull();
  });
});

describe('fillMakerSettings', () => {
  const values = {temperature: 0.6, top_p: 0.95, top_k: 20};

  it('fills values still at the app default and keeps the user`s own', () => {
    const current = {...defaultCompletionParams, top_k: 30};
    const out = fillMakerSettings(current, defaultCompletionParams, values);
    expect(out.settings.temperature).toBe(0.6);
    expect(out.settings.top_k).toBe(30);
    expect(out.filled).toEqual(['temperature']);
    expect(out.kept).toEqual(['top_k']);
    // top_p was already 0.95: nothing to do.
    expect(out.filled).not.toContain('top_p');
    expect(current.temperature).toBe(0.7);
  });

  it('treats text from the inputs as numbers', () => {
    const current = {...defaultCompletionParams, temperature: '0.7' as any};
    const out = fillMakerSettings(current, defaultCompletionParams, values);
    expect(out.filled).toContain('temperature');
  });

  it('fills unset values', () => {
    const out = fillMakerSettings({}, defaultCompletionParams, {min_p: 0});
    expect(out.settings.min_p).toBe(0);
  });

  it('describes values in one line', () => {
    expect(describeMakerValues(values)).toBe(
      'temperature 0.6, top_p 0.95, top_k 20',
    );
  });
});
