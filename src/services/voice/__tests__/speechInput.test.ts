import LiveAudioStream from '@fugood/react-native-audio-pcm-stream';
import {initWhisper} from 'whisper.rn';

import * as RNFS from '@dr.pogodin/react-native-fs';
import NativeHardwareInfo from '../../../specs/NativeHardwareInfo';
import {
  SpeechMemoryError,
  base64ToBytes,
  cleanTranscript,
  listen,
  releaseWhisper,
  transcribe,
} from '../speechInput';

const emit = (LiveAudioStream as any).emit as (b64: string) => void;

/** base64 of a 100 ms chunk of 16-bit PCM at a loudness. */
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
const say = (amp: number, ms: number) => {
  for (let t = 0; t < ms; t += 100) {
    emit(chunkB64(amp));
  }
};

describe('speechInput', () => {
  beforeEach(() => jest.clearAllMocks());

  it('decodes base64 audio', () => {
    expect([...base64ToBytes(globalThis.btoa('\x01\x02'))]).toEqual([1, 2]);
  });

  it('records until the user stops speaking', async () => {
    const levels: number[] = [];
    const handle = listen(l => levels.push(l));
    expect(LiveAudioStream.init).toHaveBeenCalledWith(
      expect.objectContaining({
        sampleRate: 16000,
        channels: 1,
        bitsPerSample: 16,
      }),
    );
    say(0.001, 300);
    say(0.3, 800);
    say(0.001, 1300);
    const {audio, reason} = await handle.result;
    expect(reason).toBe('done');
    expect(audio!.length).toBeGreaterThan(0);
    expect(LiveAudioStream.stop).toHaveBeenCalled();
    expect(Math.max(...levels)).toBeGreaterThan(0.1);
  });

  it('returns nothing when nobody spoke', async () => {
    const handle = listen();
    say(0.001, 8000);
    expect((await handle.result).audio).toBeNull();
  });

  it('stop() keeps what was heard; cancel() drops it', async () => {
    const a = listen();
    say(0.3, 500);
    a.stop();
    expect((await a.result).audio).not.toBeNull();

    const b = listen();
    say(0.3, 500);
    b.cancel();
    expect((await b.result).audio).toBeNull();
  });

  it('gives up cleanly when the microphone is busy', async () => {
    (LiveAudioStream.init as jest.Mock).mockReturnValueOnce(
      Promise.reject(new Error('AudioRecord initialization failed')),
    );
    const handle = listen();
    expect(await handle.result).toEqual({
      audio: null,
      reason: 'mic-unavailable',
    });
  });

  it('removes Whisper non-speech marks', () => {
    expect(
      cleanTranscript(' [BLANK_AUDIO] Hello (music) there *coughs* '),
    ).toBe('Hello there');
  });

  it('transcribes with the chosen model and reuses it', async () => {
    const audio = new Uint8Array(3200);
    expect(await transcribe('/m/a.bin', audio, 'en')).toBe('Hello there');
    await transcribe('/m/a.bin', audio);
    expect(initWhisper).toHaveBeenCalledTimes(1);
    expect(initWhisper).toHaveBeenCalledWith(
      expect.objectContaining({filePath: '/m/a.bin'}),
    );
    await transcribe('/m/b.bin', audio);
    expect(initWhisper).toHaveBeenCalledTimes(2);
    await releaseWhisper();
  });

  it("won't load the speech model when memory is too low", async () => {
    await releaseWhisper();
    (RNFS.stat as jest.Mock).mockResolvedValueOnce({size: 150e6});
    (NativeHardwareInfo.getAvailableMemory as jest.Mock).mockResolvedValueOnce(
      200e6,
    );
    (initWhisper as jest.Mock).mockClear();
    await expect(
      transcribe('/m/base.bin', new Uint8Array(4)),
    ).rejects.toBeInstanceOf(SpeechMemoryError);
    expect(initWhisper).not.toHaveBeenCalled();
  });

  it('loads it when there is room', async () => {
    await releaseWhisper();
    (RNFS.stat as jest.Mock).mockResolvedValueOnce({size: 75e6});
    (NativeHardwareInfo.getAvailableMemory as jest.Mock).mockResolvedValueOnce(
      2e9,
    );
    expect(await transcribe('/m/tiny.bin', new Uint8Array(4))).toBe(
      'Hello there',
    );
    await releaseWhisper();
  });
});
