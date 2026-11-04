import {runInAction} from 'mobx';
import {PermissionsAndroid, Platform} from 'react-native';
import LiveAudioStream from '@fugood/react-native-audio-pcm-stream';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {ttsStore, uiStore, voiceStore} from '../../../store';
import {
  resetVoiceController,
  setVoiceSender,
  startVoiceInput,
} from '../voiceController';

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
/** Speak for a second, then pause long enough to end the turn. */
const speak = () => {
  for (let t = 0; t < 1000; t += 100) {
    emit(chunkB64(0.3));
  }
  for (let t = 0; t < 1300; t += 100) {
    emit(chunkB64(0.001));
  }
};
const flush = () => new Promise(r => setTimeout(r, 0));

const model = {
  repo: 'ggerganov/whisper.cpp',
  file: 'ggml-base.en.bin',
  path: '/x',
  size: 1,
};

describe('voiceController', () => {
  let send: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetVoiceController();
    send = jest.fn();
    setVoiceSender(send);
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true as any);
    runInAction(() => {
      voiceStore.models = [model];
      voiceStore.selectedModelId = null;
      voiceStore.conversationMode = false;
      voiceStore.state = 'idle';
      voiceStore.isSheetOpen = false;
    });
  });

  it('opens Voice input settings when no model is downloaded', async () => {
    runInAction(() => {
      voiceStore.models = [];
    });
    expect(await startVoiceInput()).toBe('no-model');
    expect(voiceStore.isSheetOpen).toBe(true);
  });

  it('listens, writes down what was said and sends it', async () => {
    expect(await startVoiceInput()).toBe('started');
    expect(voiceStore.state).toBe('listening');
    expect(ttsStore.stop).toHaveBeenCalled();
    speak();
    await flush();
    await flush();
    expect(send).toHaveBeenCalledWith('Hello there');
    expect(voiceStore.state).toBe('idle');
  });

  it('asks again later when the mic permission is refused', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    (PermissionsAndroid.check as jest.Mock).mockResolvedValue(false);
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
    expect(await startVoiceInput()).toBe('no-permission');
    expect(uiStore.setChatWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        message: uiStore.l10n.voiceAndSpeech.voiceInput.noPermission,
      }),
    );
    expect(voiceStore.state).toBe('idle');
  });

  it('ignores a second tap while busy', async () => {
    await startVoiceInput();
    expect(await startVoiceInput()).toBe('busy');
  });
});
