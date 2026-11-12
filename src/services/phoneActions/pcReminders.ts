/**
 * Timers, alarms and reminders in the desktop app: kept by DesktopAgent and
 * shown as a dialog with a sound when due. Only while the app is open (said
 * so to the user when one is set). Nothing leaves the PC.
 */
import {Alert} from 'react-native';

export type PcReminderKind = 'timer' | 'alarm' | 'reminder';

export interface PcReminder {
  id: number;
  kind: PcReminderKind;
  label: string;
  /** When it goes off (ms since 1970). */
  at: number;
  /** Alarm days (0 = Sunday … 6), for repeating alarms. */
  days?: number[];
}

let nextId = 1;
const pending = new Map<
  number,
  {item: PcReminder; timer: ReturnType<typeof setTimeout>}
>();

/** A short beep (the page's own sound; no file, no network). */
function beep() {
  try {
    const Ctx =
      (globalThis as any).AudioContext ||
      (globalThis as any).webkitAudioContext;
    if (!Ctx) {
      return;
    }
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // No sound: the dialog still shows.
  }
}

const TITLE: Record<PcReminderKind, string> = {
  timer: 'Timer done',
  alarm: 'Alarm',
  reminder: 'Reminder',
};

/** The next time a daily / weekly alarm at `hour:minute` goes off. */
export function nextAlarmTime(
  hour: number,
  minute: number,
  days: number[] | undefined,
  now: Date,
): number {
  for (let add = 0; add <= 7; add++) {
    const d = new Date(now);
    d.setDate(now.getDate() + add);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= now.getTime()) {
      continue;
    }
    if (!days || days.length === 0 || days.includes(d.getDay())) {
      return d.getTime();
    }
  }
  return now.getTime() + 24 * 3600 * 1000;
}

function fire(id: number) {
  const entry = pending.get(id);
  if (!entry) {
    return;
  }
  pending.delete(id);
  const {item} = entry;
  beep();
  Alert.alert(TITLE[item.kind], item.label || TITLE[item.kind]);
  // A repeating alarm sets itself again for its next day.
  if (item.kind === 'alarm' && item.days && item.days.length) {
    const at = new Date(item.at);
    add({
      ...item,
      at: nextAlarmTime(at.getHours(), at.getMinutes(), item.days, new Date()),
    });
  }
}

export function add(item: Omit<PcReminder, 'id'> & {id?: number}): PcReminder {
  const full: PcReminder = {...item, id: item.id ?? nextId++};
  // setTimeout can't wait more than ~24.8 days; longer ones are refused by
  // the caller (only while the app is open anyway).
  const wait = Math.max(0, full.at - Date.now());
  pending.set(full.id, {
    item: full,
    timer: setTimeout(() => fire(full.id), wait),
  });
  return full;
}

export function list(): PcReminder[] {
  return [...pending.values()].map(p => p.item).sort((a, b) => a.at - b.at);
}

export function cancelAll(): void {
  for (const {timer} of pending.values()) {
    clearTimeout(timer);
  }
  pending.clear();
}

/** One line per pending item, for "show timers". */
export function describeAll(now = Date.now()): string {
  const items = list();
  if (!items.length) {
    return 'No timers, alarms or reminders are set in DesktopAgent.';
  }
  return items
    .map(i => {
      const when =
        i.kind === 'timer'
          ? `in ${Math.max(1, Math.round((i.at - now) / 60000))} min`
          : new Date(i.at).toLocaleString();
      return `${TITLE[i.kind].replace(' done', '')}: ${i.label || '(no name)'}, ${when}`;
    })
    .join('\n');
}

export const MAX_WAIT_MS = 24 * 24 * 3600 * 1000;
