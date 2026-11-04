/**
 * Voice input: record from the microphone until the user stops speaking,
 * then turn the audio into text with a Whisper model (whisper.rn), all on
 * the phone. The Whisper model stays loaded only while it is being used
 * (see releaseWhisper).
 */
import {PermissionsAndroid, Platform} from 'react-native';
import LiveAudioStream from '@fugood/react-native-audio-pcm-stream';
import {initWhisper, type WhisperContext} from 'whisper.rn';

import {createEndpointer, type EndpointState} from './endpointer';

export const SAMPLE_RATE = 16000;

export async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permission)) {
    return true;
  }
  const result = await PermissionsAndroid.request(permission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Base64 → bytes, without depending on a Buffer polyfill. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface ListenResult {
  /** 16-bit mono PCM at 16 kHz, or null when nothing was said. */
  audio: Uint8Array | null;
  reason: EndpointState | 'stopped';
}

export interface ListenHandle {
  /** Resolves when the user stops speaking, or on stop(). */
  result: Promise<ListenResult>;
  /** Stop now and keep what was heard. */
  stop: () => void;
  /** Stop now and discard it. */
  cancel: () => void;
}

/** Record until the user finishes speaking. */
export function listen(onLevel?: (level: number) => void): ListenHandle {
  const chunks: Uint8Array[] = [];
  const endpointer = createEndpointer({sampleRate: SAMPLE_RATE});
  let finished = false;
  let heardSpeech = false;
  let finish: (r: ListenResult) => void = () => {};
  const result = new Promise<ListenResult>(resolve => {
    finish = resolve;
  });
  let subscription: {remove: () => void} | undefined;

  const end = (reason: ListenResult['reason'], keep: boolean) => {
    if (finished) {
      return;
    }
    finished = true;
    subscription?.remove();
    Promise.resolve(LiveAudioStream.stop()).catch(() => {});
    if (!keep || (!heardSpeech && reason !== 'stopped') || !chunks.length) {
      finish({audio: null, reason});
      return;
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      audio.set(c, at);
      at += c.length;
    }
    finish({audio, reason});
  };

  LiveAudioStream.init({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
    audioSource: 6, // VOICE_RECOGNITION: tuned for speech
    bufferSize: 4096,
    wavFile: '',
  });
  subscription = LiveAudioStream.on('data', (b64: string) => {
    if (finished) {
      return;
    }
    const bytes = base64ToBytes(b64);
    chunks.push(bytes);
    const samples = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.length / 2),
    );
    const state = endpointer.push(samples);
    onLevel?.(endpointer.level);
    if (state === 'speaking') {
      heardSpeech = true;
    }
    if (state === 'done' || state === 'no-speech') {
      end(state, true);
    }
  }) as unknown as {remove: () => void} | undefined;
  LiveAudioStream.start();

  return {
    result,
    stop: () => end('stopped', true),
    cancel: () => end('stopped', false),
  };
}

let loaded: {path: string; context: WhisperContext} | null = null;
let loading: Promise<WhisperContext> | null = null;

async function getWhisper(path: string): Promise<WhisperContext> {
  if (loaded?.path === path) {
    return loaded.context;
  }
  if (loading) {
    await loading.catch(() => {});
    if (loaded?.path === path) {
      return loaded.context;
    }
  }
  await releaseWhisper();
  loading = initWhisper({filePath: path, useGpu: false});
  try {
    const context = await loading;
    loaded = {path, context};
    return context;
  } finally {
    loading = null;
  }
}

/** Free the Whisper model's memory. */
export async function releaseWhisper(): Promise<void> {
  const current = loaded;
  loaded = null;
  await current?.context.release().catch(() => {});
}

/** Whisper marks non-speech like [BLANK_AUDIO], (music), *coughs*. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function transcribe(
  modelPath: string,
  audio: Uint8Array,
  language = 'auto',
): Promise<string> {
  const context = await getWhisper(modelPath);
  const copy = audio.slice().buffer;
  const {promise} = context.transcribeData(copy, {
    language,
    maxThreads: 4,
  });
  const {result, isAborted} = await promise;
  return isAborted ? '' : cleanTranscript(result ?? '');
}
