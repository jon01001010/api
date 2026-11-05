import {planSearch} from '../hfSearch';

const run = (query: string, ids: string[]) => {
  const plan = planSearch(query);
  return {
    search: plan.search,
    kept: ids.filter(id => plan.matches?.(id) ?? true),
  };
};

const IDS = [
  'bartowski/granite-3.1-1b-a400m-instruct-GGUF',
  'bartowski/granite-3.1-3b-a800m-instruct-GGUF',
  'bartowski/granite-3.1-8b-instruct-GGUF',
  'unsloth/Qwen3-30B-A3B-GGUF',
  'LiquidAI/LFM2-8B-A1B-GGUF',
  'bartowski/Llama-3.2-3B-Instruct-GGUF',
];

describe('planSearch', () => {
  it('passes a one-word search straight through', () => {
    expect(planSearch('granite')).toEqual({search: 'granite'});
  });

  it('matches words in any order, with spaces as dashes or dots', () => {
    expect(run('3.1 granite', IDS)).toEqual({
      search: 'granite',
      kept: IDS.slice(0, 3),
    });
  });

  it('searches on a size or version tag before a family name', () => {
    expect(planSearch('granite a400').search).toBe('a400');
    expect(planSearch('qwen3 moe').search).toBe('qwen3');
    expect(run('Granite a800', IDS).kept).toEqual([IDS[1]]);
  });

  it('"moe" finds the mixture-of-experts repos by their active size', () => {
    expect(run('granite 3.1 moe', IDS).kept).toEqual(IDS.slice(0, 2));
    expect(run('qwen3 moe', IDS).kept).toEqual(['unsloth/Qwen3-30B-A3B-GGUF']);
    expect(run('MoE', IDS).kept).toEqual([
      IDS[0],
      IDS[1],
      'unsloth/Qwen3-30B-A3B-GGUF',
      'LiquidAI/LFM2-8B-A1B-GGUF',
    ]);
  });
});
