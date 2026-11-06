import {moeActiveFraction, streamingSizeFactor} from '../moeStreaming';

describe('MoE streaming', () => {
  it.each([
    ['granite-3.0-1b-a400m-instruct-Q4_K_M.gguf', 0.4, 0.8],
    ['Qwen3-30B-A3B-Q4_K_M.gguf', 0.1, 0.25],
    ['LFM2-8B-A1B-Q4_K_M.gguf', 0.125, 0.25],
    ['granite-3.1-3b-a800m-instruct', 0.8 / 3, 0.8 / 1.5],
  ])('%s', (name, fraction, factor) => {
    expect(moeActiveFraction(name)).toBeCloseTo(fraction);
    expect(streamingSizeFactor(name)).toBeCloseTo(factor);
  });

  it('dense models are counted in full', () => {
    for (const name of [
      'Qwen3.5-2B-Q4_K_M.gguf',
      'gemma-3-4b-it',
      'Llama-3.2-3B-Instruct',
    ]) {
      expect(moeActiveFraction(name)).toBeUndefined();
      expect(streamingSizeFactor(name)).toBe(1);
    }
  });
});
