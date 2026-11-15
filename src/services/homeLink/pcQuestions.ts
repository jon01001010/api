/**
 * "The PC asks, the phone can answer" (TODO): while switched on for a paired
 * PC (here) and allowed on that PC, the PC's "Allow?" questions show here too,
 * word for word (hidden characters shown as markers), and can be answered
 * Allow or Don't allow; a question too long to show whole shows its start
 * and end, and can only be refused here. That question
 * only, never "always". The PC's own window stays open; the first answer
 * (here or there) wins. Looks every few seconds, only while the app is open.
 */
import {Alert, AppState} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {answerPcQuestion, pcQuestions, type PcQuestion} from './homeLink';
import {unlockHomePc} from './homePcLock';

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
 * Characters that change how text looks without showing themselves:
 * direction controls (U+202A–U+202E, U+2066–U+2069, U+061C), zero-width and
 * marks (U+200B–U+200F, U+2060, U+FEFF), line and paragraph separators, and
 * control characters other than a newline or a tab.
 */
const HIDDEN =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060\u2066-\u2069\uFEFF]/g;

/** Each hidden character as a visible marker, e.g. ⟦U+202E⟧. */
export function showHidden(text: string): string {
  return text.replace(
    HIDDEN,
    c => `⟦U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`,
  );
}

/**
 * A question as the phone shows it: hidden characters made visible, and,
 * when it is too long (characters or lines), its start AND its end with what
 * was left out counted in the middle. The end of a question is never hidden.
 */
export function questionView(q: PcQuestion): {
  text: string;
  shortened: boolean;
} {
  const all = q.text;
  const lines = all.split('\n');
  if (all.length <= MAX_SHOWN && lines.length <= MAX_LINES) {
    return {text: showHidden(all), shortened: false};
  }
  let head = lines.slice(0, HEAD_LINES).join('\n').slice(0, HEAD_CHARS);
  let tail = lines.slice(-TAIL_LINES).join('\n').slice(-TAIL_CHARS);
  if (head.length + tail.length > all.length) {
    // Few, very long lines: plain character counts.
    head = all.slice(0, HEAD_CHARS);
    tail = all.slice(-TAIL_CHARS);
  }
  const left = all.length - head.length - tail.length;
  return {
    text: `${showHidden(head)}\n… (${left} characters not shown) …\n${showHidden(tail)}`,
    shortened: true,
  };
}

/** What the phone shows: the PC's exact words, and what answering does. */
export function questionMessage(q: PcQuestion): string {
  const view = questionView(q);
  const seconds = Math.max(1, q.secondsLeft);
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
  // A question too long to show whole is never allowed from here.
  Alert.alert(
    'Your PC asks',
    questionMessage(q),
    questionView(q).shortened
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
