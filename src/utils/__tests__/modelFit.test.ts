import {
  bytesPerParam,
  coldStartCeiling,
  estimateMemoryNeeded,
  estimateParams,
  isMixtureOfExperts,
  isSmallModel,
  kvBytesPerToken,
  paramsFromName,
  phoneFit,
} from '../modelFit';

const GB = 1e9;

describe('paramsFromName', () => {
  it('reads the size from common names', () => {
    expect(paramsFromName('Llama-3.2-1B-Instruct-Q4_K_M.gguf')).toBe(1);
    expect(paramsFromName('Qwen2.5-0.5B-Instruct')).toBe(0.5);
    expect(paramsFromName('gemma-2-2b-it')).toBe(2);
    expect(paramsFromName('SmolLM2-360M-Instruct')).toBeCloseTo(0.36);
    expect(paramsFromName('qwen3:1.7b')).toBe(1.7);
    expect(paramsFromName('gpt-oss-20b')).toBe(20);
  });

  it('takes the total, not the active part or the expert count', () => {
    expect(paramsFromName('Qwen3-30B-A3B-Instruct')).toBe(30);
    expect(paramsFromName('Mixtral-8x7B-v0.1')).toBe(56);
  });

  it('returns undefined without a size', () => {
    expect(paramsFromName('Phi-3.5-mini-instruct')).toBeUndefined();
    expect(paramsFromName(undefined)).toBeUndefined();
  });
});

describe('estimates', () => {
  it('bytes per parameter from the quantization', () => {
    expect(bytesPerParam('x-Q8_0.gguf')).toBeCloseTo(1.06);
    expect(bytesPerParam('x-F16.gguf')).toBe(2);
    expect(bytesPerParam('x-Q4_K_M.gguf')).toBe(0.6);
    expect(bytesPerParam('x-IQ2_XS.gguf')).toBe(0.35);
  });

  it('parameters: known count, then name, then file size', () => {
    expect(estimateParams('x', 1, 4e9)).toBe(4);
    expect(estimateParams('Qwen3-8B', 5 * GB)).toBe(8);
    expect(estimateParams('model-Q4_K_M', 6 * GB)).toBeCloseTo(10);
  });

  it('room per token grows with size and has a ceiling', () => {
    expect(kvBytesPerToken(1)).toBe(76 * 1024);
    expect(kvBytesPerToken(8)).toBe(160 * 1024);
    expect(kvBytesPerToken(70)).toBe(384 * 1024);
  });

  it('memory needed = (file + conversation) + 10 %', () => {
    const need = estimateMemoryNeeded(4 * GB, 4096, 8);
    expect(need).toBeCloseTo((4 * GB + 160 * 1024 * 4096) * 1.1);
    // An 8B Q4 at 4k context: about 5 GB.
    expect(need / GB).toBeGreaterThan(4.9);
    expect(need / GB).toBeLessThan(5.2);
  });
});

describe('phoneFit', () => {
  const phone = {totalMemory: 8 * GB, ceiling: 4.8 * GB};
  it('labels by memory only', () => {
    expect(phoneFit(3 * GB, phone)).toBe('fits');
    expect(phoneFit(6 * GB, phone)).toBe('tight');
    expect(phoneFit(9 * GB, phone)).toBe('too-big');
  });
  it('safe guess before any load', () => {
    expect(coldStartCeiling(8 * GB)).toBeCloseTo(4.8 * GB);
    expect(coldStartCeiling(2 * GB)).toBeCloseTo(0.8 * GB);
    expect(coldStartCeiling(0)).toBe(0);
  });
});

describe('isMixtureOfExperts', () => {
  it.each([
    'Qwen3-30B-A3B-GGUF',
    'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
    'ERNIE-4.5-21B-A3B-PT',
    'LFM2-8B-A1B',
    'Mixtral-8x7B-Instruct',
    'gpt-oss-20b',
    'Qwen1.5-MoE-A2.7B',
    'Llama-4-Scout-17B-16E',
    'GLM-4.5-Air',
    'DeepSeek-V3-0324',
  ])('%s is MoE', name => expect(isMixtureOfExperts(name)).toBe(true));

  it.each([
    'Qwen3-8B',
    'Llama-3.1-8B-Instruct',
    'gemma-3-4b-it',
    'DeepSeek-R1-Distill-Qwen-7B',
    'DeepSeek-R1-0528-Qwen3-8B',
    'Phi-3.5-mini',
  ])('%s is not', name => expect(isMixtureOfExperts(name)).toBe(false));
});

describe('isSmallModel', () => {
  it('below about 3B parameters', () => {
    expect(isSmallModel({params: 2.6e9})).toBe(true);
    expect(isSmallModel({params: 3.2e9})).toBe(false);
    expect(isSmallModel({name: 'Qwen3-1.7B'})).toBe(true);
    expect(isSmallModel({name: 'Llama-3.2-3B'})).toBe(false);
    expect(isSmallModel({name: 'x', filename: 'gemma-3-270m-it.gguf'})).toBe(
      true,
    );
    expect(isSmallModel({name: 'Phi-3.5-mini'})).toBe(false);
    expect(isSmallModel(undefined)).toBe(false);
  });
});
