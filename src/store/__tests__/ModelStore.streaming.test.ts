import {runInAction} from 'mobx';

import {modelStore} from '../ModelStore';

describe('stream large models from storage', () => {
  beforeEach(() => {
    runInAction(() => {
      modelStore.contextInitParams = {
        ...modelStore.contextInitParams,
        use_mmap: 'false',
        use_mlock: true,
      };
    });
  });
  afterEach(() => modelStore.setStreamLargeModels(false));

  it('memory-maps (and does not lock) an MoE model when on', async () => {
    modelStore.setStreamLargeModels(true);
    const params = await modelStore.getEffectiveContextInitParams(
      '/models/granite-3.0-1b-a400m-instruct-Q4_K_M.gguf',
    );
    expect(params.use_mmap).toBe(true);
    expect(params.use_mlock).toBe(false);
  });

  it('leaves ordinary models, and everything when off, as set', async () => {
    modelStore.setStreamLargeModels(true);
    const dense = await modelStore.getEffectiveContextInitParams(
      '/models/Qwen3.5-2B-Q4_K_M.gguf',
    );
    expect(dense.use_mmap).toBe(false);
    expect(dense.use_mlock).toBe(true);
    modelStore.setStreamLargeModels(false);
    const off = await modelStore.getEffectiveContextInitParams(
      '/models/Qwen3-30B-A3B-Q4_K_M.gguf',
    );
    expect(off.use_mmap).toBe(false);
  });
});
