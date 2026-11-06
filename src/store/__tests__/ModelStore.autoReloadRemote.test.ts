import {runInAction} from 'mobx';
import {modelStore} from '../ModelStore';
import {serverStore} from '../ServerStore';
import {basicModel} from '../../../jest/fixtures/models';

jest.mock('../ServerStore', () => ({
  serverStore: {
    getApiKey: jest.fn().mockResolvedValue('sk-ant-test'),
    servers: [
      {
        id: 'anthropic',
        name: 'Claude',
        url: 'https://api.anthropic.com',
        serverType: 'Claude',
      },
    ],
    userSelectedModels: [
      {serverId: 'anthropic', remoteModelId: 'claude-opus-5-5'},
    ],
    fetchRemoteModelCaps: jest.fn().mockResolvedValue(undefined),
    recordRemoteReasoningDetected: jest.fn(),
    remoteCaps: {},
    listCaps: {},
  },
}));

const claude = {
  id: 'anthropic/claude-opus-5-5',
  serverId: 'anthropic',
  remoteModelId: 'claude-opus-5-5',
  origin: 1,
} as any;

describe('auto-reload after the app comes back', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runInAction(() => {
      modelStore.models = [{...basicModel, id: 'qwen', isDownloaded: true}];
      modelStore.engine = undefined;
      modelStore.appState = 'active';
    });
  });

  it("doesn't replace a model chosen after the local one was offloaded", async () => {
    // Qwen was offloaded in the background earlier...
    runInAction(() => {
      modelStore.wasAutoReleased = true;
      modelStore.lastAutoReleasedModelId = 'qwen';
    });
    // ...then the user picked Claude.
    await modelStore.setRemoteModel(claude);
    const claudeEngine = modelStore.engine;

    await modelStore.handleAppStateChange('background');
    runInAction(() => {
      modelStore.appState = 'background';
    });
    await modelStore.handleAppStateChange('active');

    // Qwen must not be reloaded over Claude.
    expect(modelStore.wasAutoReleased).toBe(false);
    expect(modelStore.engine).toBe(claudeEngine);
    expect(modelStore.activeModelId).toBe('anthropic/claude-opus-5-5');
    void serverStore;
  });

  it('still reloads the offloaded model when nothing else was picked', async () => {
    runInAction(() => {
      modelStore.engine = undefined;
      modelStore.wasAutoReleased = true;
      modelStore.lastAutoReleasedModelId = 'qwen';
      modelStore.appState = 'background';
    });
    const {initLlama} = require('llama.rn');
    (initLlama as jest.Mock).mockResolvedValue({
      release: jest.fn().mockResolvedValue(undefined),
      isMultimodalEnabled: jest.fn().mockResolvedValue(false),
    });
    await modelStore.handleAppStateChange('active');
    expect(initLlama).toHaveBeenCalled();
    expect(modelStore.activeModelId).toBe('qwen');
    await modelStore.releaseContext(true);
  });

  describe('restore the last model on start', () => {
    it('reconnects Claude (remote) at once', async () => {
      await modelStore.releaseContext(true);
      runInAction(() => {
        modelStore.restoreModelOnStart = true;
        modelStore.lastSessionModelId = 'anthropic/claude-opus-5-5';
      });
      expect(await modelStore.restoreLastModel()).toBe(true);
      expect(modelStore.activeModelId).toBe('anthropic/claude-opus-5-5');
      expect(modelStore.engine).toBeDefined();
    });

    it('loads a local model', async () => {
      await modelStore.releaseContext(true);
      const {initLlama} = require('llama.rn');
      (initLlama as jest.Mock).mockResolvedValue({
        release: jest.fn().mockResolvedValue(undefined),
        isMultimodalEnabled: jest.fn().mockResolvedValue(false),
      });
      runInAction(() => {
        modelStore.lastSessionModelId = 'qwen';
      });
      expect(await modelStore.restoreLastModel()).toBe(true);
      expect(modelStore.activeModelId).toBe('qwen');
      await modelStore.releaseContext(true);
    });

    it('remembers the model in use, and forgets one unloaded on purpose', async () => {
      await modelStore.setRemoteModel(claude);
      expect(modelStore.lastSessionModelId).toBe('anthropic/claude-opus-5-5');
      await modelStore.manualReleaseContext();
      expect(modelStore.lastSessionModelId).toBeUndefined();
      expect(await modelStore.restoreLastModel()).toBe(false);
    });

    it('does nothing when off, or when a model is already in use', async () => {
      runInAction(() => {
        modelStore.lastSessionModelId = 'anthropic/claude-opus-5-5';
        modelStore.restoreModelOnStart = false;
      });
      expect(await modelStore.restoreLastModel()).toBe(false);
      runInAction(() => {
        modelStore.restoreModelOnStart = true;
      });
      await modelStore.setRemoteModel(claude);
      const engine = modelStore.engine;
      expect(await modelStore.restoreLastModel()).toBe(false);
      expect(modelStore.engine).toBe(engine);
    });
  });
});
