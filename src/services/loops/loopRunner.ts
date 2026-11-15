/**
 * Runs loops through the chat (src/services/loops/loops.ts). The chat
 * screen registers how to send; a run switches to the loop's own chat and
 * sends its message there, like the user typing it. When a loop is due the
 * user is asked first: Run now, Later (1 hour) or Skip this one.
 *
 * With the app closed, a notification says a loop is due (loopNotify.ts);
 * tapping it opens the app, which asks the same question. It never runs a
 * loop by itself.
 *
 * Guards: a due loop whose battery guard isn't met (phone) is not asked
 * about; it waits ("Waiting: battery") and is looked at again in 30
 * minutes. After a run's reply is complete, two runs in a row with the
 * same next steps (or the same reply) pause the loop (loops.ts afterReply).
 */
import {Alert, AppState} from 'react-native';

import {
  isDesktopApp,
  notifyDesktop,
  syncLoopAlarms,
  takeOpenedLoop,
} from './loopNotify';
import {readBattery} from './loopBattery';
import {
  addLog,
  afterReply,
  batteryOk,
  batteryText,
  dueLoops,
  isFinished,
  loadLoops,
  logRunTools,
  nextRun,
  replyTo,
  runMessage,
  toolsUsedInReply,
  updateLoop,
  waitForBattery,
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
  if (loop.notStarted) {
    return 'Press Start on its card first';
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
  const message = runMessage(loop);
  // Resolves when the reply is complete (or stopped).
  await send(message);
  const sessionId = chatSessionStore.activeSessionId;
  if (!exists && sessionId) {
    await updateLoop(loop.id, l => ({...l, sessionId}));
    await chatSessionStore.updateSessionTitleBySessionId(
      sessionId,
      `Loop: ${loop.title}`,
    );
  }
  const run = loop.runs + 1;
  const tools = rowsOf(sessionId, message, toolsUsedInReply);
  if (tools !== undefined) {
    // What this run did: which tools its reply called.
    await updateLoop(loop.id, l => logRunTools(l, run, tools));
  }
  const reply = rowsOf(sessionId, message, replyTo);
  if (reply !== undefined) {
    const after = await updateLoop(loop.id, l => afterReply(l, reply));
    if (after?.pausedWhy && after.paused && !loop.paused) {
      Alert.alert(
        `Loop paused: ${loop.title}`,
        `Paused: ${after.pausedWhy}. The last two runs brought nothing new ` +
          '(the same next steps, or the same reply). Change it with Edit, ' +
          'or Resume it, on its card in Toolbox → Loops.',
      );
    }
  }
  return undefined;
}

/**
 * Reads the finished reply to the run's message in the loop's chat (its
 * text, or the tools it called), if any.
 */
function rowsOf<T>(
  sessionId: string | null | undefined,
  sent: string,
  read: (
    messages: any[],
    sent: string,
    userId: string,
    textOf: (m: any) => string,
  ) => T | undefined,
): T | undefined {
  try {
    const {chatSessionStore} = deps();
    const {derivedText, user} = require('../../utils/chat');
    const session = chatSessionStore.sessions.find(
      (s: any) => s.id === sessionId,
    );
    return read(session?.messages ?? [], sent, user.id, derivedText);
  } catch {
    return undefined;
  }
}

const asked = new Set<string>();
/** Loops whose question is on screen now (never asked twice at once). */
const showing = new Set<string>();

/** Asks about one due loop. */
function askAbout(loop: Loop) {
  asked.add(`${loop.id}:${loop.nextAt}`);
  showing.add(loop.id);
  const answered = () => showing.delete(loop.id);
  notifyDesktop(loop).catch(() => {});
  Alert.alert(
    `Loop due: ${loop.title}`,
    `Run ${loop.runs + 1} of at most ${loop.maxRuns}.\n\n${loop.prompt}`,
    [
      {
        text: 'Skip',
        style: 'cancel',
        onPress: () => {
          answered();
          return updateLoop(loop.id, l =>
            addLog({...l, nextAt: nextRun(l, Date.now())}, 'Skipped'),
          );
        },
      },
      {
        text: 'Later',
        onPress: () => {
          answered();
          return updateLoop(loop.id, l =>
            addLog({...l, nextAt: Date.now() + LATER_MS}, 'Put off 1 hour'),
          );
        },
      },
      {
        text: 'Run now',
        onPress: async () => {
          answered();
          const error = await runLoopNow(loop.id);
          if (error) {
            Alert.alert('Not run', error);
          }
        },
      },
    ],
    {onDismiss: answered},
  );
}

/**
 * One look: asks about the first due loop not asked about yet. `opened` is
 * the loop whose notification was tapped: asked about again (if it is still
 * due), even if it was asked before. A loop that isn't due is never asked.
 */
export async function lookForDue(
  now = Date.now(),
  opened?: string,
): Promise<Loop | undefined> {
  let due = dueLoops(await loadLoops(), now).filter(l => !showing.has(l.id));
  // Battery guard (phone): not met → don't ask; wait and look again later.
  if (due.length) {
    const battery = await readBattery();
    const waiting = due.filter(l => !batteryOk(l.battery, battery));
    for (const l of waiting) {
      await updateLoop(l.id, x => waitForBattery(x, now));
      if (l.id === opened) {
        Alert.alert(
          `Loop waiting: ${l.title}`,
          `${batteryText(l.battery)}. It looks again in 30 minutes.`,
        );
      }
    }
    due = due.filter(l => !waiting.includes(l));
  }
  const pick =
    due.find(l => l.id === opened) ??
    due.find(l => !asked.has(`${l.id}:${l.nextAt}`));
  if (pick) {
    askAbout(pick);
  }
  return pick;
}

let timer: ReturnType<typeof setInterval> | undefined;
let appStateSub: {remove: () => void} | undefined;

/** One look now: on screen (phone), or any time on the desktop. */
async function look(): Promise<void> {
  // Desktop: also while behind other windows, with a system notification.
  if (AppState.currentState !== 'active' && !isDesktopApp()) {
    return;
  }
  await lookForDue(Date.now(), await takeOpenedLoop());
}

/**
 * While the app is open: look for due loops every minute, and at once when
 * the app comes to the front (e.g. a loop's notification was tapped). Sets
 * the phone's loop notifications again (they don't survive a restart).
 */
export function startLoopWatch(): void {
  if (timer) {
    return;
  }
  const lookSoon = () => {
    look().catch(() => {});
  };
  timer = setInterval(lookSoon, LOOK_EVERY_MS);
  setTimeout(lookSoon, 3000);
  try {
    appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setTimeout(lookSoon, 500);
      }
    });
  } catch {
    appStateSub = undefined;
  }
  loadLoops()
    .then(loops => syncLoopAlarms(loops))
    .catch(() => {});
}

/** For tests. */
export function stopLoopWatch(): void {
  if (timer) {
    clearInterval(timer);
  }
  timer = undefined;
  appStateSub?.remove();
  appStateSub = undefined;
  asked.clear();
  showing.clear();
  send = null;
  openChat = null;
}
