/**
 * Voice input flow: mic → speech-to-text → send, and conversation mode
 * (after the answer has been spoken, listen again).
 *
 * The chat input registers the function that sends text (setVoiceSender),
 * so a spoken message goes through the normal send path.
 */
import {reaction} from 'mobx';

import {
  chatSessionStore,
  modelStore,
  ttsStore,
  uiStore,
  voiceStore,
} from '../../store';
import {whisperModelPath} from './whisperModels';
import {
  listen,
  releaseWhisper,
  requestMicPermission,
  transcribe,
  type ListenHandle,
} from './speechInput';

export type StartResult =
  | 'started'
  | 'no-model'
  | 'no-permission'
  | 'busy'
  | 'no-sender';

let sender: ((text: string) => void) | null = null;
let active: ListenHandle | null = null;
/** A spoken message was sent; waiting for its answer to finish. */
let awaitingReply = false;
let replyStarted = false;

export function setVoiceSender(fn: ((text: string) => void) | null) {
  sender = fn;
}

const warn = (message: string) =>
  uiStore.setChatWarning({
    code: 'unknown',
    message,
    context: 'chat',
    recoverable: true,
    severity: 'warning',
  } as any);

/** Tap the mic: listen, transcribe, send. */
export async function startVoiceInput(): Promise<StartResult> {
  if (voiceStore.state !== 'idle') {
    return 'busy';
  }
  if (!sender) {
    return 'no-sender';
  }
  await voiceStore.verifyModels().catch(() => {});
  const model = voiceStore.selectedModel;
  if (!model) {
    voiceStore.openSheet();
    return 'no-model';
  }
  voiceStore.setState('listening');
  if (!(await requestMicPermission())) {
    voiceStore.setState('idle');
    warn(uiStore.l10n.voiceAndSpeech.voiceInput.noPermission);
    return 'no-permission';
  }
  // Don't record the app's own voice.
  await ttsStore.stop().catch(() => {});

  const handle = listen(level => voiceStore.setLevel(level));
  active = handle;
  run(handle, whisperModelPath(model)).catch(() => {});
  return 'started';
}

async function run(handle: ListenHandle, modelPath: string) {
  try {
    const {audio} = await handle.result;
    if (!audio) {
      return;
    }
    voiceStore.setState('transcribing');
    const text = await transcribe(modelPath, audio, voiceStore.language);
    if (text && sender) {
      awaitingReply = true;
      replyStarted = false;
      sender(text);
    } else if (!text) {
      warn(uiStore.l10n.voiceAndSpeech.voiceInput.nothingHeard);
    }
  } catch (error) {
    console.warn('[voice] input failed', error);
    warn(uiStore.l10n.voiceAndSpeech.voiceInput.failed);
  } finally {
    if (active === handle) {
      active = null;
    }
    voiceStore.setState('idle');
    if (!voiceStore.conversationMode) {
      releaseWhisper().catch(() => {});
    }
  }
}

/** Tap while listening: stop and use what was heard. */
export function stopVoiceInput() {
  active?.stop();
}

/** Stop and discard; also ends a conversation round. */
export function cancelVoiceInput() {
  awaitingReply = false;
  active?.cancel();
}

const replyRunning = () =>
  modelStore.isGenerationBusy ||
  [
    'prefill',
    'streaming_text',
    'generating_tool_call',
    'executing_tool',
  ].includes(chatSessionStore.agentUiState.status);

/**
 * Conversation mode: once the answer to a spoken message has finished and
 * been spoken, start listening again. Returns a disposer.
 */
export function watchConversation(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = reaction(
    () => ({
      running: replyRunning(),
      speaking: (ttsStore.playbackState?.mode ?? 'idle') !== 'idle',
    }),
    ({running, speaking}) => {
      if (!awaitingReply) {
        return;
      }
      if (running) {
        replyStarted = true;
        return;
      }
      if (!replyStarted || speaking) {
        return;
      }
      clearTimeout(timer);
      // Short pause so auto-speak can start before deciding it is done.
      timer = setTimeout(() => {
        if (
          !awaitingReply ||
          replyRunning() ||
          (ttsStore.playbackState?.mode ?? 'idle') !== 'idle'
        ) {
          return;
        }
        awaitingReply = false;
        if (voiceStore.conversationMode) {
          startVoiceInput().catch(() => {});
        } else {
          releaseWhisper().catch(() => {});
        }
      }, 800);
    },
  );
  return () => {
    clearTimeout(timer);
    dispose();
  };
}

/** For tests. */
export function resetVoiceController() {
  sender = null;
  active = null;
  awaitingReply = false;
  replyStarted = false;
}
