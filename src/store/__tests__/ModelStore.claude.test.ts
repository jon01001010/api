import {modelStore} from '../ModelStore';
import {serverStore} from '../ServerStore';
import {ClaudeCompletionEngine} from '../../api/claude/engine';
import {OpenAICompletionEngine} from '../../api/completionEngines';

jest.mock('../ServerStore', () => ({
  serverStore: {
    prepareHomeLink: jest.fn().mockResolvedValue({ok: true}),
    getApiKey: jest.fn().mockResolvedValue('sk-ant-test'),
    servers: [
      {
        id: 'anthropic',
        name: 'Claude',
        url: 'https://api.anthropic.com',
        serverType: 'Claude',
      },
      {
        id: 'repointed',
        name: 'Claude',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai',
        serverType: 'Claude',
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        url: 'https://api.deepseek.com',
        serverType: 'DeepSeek',
      },
    ],
    fetchRemoteModelCaps: jest.fn().mockResolvedValue(undefined),
    recordRemoteReasoningDetected: jest.fn(),
  },
}));

const claudeModel = (remoteModelId: string) =>
  ({
    id: `anthropic/${remoteModelId}`,
    serverId: 'anthropic',
    remoteModelId,
    origin: 1,
  }) as any;

describe('Claude remote models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modelStore.engine = undefined;
  });

  it('uses the Claude engine, not the OpenAI one', async () => {
    await modelStore.setRemoteModel(claudeModel('claude-opus-5-5'));
    expect(modelStore.engine).toBeInstanceOf(ClaudeCompletionEngine);
    expect(modelStore.engine).not.toBeInstanceOf(OpenAICompletionEngine);
  });

  it('a Claude-typed server pointed at Gemini uses the OpenAI-compatible engine', async () => {
    await modelStore.setRemoteModel({
      id: 'repointed/gemini-2.5-flash',
      serverId: 'repointed',
      remoteModelId: 'gemini-2.5-flash',
      origin: 1,
    } as any);
    expect(modelStore.engine).toBeInstanceOf(OpenAICompletionEngine);
    expect(modelStore.engine).not.toBeInstanceOf(ClaudeCompletionEngine);
  });

  it("sets the thinking toggle and effort levels from the model's rules", async () => {
    await modelStore.setRemoteModel(claudeModel('claude-opus-4-6'));
    expect(serverStore.recordRemoteReasoningDetected).toHaveBeenCalledWith(
      'anthropic/claude-opus-4-6',
      {
        isReasoning: 'yes',
        source: 'detected',
        supportsEffort: true,
        effortValues: ['low', 'medium', 'high', 'max'],
        effortSource: 'detected',
      },
    );
  });

  it('older models show no thinking toggle', async () => {
    await modelStore.setRemoteModel(claudeModel('claude-3-5-haiku-20241022'));
    expect(serverStore.recordRemoteReasoningDetected).toHaveBeenCalledWith(
      'anthropic/claude-3-5-haiku-20241022',
      expect.objectContaining({isReasoning: 'no', supportsEffort: false}),
    );
  });

  it('DeepSeek uses the OpenAI-compatible engine, with thinking at low/high/max', async () => {
    await modelStore.setRemoteModel({
      id: 'deepseek/deepseek-v4-flash',
      serverId: 'deepseek',
      remoteModelId: 'deepseek-v4-flash',
      origin: 1,
    } as any);
    expect(modelStore.engine).toBeInstanceOf(OpenAICompletionEngine);
    expect(serverStore.recordRemoteReasoningDetected).toHaveBeenCalledWith(
      'deepseek/deepseek-v4-flash',
      expect.objectContaining({
        isReasoning: 'yes',
        effortValues: ['low', 'high', 'max'],
      }),
    );
  });
});

describe('switching away from a remote model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modelStore.engine = undefined;
  });

  it('a later pick wins over a remote pick still in flight', async () => {
    let releaseKey!: (key: string) => void;
    (serverStore.getApiKey as jest.Mock).mockReturnValueOnce(
      new Promise<string>(resolve => {
        releaseKey = resolve;
      }),
    );
    const first = modelStore.setRemoteModel(claudeModel('claude-opus-5-5'));
    const second = modelStore.setRemoteModel({
      id: 'deepseek/deepseek-v4-flash',
      serverId: 'deepseek',
      remoteModelId: 'deepseek-v4-flash',
      origin: 1,
    } as any);
    releaseKey('sk-ant-test');
    await Promise.all([first, second]);
    expect(modelStore.activeModelId).toBe('deepseek/deepseek-v4-flash');
    expect(modelStore.engine).toBeInstanceOf(OpenAICompletionEngine);
  });

  it('starting a local load stops using the server at once', async () => {
    await modelStore.setRemoteModel(claudeModel('claude-opus-5-5'));
    expect(modelStore.engine).toBeDefined();
    // The load itself is not under test: let it fail after it has begun.
    const load = modelStore
      .initContext({id: 'local-smol', name: 'Smol', origin: 0} as any)
      .catch(() => {});
    expect(modelStore.engine).toBeUndefined();
    expect(modelStore.activeRemoteBinding).toBeUndefined();
    await load;
  });

  it('never hands out a remote engine for a different active model', async () => {
    await modelStore.setRemoteModel(claudeModel('claude-opus-5-5'));
    const lease = modelStore.tryAcquireGeneration();
    expect(lease).not.toBeNull();
    lease!.end();
    expect(modelStore.isGenerationBusy).toBe(false);
    modelStore.setActiveModel('local-smol');
    expect(modelStore.tryAcquireGeneration()).toBeNull();
  });
});
