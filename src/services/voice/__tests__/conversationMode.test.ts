import {runInAction} from 'mobx';

// Observable stand-ins: the reaction must see the reply start and end.
jest.mock('../../../store', () => {
  const {observable: obs} = jest.requireActual('mobx');
  return {
    chatSessionStore: obs({agentUiState: {status: 'idle'}}),
    modelStore: obs({isGenerationBusy: false}),
    ttsStore: obs({
      playbackState: {mode: 'idle'},
      stop: () => Promise.resolve(),
    }),
    uiStore: {
      setChatWarning: jest.fn(),
      l10n: {voiceAndSpeech: {voiceInput: {}}},
    },
    voiceStore: obs({
      state: 'idle',
      conversationMode: true,
      language: 'auto',
      selectedModel: {repo: 'r/m', file: 'ggml-base.bin'},
      verifyModels: () => Promise.resolve(),
      setState(s: string) {
        this.state = s;
      },
      setLevel() {},
      openSheet() {},
    }),
  };
});
jest.mock('../speechInput', () => ({
  requestMicPermission: jest.fn(() => Promise.resolve(true)),
  listen: jest.fn(() => ({
    result: Promise.resolve({audio: new Uint8Array(4), reason: 'done'}),
    stop: jest.fn(),
    cancel: jest.fn(),
  })),
  transcribe: jest.fn(() => Promise.resolve('what time is it')),
  releaseWhisper: jest.fn(() => Promise.resolve()),
}));

const store = jest.requireMock('../../../store');
const speech = jest.requireMock('../speechInput');
import {
  resetVoiceController,
  setVoiceSender,
  startVoiceInput,
  watchConversation,
} from '../voiceController';

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

describe('conversation mode', () => {
  let stopWatching: () => void;
  const send = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetVoiceController();
    setVoiceSender(send);
    stopWatching = watchConversation();
    runInAction(() => {
      store.voiceStore.conversationMode = true;
      store.voiceStore.state = 'idle';
    });
  });
  afterEach(() => {
    stopWatching();
    jest.useRealTimers();
  });

  const answer = async ({spoken}: {spoken: boolean}) => {
    runInAction(() => {
      store.chatSessionStore.agentUiState = {status: 'streaming_text'};
    });
    if (spoken) {
      runInAction(() => {
        store.ttsStore.playbackState = {mode: 'streaming'};
      });
    }
    runInAction(() => {
      store.chatSessionStore.agentUiState = {status: 'done'};
    });
    jest.advanceTimersByTime(1000);
    await settle();
  };

  it('listens again once the answer has finished being spoken', async () => {
    await startVoiceInput();
    await settle();
    expect(send).toHaveBeenCalledWith('what time is it');
    expect(speech.listen).toHaveBeenCalledTimes(1);

    await answer({spoken: true});
    // Still speaking: don't listen over the app's own voice.
    expect(speech.listen).toHaveBeenCalledTimes(1);

    runInAction(() => {
      store.ttsStore.playbackState = {mode: 'idle'};
    });
    jest.advanceTimersByTime(1000);
    await settle();
    expect(speech.listen).toHaveBeenCalledTimes(2);
  });

  it('does not listen again when conversation mode is off', async () => {
    runInAction(() => {
      store.voiceStore.conversationMode = false;
    });
    await startVoiceInput();
    await settle();
    await answer({spoken: false});
    expect(speech.listen).toHaveBeenCalledTimes(1);
    expect(speech.releaseWhisper).toHaveBeenCalled();
  });

  it('ignores answers to typed messages', async () => {
    await answer({spoken: false});
    expect(speech.listen).not.toHaveBeenCalled();
  });
});
