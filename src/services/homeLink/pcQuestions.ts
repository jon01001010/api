/**
 * "The PC asks, the phone can answer" (TODO): while switched on for a paired
 * PC (here) and allowed on that PC, the PC's "Allow?" questions show here too,
 * word for word (hidden characters shown as markers), and can be answered
 * Allow or Don't allow; a question too long to show whole shows its start
 * and end, and can only be refused here; so can a question the PC shows
 * without its private parts (onlyRefuse: the clipboard's text, a change's
 * text, the model's thinking, the PC's paths, unless this device asked
 * it). That question
 * only, never "always". The PC's own window stays open; the first answer
 * (here or there) wins. Looks every few seconds, only while the app is open.
 */
import {Alert, AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {answerPcQuestion, pcQuestions, type PcQuestion} from './homeLink';
import {unlockHomePc} from './homePcLock';
import {headTailView} from '../../utils/shownText';

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

/** Longest question shown whole (characters, and lines). */
export const MAX_SHOWN = 2000;
export const MAX_LINES = 40;
const HEAD_CHARS = 1200;
const TAIL_CHARS = 600;
const HEAD_LINES = 24;
const TAIL_LINES = 12;

/**
 * Hidden characters and the head-and-tail view now live in
 * utils/shownText.ts (shared with the phone's own approvals); exported here
 * too, as before.
 */
export {HIDDEN_RANGES, showHidden} from '../../utils/shownText';

/**
 * A question as the phone shows it: hidden characters made visible, and,
 * when it is too long (characters or lines), its start AND its end with what
 * was left out counted in the middle. The end of a question is never hidden.
 */
export function questionView(q: PcQuestion): {
  text: string;
  shortened: boolean;
} {
  return headTailView(q.text, {
    maxChars: MAX_SHOWN,
    maxLines: MAX_LINES,
    headChars: HEAD_CHARS,
    tailChars: TAIL_CHARS,
    headLines: HEAD_LINES,
    tailLines: TAIL_LINES,
  });
}

/** What the phone shows: the PC's exact words, and what answering does. */
export function questionMessage(q: PcQuestion): string {
  const view = questionView(q);
  const seconds = Math.max(1, q.secondsLeft);
  if (q.onlyRefuse === true) {
    return `${view.text}\n\nParts of this are shown on your PC only; answer there. (You can still say Don't allow here, within ${seconds} s.)`;
  }
  return view.shortened
    ? `${view.text}\n\nToo long to show here; answer on the PC. (You can still say Don't allow here, within ${seconds} s.)`
    : `${view.text}\n\n(Asked on your PC. Answer within ${seconds} s; this allows it once only. The PC's own window stays open.)`;
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
    // Locked again meanwhile (PIN): asked first.
    if (!(await unlockHomePc(pc))) {
      return;
    }
    const r = await answerPcQuestion(pc, q.id, yes);
    if (!r.ok) {
      Alert.alert('Not sent', r.error);
    }
  };
  const no = {
    text: "Don't allow",
    style: 'cancel' as const,
    onPress: () => send(false),
  };
  // A question too long to show whole, or shown without its private
  // parts, is never allowed from here.
  Alert.alert(
    'Your PC asks',
    questionMessage(q),
    questionView(q).shortened || q.onlyRefuse === true
      ? [no]
      : [no, {text: 'Allow once', onPress: () => send(true)}],
  );
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
