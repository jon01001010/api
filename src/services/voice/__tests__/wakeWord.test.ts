import {runInAction} from 'mobx';
import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import LiveAudioStream from '@fugood/react-native-audio-pcm-stream';

jest.mock('../../../store', () => {
  const {observable: obs} = jest.requireActual('mobx');
  return {
    chatSessionStore: obs({agentUiState: {status: 'idle'}}),
    modelStore: obs({isGenerationBusy: false}),
    ttsStore: obs({playbackState: {mode: 'idle'}}),
    uiStore: {
      setChatWarning: jest.fn(),
      l10n: {
        voiceAndSpeech: {
          voiceInput: {
            wakeNeedsModel: 'need model',
            noPermission: 'no mic',
            wakeFailed: 'failed',
          },
        },
      },
    },
    voiceStore: obs({
      state: 'idle',
      wakeEnabled: true,
      wakePhrase: 'Hey Agent',
      conversationMode: false,
      language: 'auto',
      selectedModel: {repo: 'r/m', file: 'ggml-base.bin'},
      verifyModels: () => Promise.resolve(),
      setWakeEnabled(on: boolean) {
        this.wakeEnabled = on;
      },
    }),
  };
});
jest.mock('../speechInput', () => {
  const actual = jest.requireActual('../speechInput');
  return {
    ...actual,
    requestMicPermission: jest.fn(() => Promise.resolve(true)),
    transcribe: jest.fn(),
    releaseWhisper: jest.fn(() => Promise.resolve()),
  };
});
jest.mock('../voiceController', () => ({
  sendSpoken: jest.fn(),
  startVoiceInput: jest.fn(() => Promise.resolve('started')),
  setBeforeListen: jest.fn(),
}));

const store = jest.requireMock('../../../store');
const speech = jest.requireMock('../speechInput');
const controller = jest.requireMock('../voiceController');
import {disableWake, enableWake, isWakeStreaming, watchWake} from '../wakeWord';

const emit = (LiveAudioStream as any).emit as (b64: string) => void;
const chunkB64 = (amplitude: number) => {
  const samples = new Int16Array(1600);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin(i / 3) * amplitude * 32767);
  }
  const bytes = new Uint8Array(samples.buffer);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return globalThis.btoa(binary);
};
/** Quiet, one utterance, then a pause. */
const utter = () => {
  for (let t = 0; t < 1000; t += 100) {
    emit(chunkB64(0.001));
  }
  for (let t = 0; t < 800; t += 100) {
    emit(chunkB64(0.3));
  }
  for (let t = 0; t < 800; t += 100) {
    emit(chunkB64(0.001));
  }
};
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
};

describe('wake word', () => {
  let stop: () => void;
  const native = {
    start: jest.fn(() => Promise.resolve(true)),
    stop: jest.fn(() => Promise.resolve(true)),
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'android');
    NativeModules.WakeListen = native;
    runInAction(() => {
      store.voiceStore.wakeEnabled = true;
      store.voiceStore.state = 'idle';
      store.chatSessionStore.agentUiState = {status: 'idle'};
    });
    stop = watchWake();
  });
  afterEach(() => {
    stop();
    jest.useRealTimers();
  });

  const listening = async () => {
    jest.advanceTimersByTime(1600);
    await settle();
  };

  it('starts the background service and opens the mic when idle', async () => {
    await listening();
    expect(native.start).toHaveBeenCalledWith('Hey Agent');
    expect(LiveAudioStream.start).toHaveBeenCalled();
    expect(isWakeStreaming()).toBe(true);
    expect(controller.setBeforeListen).toHaveBeenCalled();
  });

  it('wakes and sends a request said in the same breath', async () => {
    await listening();
    speech.transcribe.mockResolvedValue('Hey Agent, what time is it?');
    utter();
    await settle();
    expect(controller.sendSpoken).toHaveBeenCalledWith('what time is it?');
    expect(isWakeStreaming()).toBe(false);
  });

  it('wakes and listens when only the phrase was said', async () => {
    await listening();
    speech.transcribe.mockResolvedValue('Hey agent.');
    utter();
    await settle();
    expect(controller.startVoiceInput).toHaveBeenCalled();
    expect(controller.sendSpoken).not.toHaveBeenCalled();
  });

  it('ignores other speech and keeps listening', async () => {
    await listening();
    speech.transcribe.mockResolvedValue('What a nice day');
    utter();
    await settle();
    expect(controller.sendSpoken).not.toHaveBeenCalled();
    expect(controller.startVoiceInput).not.toHaveBeenCalled();
    expect(isWakeStreaming()).toBe(true);
  });

  it('lets go of the mic while answering or speaking', async () => {
    await listening();
    runInAction(() => {
      store.chatSessionStore.agentUiState = {status: 'streaming_text'};
    });
    expect(isWakeStreaming()).toBe(false);
    runInAction(() => {
      store.chatSessionStore.agentUiState = {status: 'done'};
      store.ttsStore.playbackState = {mode: 'playing'};
    });
    await listening();
    expect(isWakeStreaming()).toBe(false);
    runInAction(() => {
      store.ttsStore.playbackState = {mode: 'idle'};
    });
    await listening();
    expect(isWakeStreaming()).toBe(true);
  });

  it('Stop in the notification turns it off', async () => {
    await listening();
    DeviceEventEmitter.emit('PocketAgentWakeStop');
    await settle();
    expect(store.voiceStore.wakeEnabled).toBe(false);
    expect(native.stop).toHaveBeenCalled();
    expect(isWakeStreaming()).toBe(false);
  });

  it('needs a speech-to-text model to turn on', async () => {
    const model = store.voiceStore.selectedModel;
    runInAction(() => {
      store.voiceStore.selectedModel = undefined;
    });
    expect(await enableWake()).toBe(false);
    expect(store.uiStore.setChatWarning).toHaveBeenCalledWith(
      expect.objectContaining({message: 'need model'}),
    );
    expect(store.voiceStore.wakeEnabled).toBe(false);
    runInAction(() => {
      store.voiceStore.selectedModel = model;
    });
  });

  it('turning off frees the model when nothing else needs it', async () => {
    await disableWake();
    expect(speech.releaseWhisper).toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalled();
  });
});
