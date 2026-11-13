/**
 * "The PC asks, the phone can answer" (TODO): while switched on for a paired
 * PC (here) and allowed on that PC, the PC's "Allow?" questions show here too,
 * word for word, and can be answered Allow or Don't allow. That question
 * only, never "always". The PC's own window stays open; the first answer
 * (here or there) wins. Looks every few seconds, only while the app is open.
 */
import {Alert, AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {answerPcQuestion, pcQuestions, type PcQuestion} from './homeLink';

const settingKey = (pc: string) => `@pocketagent/link/answer-for/${pc}`;

export const LOOK_EVERY_MS = 8000;
/** After the PC can't be reached or refuses: look again less often. */
export const LOOK_AFTER_FAIL_MS = 60000;

export async function answerForPcOn(pc: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(settingKey(pc))) === 'on';
  } catch {
    return false;
  }
}

export async function setAnswerForPc(pc: string, on: boolean): Promise<void> {
  await AsyncStorage.setItem(settingKey(pc), on ? 'on' : 'off');
  if (on) {
    startQuestionWatch();
  }
}

/** Questions not shown yet (each is shown once). */
export function newQuestions(
  list: unknown,
  shown: Set<string>,
  pc: string,
): PcQuestion[] {
  const all = Array.isArray(list) ? list : [];
  return all.filter(
    (q: any) =>
      q &&
      Number.isSafeInteger(q.id) &&
      typeof q.text === 'string' &&
      !shown.has(`${pc}:${q.id}`),
  ) as PcQuestion[];
}

/** What the phone shows: the PC's exact words, and what answering does. */
export function questionMessage(q: PcQuestion): string {
  const text = q.text.length > 2000 ? `${q.text.slice(0, 2000)}…` : q.text;
  return `${text}\n\n(Asked on your PC. Answer within ${Math.max(
    1,
    q.secondsLeft,
  )} s; this allows it once only. The PC's own window stays open.)`;
}

const shown = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

function pairedPcs(): string[] {
  try {
    const {serverStore} = require('../../store');
    const pcs = serverStore.servers
      .map((s: any) => s.homeLinkPc)
      .filter((pc: unknown): pc is string => typeof pc === 'string' && !!pc);
    return [...new Set<string>(pcs)];
  } catch {
    return [];
  }
}

function show(pc: string, q: PcQuestion) {
  shown.add(`${pc}:${q.id}`);
  const send = async (yes: boolean) => {
    const r = await answerPcQuestion(pc, q.id, yes);
    if (!r.ok) {
      Alert.alert('Not sent', r.error);
    }
  };
  Alert.alert('Your PC asks', questionMessage(q), [
    {text: "Don't allow", style: 'cancel', onPress: () => send(false)},
    {text: 'Allow once', onPress: () => send(true)},
  ]);
}

/** One look at every PC this is switched on for; the wait until the next. */
export async function lookOnce(): Promise<number> {
  let wait = 0;
  for (const pc of pairedPcs()) {
    if (!(await answerForPcOn(pc))) {
      continue;
    }
    const r = await pcQuestions(pc);
    if (!r.ok) {
      wait = Math.max(wait, LOOK_AFTER_FAIL_MS);
      continue;
    }
    for (const q of newQuestions(r.questions, shown, pc)) {
      show(pc, q);
    }
    wait = Math.max(wait, LOOK_EVERY_MS);
  }
  return wait;
}

/** At start (phone and desktop): look while the app is open. */
export function startQuestionWatch(): void {
  if (running) {
    return;
  }
  running = true;
  const loop = async () => {
    timer = undefined;
    let wait = 0;
    if (AppState.currentState === 'active') {
      try {
        wait = await lookOnce();
      } catch {
        wait = LOOK_AFTER_FAIL_MS;
      }
    } else {
      wait = LOOK_EVERY_MS;
    }
    if (wait === 0) {
      // Switched on for no PC: stop until it is.
      running = false;
      return;
    }
    timer = setTimeout(loop, wait);
  };
  loop();
}

/** For tests. */
export function stopQuestionWatch(): void {
  if (timer) {
    clearTimeout(timer);
  }
  timer = undefined;
  running = false;
  shown.clear();
}
