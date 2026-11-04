import {runInAction} from 'mobx';
import {DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import LiveAudioStream from '@fugood/react-native-audio-pcm-stream';

jest.mock('../../../store', () => {
  const {observable: obs} = jest.requireActual('mobx');
  return {
    chatSessionStore: obs({agentUiState: {status: 'idle'}}),
    modelStore: obs(
      {
        isGenerationBusy: false,
        activeModelId: 'qwen' as string | undefined,
        models: [
          {id: 'qwen', name: 'Qwen', isDownloaded: true, wakeWords: []},
          {
            id: 'jarvis-model',
            name: 'Jarvis',
            isDownloaded: true,
            wakeWords: ['Hey Jarvis', 'Jarvis'],
          },
          {
            id: 'not-downloaded',
            name: 'Friday',
            isDownloaded: false,
            wakeWords: ['Hey Friday'],
          },
        ],
        get activeModel() {
          return this.models.find((m: any) => m.id === this.activeModelId);
        },
        get lastUsedModel() {
          return this.models[0];
        },
        selectModel: jest.fn(function (this: any, m: any) {
          this.activeModelId = m.id;
          return Promise.resolve();
        }),
      },
      {selectModel: false},
    ),
    ttsStore: obs({playbackState: {mode: 'idle'}}),
    uiStore: {
      setChatWarning: jest.fn(),
      l10n: {
        voiceAndSpeech: {
          voiceInput: {
            wakeNeedsModel: 'need model',
            noPermission: 'no mic',
            wakeFailed: 'failed',
            wakeStatusError: 'Not listening: {{reason}}',
            wakeNoNative: 'no native part',
            notEnoughMemory: 'low memory {{needed}} {{available}}',
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
      setState(state: string) {
        this.state = state;
      },
      wakeStatus: 'off',
      wakeError: null as string | null,
      lastHeard: null as string | null,
      setWakeStatus(status: string, error: string | null = null) {
        this.wakeStatus = status;
        this.wakeError = error;
      },
      setLastHeard(text: string | null) {
        this.lastHeard = text;
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
  memoryMessage: (e: any) =>
    `low memory ${Math.round(e.neededBytes / 1e6)} MB ${Math.round(
      e.availableBytes / 1e6,
    )} MB`,
}));

const store = jest.requireMock('../../../store');
const speech = jest.requireMock('../speechInput');
const controller = jest.requireMock('../voiceController');
import {
  disableWake,
  enableWake,
  isWakeStreaming,
  matchTargets,
  resetWakeForTests,
  watchWake,
  wakeTargets,
} from '../wakeWord';

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
      store.modelStore.activeModelId = 'qwen';
    });
    resetWakeForTests();
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

  it('starts the service when saved settings load after startup', async () => {
    stop();
    resetWakeForTests();
    native.start.mockClear();
    runInAction(() => {
      store.voiceStore.wakeEnabled = false; // not loaded yet
    });
    stop = watchWake();
    await settle();
    expect(native.start).not.toHaveBeenCalled();
    runInAction(() => {
      store.voiceStore.wakeEnabled = true; // saved setting arrives
    });
    await settle();
    expect(native.start).toHaveBeenCalledTimes(1);
    await listening();
    expect(isWakeStreaming()).toBe(true);
  });

  it("doesn't restart the service on every pause", async () => {
    await listening();
    runInAction(() => {
      store.chatSessionStore.agentUiState = {status: 'streaming_text'};
    });
    runInAction(() => {
      store.chatSessionStore.agentUiState = {status: 'done'};
    });
    await listening();
    expect(native.start).toHaveBeenCalledTimes(1);
  });

  it('starts the background service and opens the mic when idle', async () => {
    await listening();
    expect(native.start).toHaveBeenCalledWith('Hey Agent');
    expect(LiveAudioStream.start).toHaveBeenCalled();
    expect(isWakeStreaming()).toBe(true);
    expect(controller.setBeforeListen).toHaveBeenCalled();
  });

  it('wakes and sends a request said in the same breath', async () => {
    await listening();
    // Sending starts a reply, which takes the mic.
    controller.sendSpoken.mockImplementationOnce(() =>
      runInAction(() => {
        store.chatSessionStore.agentUiState = {status: 'prefill'};
      }),
    );
    speech.transcribe.mockResolvedValue('Hey Agent, what time is it?');
    utter();
    await settle();
    expect(controller.sendSpoken).toHaveBeenCalledWith('what time is it?');
    expect(isWakeStreaming()).toBe(false);
    // When the answer is done, it listens again (no timer needed).
    runInAction(() => {
      store.chatSessionStore.agentUiState = {status: 'done'};
    });
    expect(isWakeStreaming()).toBe(true);
  });

  it('wakes and listens when only the phrase was said', async () => {
    await listening();
    speech.transcribe.mockResolvedValue('Hey agent.');
    utter();
    await settle();
    expect(controller.startVoiceInput).toHaveBeenCalled();
    expect(controller.sendSpoken).not.toHaveBeenCalled();
  });

  it("a model's own wake word loads that model first", async () => {
    await listening();
    speech.transcribe.mockResolvedValue('Hey Jarvis, tell me a joke');
    utter();
    await settle();
    expect(store.modelStore.selectModel).toHaveBeenCalledWith(
      expect.objectContaining({id: 'jarvis-model'}),
    );
    expect(store.modelStore.activeModelId).toBe('jarvis-model');
    expect(controller.sendSpoken).toHaveBeenCalledWith('tell me a joke');
  });

  it('the general phrase loads the last used model when none is loaded', async () => {
    runInAction(() => {
      store.modelStore.activeModelId = undefined;
    });
    await listening();
    speech.transcribe.mockResolvedValue('Hey Agent, hello');
    utter();
    await settle();
    expect(store.modelStore.selectModel).toHaveBeenCalledWith(
      expect.objectContaining({id: 'qwen'}),
    );
    expect(controller.sendSpoken).toHaveBeenCalledWith('hello');
  });

  it("doesn't reload a model that is already loaded", async () => {
    await listening();
    speech.transcribe.mockResolvedValue('Hey Agent, hello');
    utter();
    await settle();
    expect(store.modelStore.selectModel).not.toHaveBeenCalled();
  });

  it('listens for every downloaded model, longest phrase first', () => {
    const targets = wakeTargets();
    expect(targets.map(t => t.phrase)).toEqual([
      'Hey Agent',
      'Hey Jarvis',
      'Jarvis',
    ]);
    expect(matchTargets('Hey Jarvis, hi', targets)).toEqual({
      target: {phrase: 'Hey Jarvis', modelId: 'jarvis-model'},
      rest: 'hi',
    });
    expect(matchTargets('Jarvis hi', targets)?.target.modelId).toBe(
      'jarvis-model',
    );
    expect(matchTargets('Hey Friday', targets)).toBeNull();
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

  it('shows what it heard and that it is listening', async () => {
    await listening();
    expect(store.voiceStore.wakeStatus).toBe('listening');
    speech.transcribe.mockResolvedValue('Hey, Asian.');
    utter();
    await settle();
    expect(store.voiceStore.lastHeard).toBe('Hey, Asian.');
    expect(controller.sendSpoken).not.toHaveBeenCalled();
  });

  it('never fails silently when the native part is missing', async () => {
    delete (NativeModules as any).WakeListen;
    expect(await enableWake()).toBe(false);
    expect(store.uiStore.setChatWarning).toHaveBeenCalledWith(
      expect.objectContaining({message: 'failed (no native part)'}),
    );
    expect(store.voiceStore.wakeStatus).toBe('error');
    expect(store.voiceStore.wakeError).toBe('Not listening: no native part');
    expect(store.voiceStore.wakeEnabled).toBe(false);
  });

  it('reports why the service failed to start', async () => {
    native.start.mockRejectedValueOnce(new Error('SecurityException: mic'));
    expect(await enableWake()).toBe(false);
    expect(store.voiceStore.wakeError).toBe(
      'Not listening: SecurityException: mic',
    );
  });

  it('shows low memory in the status instead of crashing', async () => {
    await listening();
    speech.transcribe.mockRejectedValue(
      new speech.SpeechMemoryError(400e6, 200e6),
    );
    utter();
    await settle();
    expect(store.voiceStore.wakeStatus).toBe('error');
    expect(store.voiceStore.wakeError).toBe('low memory 400 MB 200 MB');
  });

  it('turns off and says why when Android refuses the service', async () => {
    await listening();
    DeviceEventEmitter.emit('PocketAgentWakeError', 'SecurityException');
    expect(store.voiceStore.wakeEnabled).toBe(false);
    expect(store.voiceStore.wakeError).toBe('Not listening: SecurityException');
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
