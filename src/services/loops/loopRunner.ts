/**
 * Runs loops through the chat (src/services/loops/loops.ts). The chat
 * screen registers how to send; a run switches to the loop's own chat and
 * sends its message there, like the user typing it. When a loop is due the
 * user is asked first: Run now, Later (1 hour) or Skip this one.
 */
import {Alert, AppState} from 'react-native';

import {
  addLog,
  dueLoops,
  isFinished,
  loadLoops,
  nextRun,
  runMessage,
  updateLoop,
  type Loop,
} from './loops';

type Send = (text: string) => Promise<unknown>;

let send: Send | null = null;
let openChat: (() => void) | null = null;

/** The chat screen: how to send a message and how to show the chat. */
export function setLoopSender(fn: Send | null, show: (() => void) | null) {
  send = fn;
  openChat = show;
}

export const LOOK_EVERY_MS = 60_000;
export const LATER_MS = 3600_000;

function deps() {
  const {chatSessionStore, modelStore} = require('../../store');
  return {chatSessionStore, modelStore};
}

/** One run of a loop, now (after the user said so). */
export async function runLoopNow(
  id: string,
  now = Date.now(),
): Promise<string | undefined> {
  const loop = (await loadLoops()).find(l => l.id === id);
  if (!loop) {
    return 'That loop was stopped';
  }
  if (isFinished(loop, now)) {
    return 'This loop has reached its limit (runs or end date)';
  }
  if (!send) {
    return 'Open the chat first';
  }
  const {chatSessionStore, modelStore} = deps();
  if (modelStore.activeModelId === undefined) {
    return 'Load a model first';
  }
  if (modelStore.isGenerationBusy) {
    return 'The model is busy; try again when this reply is done';
  }
  const exists =
    loop.sessionId &&
    chatSessionStore.sessions.some((s: any) => s.id === loop.sessionId);
  if (exists) {
    await chatSessionStore.setActiveSession(loop.sessionId);
  } else {
    chatSessionStore.resetActiveSession();
  }
  openChat?.();
  // Counted before sending, so a run can't repeat by itself.
  await updateLoop(loop.id, l =>
    addLog(
      {...l, runs: l.runs + 1, nextAt: nextRun(l, now)},
      `Run ${l.runs + 1}`,
      now,
    ),
  );
  await send(runMessage(loop));
  const sessionId = chatSessionStore.activeSessionId;
  if (!exists && sessionId) {
    await updateLoop(loop.id, l => ({...l, sessionId}));
    await chatSessionStore.updateSessionTitleBySessionId(
      sessionId,
      `Loop: ${loop.title}`,
    );
  }
  return undefined;
}

const asked = new Set<string>();

/** Asks about one due loop. */
function askAbout(loop: Loop) {
  asked.add(`${loop.id}:${loop.nextAt}`);
  Alert.alert(
    `Loop due: ${loop.title}`,
    `Run ${loop.runs + 1} of at most ${loop.maxRuns}.\n\n${loop.prompt}`,
    [
      {
        text: 'Skip',
        style: 'cancel',
        onPress: () =>
          updateLoop(loop.id, l =>
            addLog({...l, nextAt: nextRun(l, Date.now())}, 'Skipped'),
          ),
      },
      {
        text: 'Later',
        onPress: () =>
          updateLoop(loop.id, l =>
            addLog({...l, nextAt: Date.now() + LATER_MS}, 'Put off 1 hour'),
          ),
      },
      {
        text: 'Run now',
        onPress: async () => {
          const error = await runLoopNow(loop.id);
          if (error) {
            Alert.alert('Not run', error);
          }
        },
      },
    ],
  );
}

/** One look: asks about the first due loop not asked about yet. */
export async function lookForDue(now = Date.now()): Promise<Loop | undefined> {
  const due = dueLoops(await loadLoops(), now).find(
    l => !asked.has(`${l.id}:${l.nextAt}`),
  );
  if (due) {
    askAbout(due);
  }
  return due;
}

let timer: ReturnType<typeof setInterval> | undefined;

/** While the app is open: look for due loops every minute. */
export function startLoopWatch(): void {
  if (timer) {
    return;
  }
  const look = () => {
    if (AppState.currentState === 'active') {
      lookForDue().catch(() => {});
    }
  };
  timer = setInterval(look, LOOK_EVERY_MS);
  setTimeout(look, 3000);
}

/** For tests. */
export function stopLoopWatch(): void {
  if (timer) {
    clearInterval(timer);
  }
  timer = undefined;
  asked.clear();
  send = null;
  openChat = null;
}
