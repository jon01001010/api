jest.unmock('../../store');
import {runInAction} from 'mobx';
import {modelStore} from '..';
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
const modelB = {...basicModel, id: 'model-b', name: 'Model B'};
const modelC = {...basicModel, id: 'model-c', name: 'Model C'};

/** Each load gets its own fake native context. */
const contexts: any[] = [];
function nextContexts() {
  const {initLlama} = require('llama.rn');
  (initLlama as jest.Mock).mockReset();
  (initLlama as jest.Mock).mockImplementation(async () => {
    const ctx = {
      id: contexts.length + 1,
      release: jest.fn().mockResolvedValue(undefined),
      releaseMultimodal: jest.fn().mockResolvedValue(undefined),
      isMultimodalEnabled: jest.fn().mockResolvedValue(false),
      completion: jest.fn(),
      stopCompletion: jest.fn().mockResolvedValue(undefined),
    };
    contexts.push(ctx);
    return ctx;
  });
}
const loadsSoFar = () =>
  (require('llama.rn').initLlama as jest.Mock).mock.calls.length;

describe('multi-model (keep models loaded)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    contexts.length = 0;
    nextContexts();
    await modelStore.releaseParkedModels();
    await modelStore.releaseContext(true);
    runInAction(() => {
      modelStore.models = [modelA, modelB, modelC];
      modelStore.keepModelsLoaded = true;
      modelStore.maxLoadedModels = 2;
      modelStore.availableMemoryCeiling = 1e12;
      voiceStore.wakeEnabled = false;
    });
  });

  afterAll(async () => {
    await modelStore.releaseParkedModels();
    await modelStore.releaseContext(true);
    runInAction(() => {
      modelStore.keepModelsLoaded = false;
    });
  });

  it('is off by default', () => {
    expect(new (modelStore.constructor as any)().keepModelsLoaded).toBe(false);
  });

  it('keeps the previous model loaded and switches back instantly', async () => {
    await modelStore.initContext(modelA);
    const ctxA = modelStore.context;
    const rawA = contexts[0];
    await modelStore.initContext(modelB);
    expect(modelStore.activeModelId).toBe('model-b');
    expect(modelStore.parkedModels.map(p => p.modelId)).toEqual(['model-a']);
    expect(rawA.release).not.toHaveBeenCalled();
    expect(modelStore.isModelLoaded('model-a')).toBe(true);

    await modelStore.initContext(modelA);
    expect(loadsSoFar()).toBe(2); // no third load
    expect(modelStore.activeModelId).toBe('model-a');
    expect(modelStore.context).toBe(ctxA);
    expect(modelStore.parkedModels.map(p => p.modelId)).toEqual(['model-b']);
  });

  it('unloads the oldest kept model beyond the limit', async () => {
    await modelStore.initContext(modelA);
    const ctxA = contexts[0];
    await modelStore.initContext(modelB);
    await modelStore.initContext(modelC);
    // Limit 2: C active, B kept, A released.
    expect(modelStore.parkedModels.map(p => p.modelId)).toEqual(['model-b']);
    expect(ctxA.release).toHaveBeenCalledTimes(1);

    modelStore.setMaxLoadedModels(3);
    await modelStore.initContext(modelA);
    expect(modelStore.parkedModels.map(p => p.modelId)).toEqual([
      'model-b',
      'model-c',
    ]);
  });

  it('unloads kept models when the next one would not fit in memory', async () => {
    await modelStore.initContext(modelA);
    runInAction(() => {
      modelStore.availableMemoryCeiling = 1; // nothing more fits
    });
    const ctxA = contexts[0];
    await modelStore.initContext(modelB);
    expect(modelStore.parkedModels).toEqual([]);
    expect(ctxA.release).toHaveBeenCalledTimes(1);
  });

  it('off: switching releases the old model as before', async () => {
    runInAction(() => {
      modelStore.keepModelsLoaded = false;
    });
    await modelStore.initContext(modelA);
    const ctxA = contexts[0];
    await modelStore.initContext(modelB);
    expect(modelStore.parkedModels).toEqual([]);
    expect(ctxA.release).toHaveBeenCalledTimes(1);
  });

  it('turning it off unloads the kept models', async () => {
    await modelStore.initContext(modelA);
    const ctxA = contexts[0];
    await modelStore.initContext(modelB);
    modelStore.setKeepModelsLoaded(false);
    await modelStore.releaseParkedModels();
    expect(modelStore.parkedModels).toEqual([]);
    expect(ctxA.release).toHaveBeenCalledTimes(1);
    expect(modelStore.activeModelId).toBe('model-b');
  });

  it('frees kept models in the background unless the wake word is on', async () => {
    runInAction(() => {
      modelStore.appState = 'active';
      modelStore.useAutoRelease = false; // only the kept-model rule here
    });
    await modelStore.initContext(modelA);
    await modelStore.initContext(modelB);
    runInAction(() => {
      voiceStore.wakeEnabled = true;
    });
    await modelStore.handleAppStateChange('background');
    expect(modelStore.parkedModels).toHaveLength(1);
    runInAction(() => {
      modelStore.appState = 'active';
    });
    runInAction(() => {
      voiceStore.wakeEnabled = false;
    });
    await modelStore.handleAppStateChange('background');
    await modelStore.releaseParkedModels();
    expect(modelStore.parkedModels).toHaveLength(0);
    // The active model is untouched by this rule.
    expect(modelStore.activeModelId).toBe('model-b');
  });

  it('releases a kept model before its file is deleted', async () => {
    await modelStore.initContext(modelA);
    const ctxA = contexts[0];
    await modelStore.initContext(modelB);
    await modelStore.releaseParkedModel('model-a');
    expect(ctxA.release).toHaveBeenCalledTimes(1);
    expect(modelStore.isModelLoaded('model-a')).toBe(false);
  });

  it('benchmark mode unloads everything', async () => {
    await modelStore.initContext(modelA);
    const ctxA = contexts[0];
    await modelStore.initContext(modelB);
    await modelStore.enterBenchmarkMode();
    expect(ctxA.release).toHaveBeenCalledTimes(1);
    expect(modelStore.parkedModels).toEqual([]);
    modelStore.exitBenchmarkMode?.();
  });
});
