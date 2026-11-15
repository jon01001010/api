jest.unmock('../../store');
import {runInAction} from 'mobx';
import {modelStore} from '..';
import {loraStore} from '../LoraStore';
import {voiceStore} from '../VoiceStore';
import {basicModel} from '../../../jest/fixtures/models';

jest.mock('../../utils/deviceCapabilities', () => ({
  ...jest.requireActual('../../utils/deviceCapabilities'),
  getCpuCoreCount: jest.fn().mockResolvedValue(8),
  getRecommendedThreadCount: jest.fn().mockResolvedValue(6),
  checkGpuSupport: jest.fn().mockResolvedValue({isSupported: false}),
  isHighEndDevice: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../services/downloads', () => ({
  DownloadCancelledError: class extends Error {},
  downloadManager: {
    isDownloading: jest.fn().mockReturnValue(false),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(),
    setCallbacks: jest.fn(),
    syncWithActiveDownloads: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../services/deviceRules/rules', () => ({
  fetchRules: jest.fn().mockResolvedValue(null),
}));

const modelA = {...basicModel, id: 'model-a', name: 'Model A'};

const contexts: any[] = [];
function nextContexts() {
  const {initLlama} = require('llama.rn');
  (initLlama as jest.Mock).mockReset();
  (initLlama as jest.Mock).mockImplementation(async () => {
    const ctx: any = {
      id: contexts.length + 1,
      loaded: [] as any[],
      release: jest.fn().mockResolvedValue(undefined),
      releaseMultimodal: jest.fn().mockResolvedValue(undefined),
      isMultimodalEnabled: jest.fn().mockResolvedValue(false),
      completion: jest.fn(),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
      clearCache: jest.fn().mockResolvedValue(undefined),
      getLoadedLoraAdapters: jest.fn(async () => ctx.loaded),
      applyLoraAdapters: jest.fn(async (list: any[]) => {
        ctx.loaded = list;
      }),
      removeLoraAdapters: jest.fn(async () => {
        ctx.loaded = [];
      }),
    };
    contexts.push(ctx);
    return ctx;
  });
}

describe('LoRA adapters on the phone', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    contexts.length = 0;
    nextContexts();
    await modelStore.releaseContext(true);
    runInAction(() => {
      modelStore.models = [modelA];
      modelStore.availableMemoryCeiling = 1e12;
      voiceStore.wakeEnabled = false;
      loraStore.adapters = [];
      loraStore.choices = {};
      loraStore.problems = {};
    });
    loraStore.add({
      id: 'v1',
      name: 'my-style',
      fileName: 'my-style.gguf',
      size: 1,
      addedAt: '2026-11-15',
      modelId: 'model-a',
    });
  });

  afterAll(async () => {
    await modelStore.releaseContext(true);
  });

  it('a model loads with its chosen adapter', async () => {
    loraStore.setChoice('model-a', 'v1', 0.8);
    await modelStore.initContext(modelA);
    const ctx = contexts[0];
    expect(ctx.applyLoraAdapters).toHaveBeenCalledWith([
      {
        path: expect.stringMatching(/\/models\/lora\/my-style\.gguf$/),
        scaled: 0.8,
      },
    ]);
  });

  it('switching and Off apply in place, without reloading the model', async () => {
    await modelStore.initContext(modelA);
    const ctx = contexts[0];
    expect(ctx.applyLoraAdapters).not.toHaveBeenCalled();
    loraStore.setChoice('model-a', 'v1', 0.5);
    await modelStore.applyLoraChoice('model-a');
    expect(ctx.loaded).toEqual([
      {path: expect.stringMatching(/my-style\.gguf$/), scaled: 0.5},
    ]);
    loraStore.setChoice('model-a', null);
    await modelStore.applyLoraChoice('model-a');
    expect(ctx.removeLoraAdapters).toHaveBeenCalled();
    expect(ctx.loaded).toEqual([]);
    // Still the one context: no reload.
    expect(require('llama.rn').initLlama).toHaveBeenCalledTimes(1);
  });

  it('an adapter that does not fit: the plain model still loads, and it says so', async () => {
    loraStore.setChoice('model-a', 'v1', 1);
    const {initLlama} = require('llama.rn');
    const make = (initLlama as jest.Mock).getMockImplementation()!;
    (initLlama as jest.Mock).mockImplementationOnce(async () => {
      const ctx = await make();
      ctx.applyLoraAdapters.mockRejectedValueOnce(new Error('mismatch'));
      return ctx;
    });
    await modelStore.initContext(modelA);
    expect(modelStore.context?.id).toBe(contexts[0].id);
    expect(loraStore.problems['model-a']).toMatch(/did not load/);
  });
});
