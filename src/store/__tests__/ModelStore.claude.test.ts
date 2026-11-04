import {modelStore} from '../ModelStore';
import {serverStore} from '../ServerStore';
import {ClaudeCompletionEngine} from '../../api/claude/engine';
import {OpenAICompletionEngine} from '../../api/completionEngines';

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
});
