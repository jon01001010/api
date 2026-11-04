/**
 * Wake word, using the same Whisper model as voice input: the microphone
 * stays open, each utterance (speech then a pause) is written down by
 * Whisper, and if it starts with the wake phrase the app wakes. Anything
 * said after the phrase in the same breath ("Hey Agent, what's the time?")
 * is the request; otherwise the app listens for it.
 *
 * Runs in the background through WakeListenService (Android), which holds
 * the microphone and shows the "listening" notification with Stop.
 */
import {
  DeviceEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Vibration,
} from 'react-native';
import {reaction} from 'mobx';
import LiveAudioStream from '@fugood/react-native-audio-pcm-stream';

import {
  chatSessionStore,
  modelStore,
  ttsStore,
  uiStore,
  voiceStore,
} from '../../store';
import {createSegmenter} from './endpointer';
import {
  base64ToBytes,
  releaseWhisper,
  SpeechMemoryError,
  requestMicPermission,
  SAMPLE_RATE,
  transcribe,
} from './speechInput';
import {whisperModelPath} from './whisperModels';
import {
  memoryMessage,
  sendSpoken,
  setBeforeListen,
  startVoiceInput,
} from './voiceController';

export const DEFAULT_WAKE_PHRASE = 'Hey Agent';

/** Lower-case words without punctuation. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Whisper spells names loosely ("Agent" / "agents" / "a gent"). */
const sameWord = (heard: string, wanted: string) =>
  heard === wanted ||
  (wanted.length >= 4 && editDistance(heard, wanted) <= 1) ||
  (wanted.length >= 7 && editDistance(heard, wanted) <= 2);

/**
 * Does the utterance start with the wake phrase? A couple of filler words
 * before it ("okay, hey agent") are allowed. Returns what came after it.
 */
export function matchWake(
  transcript: string,
  phrase: string,
): {woke: boolean; rest: string} {
  const wanted = words(phrase);
  const raw = transcript.trim().split(/\s+/).filter(Boolean);
  const heard = raw.map(w => words(w).join(''));
  if (!wanted.length) {
    return {woke: false, rest: ''};
  }
  for (let start = 0; start <= Math.min(2, heard.length - 1); start++) {
    let i = start;
    let ok = true;
    for (const w of wanted) {
      // "agent" may come out as two words ("a gent"): try joining.
      if (i < heard.length && sameWord(heard[i], w)) {
        i += 1;
      } else if (i + 1 < heard.length && sameWord(heard[i] + heard[i + 1], w)) {
        i += 2;
      } else {
        ok = false;
        break;
      }
    }
    if (ok) {
      const rest = raw
        .slice(i)
        .join(' ')
        .replace(/^[\s,.!?;:-]+/, '')
        .trim();
      return {woke: true, rest};
    }
  }
  return {woke: false, rest: ''};
}

export interface WakeTarget {
  phrase: string;
  /** Model that answers; undefined = the loaded (or last used) model. */
  modelId?: string;
}

/** All phrases to listen for: the general one plus each model's own. */
export function wakeTargets(): WakeTarget[] {
  const targets: WakeTarget[] = [{phrase: voiceStore.wakePhrase}];
  for (const m of modelStore.models ?? []) {
    if (!m.isDownloaded) {
      continue;
    }
    for (const phrase of m.wakeWords ?? []) {
      targets.push({phrase, modelId: m.id});
    }
  }
  return targets;
}

/**
 * Which target the utterance woke, if any. When several match, the
 * longest phrase wins ("Hey Jarvis" over a general "Hey").
 */
export function matchTargets(
  transcript: string,
  targets: WakeTarget[],
): {target: WakeTarget; rest: string} | null {
  let best: {target: WakeTarget; rest: string} | null = null;
  for (const target of targets) {
    const {woke, rest} = matchWake(transcript, target.phrase);
    if (
      woke &&
      (!best || words(target.phrase).length > words(best.target.phrase).length)
    ) {
      best = {target, rest};
    }
  }
  return best;
}

/**
 * Load the model the wake word asked for (or, for the general phrase,
 * the last used one when nothing is loaded).
 */
async function ensureModelFor(target: WakeTarget): Promise<boolean> {
  const wanted = target.modelId
    ? modelStore.models.find(m => m.id === target.modelId)
    : (modelStore.activeModel ?? modelStore.lastUsedModel);
  if (!wanted) {
    return !!modelStore.activeModel;
  }
  if (modelStore.activeModelId === wanted.id) {
    return true;
  }
  try {
    await modelStore.selectModel(wanted);
  } catch (error) {
    console.warn('[wake] could not load model', error);
  }
  return modelStore.activeModelId === wanted.id;
}

const replyRunning = () =>
  modelStore.isGenerationBusy ||
  [
    'prefill',
    'streaming_text',
    'generating_tool_call',
    'executing_tool',
  ].includes(chatSessionStore.agentUiState?.status ?? 'idle');

let streaming = false;
let checking = false;
const segmenter = createSegmenter(audio => {
  onUtterance(audio).catch(() => {});
});

async function onUtterance(audio: Uint8Array) {
  const model = voiceStore.selectedModel;
  // One check at a time; skip while the app is busy with voice or a reply.
  if (checking || !model || voiceStore.state !== 'idle' || replyRunning()) {
    return;
  }
  checking = true;
  try {
    const text = await transcribe(
      whisperModelPath(model),
      audio,
      voiceStore.language,
    );
    voiceStore.setLastHeard(text || '…');
    const hit = matchTargets(text, wakeTargets());
    if (!hit || voiceStore.state !== 'idle' || !streaming) {
      return;
    }
    const {target, rest} = hit;
    Vibration.vibrate(60);
    pauseStream();
    // Busy while the right model loads, so the mic stays closed.
    voiceStore.setState('transcribing');
    const ready = await ensureModelFor(target);
    voiceStore.setState('idle');
    if (!ready) {
      warn(uiStore.l10n.voiceAndSpeech.voiceInput.wakeModelFailed);
      return;
    }
    if (rest) {
      sendSpoken(rest);
    } else {
      await startVoiceInput();
    }
  } catch (error) {
    console.warn('[wake] check failed', error);
    // Shown in Voice input settings, not as a popup on every utterance.
    voiceStore.setWakeStatus(
      'error',
      error instanceof SpeechMemoryError
        ? memoryMessage(error)
        : String((error as Error)?.message ?? error),
    );
  } finally {
    checking = false;
  }
}

function startStream() {
  if (streaming) {
    return;
  }
  streaming = true;
  voiceStore.setWakeStatus('listening');
  segmenter.reset();
  LiveAudioStream.init({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
    audioSource: 6,
    bufferSize: 4096,
    wavFile: '',
  });
  LiveAudioStream.on('data', (b64: string) => {
    if (streaming) {
      segmenter.push(base64ToBytes(b64));
    }
  });
  LiveAudioStream.start();
}

function pauseStream() {
  if (!streaming) {
    return;
  }
  streaming = false;
  segmenter.reset();
  Promise.resolve(LiveAudioStream.stop()).catch(() => {});
  if (voiceStore.wakeStatus === 'listening') {
    voiceStore.setWakeStatus(voiceStore.wakeEnabled ? 'paused' : 'off');
  }
}

const nativeWake = () =>
  Platform.OS === 'android' ? NativeModules.WakeListen : undefined;

async function requestNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return;
  }
  const permission = (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS;
  if (permission) {
    await PermissionsAndroid.request(permission).catch(() => {});
  }
}

const warn = (message: string) =>
  uiStore.setChatWarning({
    code: 'unknown',
    message,
    context: 'chat',
    recoverable: true,
    severity: 'warning',
  } as any);

/**
 * Turn the wake word on. Must be called while the app is on screen
 * (Android only lets a microphone service start then).
 */
export async function enableWake(): Promise<boolean> {
  const t = uiStore.l10n.voiceAndSpeech.voiceInput;
  await voiceStore.verifyModels().catch(() => {});
  if (!voiceStore.selectedModel) {
    warn(t.wakeNeedsModel);
    voiceStore.setWakeEnabled(false);
    return false;
  }
  if (!(await requestMicPermission())) {
    warn(t.noPermission);
    voiceStore.setWakeEnabled(false);
    return false;
  }
  await requestNotificationPermission();
  const native = nativeWake();
  const fail = (reason: string) => {
    warn(`${t.wakeFailed} (${reason})`);
    voiceStore.setWakeStatus(
      'error',
      t.wakeStatusError.replace('{{reason}}', reason),
    );
    voiceStore.setWakeEnabled(false);
    return false;
  };
  if (Platform.OS === 'android' && !native?.start) {
    // Never skip silently: say the native part is missing.
    return fail(t.wakeNoNative);
  }
  try {
    await native?.start(voiceStore.wakePhrase);
  } catch (error) {
    console.warn('[wake] service failed to start', error);
    return fail(String((error as Error)?.message ?? error));
  }
  voiceStore.setWakeEnabled(true);
  voiceStore.setWakeStatus(streaming ? 'listening' : 'paused');
  return true;
}

export async function disableWake(): Promise<void> {
  voiceStore.setWakeEnabled(false);
  pauseStream();
  voiceStore.setWakeStatus('off');
  await nativeWake()
    ?.stop()
    .catch(() => {});
  if (!voiceStore.conversationMode) {
    await releaseWhisper();
  }
}

/**
 * While the wake word is on, keep the mic open whenever the app is idle,
 * and close it while it's listening to a request, answering or speaking
 * (so it never hears itself). Returns a disposer.
 */
export function watchWake(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = reaction(
    () => ({
      on: voiceStore.wakeEnabled,
      idle:
        voiceStore.state === 'idle' &&
        !replyRunning() &&
        (ttsStore.playbackState?.mode ?? 'idle') === 'idle',
    }),
    ({on, idle}) => {
      clearTimeout(timer);
      if (!on || !idle) {
        pauseStream();
        return;
      }
      // Let a just-finished turn settle: auto-speak may be about to start,
      // and conversation mode (after 800 ms) gets the mic first.
      timer = setTimeout(() => {
        if (voiceStore.wakeEnabled && voiceStore.state === 'idle') {
          startStream();
        }
      }, 1500);
    },
    {fireImmediately: true},
  );
  setBeforeListen(pauseStream);
  // The native service couldn't start (and stopped itself).
  const serviceError = DeviceEventEmitter.addListener(
    'PocketAgentWakeError',
    (reason: string) => {
      voiceStore.setWakeEnabled(false);
      pauseStream();
      voiceStore.setWakeStatus(
        'error',
        uiStore.l10n.voiceAndSpeech.voiceInput.wakeStatusError.replace(
          '{{reason}}',
          String(reason),
        ),
      );
    },
  );
  const stopFromNotification = DeviceEventEmitter.addListener(
    'PocketAgentWakeStop',
    () => {
      disableWake().catch(() => {});
    },
  );
  // Re-start the service if the wake word was left on (app is visible now).
  if (voiceStore.wakeEnabled) {
    enableWake().catch(() => {});
  }
  return () => {
    clearTimeout(timer);
    dispose();
    stopFromNotification.remove();
    serviceError.remove();
    setBeforeListen(null);
    pauseStream();
  };
}

/** For tests. */
export function isWakeStreaming() {
  return streaming;
}
