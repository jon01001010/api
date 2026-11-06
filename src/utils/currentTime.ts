/**
 * Today's date and the current time for the model, worked out fresh for each
 * message. Small models only know the year they were trained in, so without
 * this they search for the wrong year or get "how long until…" wrong.
 *
 * Two parts on purpose: the date goes at the start of the prompt (it changes
 * once a day, so the phone can keep reusing the work it did on the earlier
 * conversation), and the time goes on the end of the newest message (changing
 * it there costs nothing).
 */
const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Today is Friday, 6 November 2026." in the phone's own time zone. */
export function todayLine(now: Date = new Date()): string {
  return `Today is ${DAYS[now.getDay()]}, ${now.getDate()} ${
    MONTHS[now.getMonth()]
  } ${now.getFullYear()}.`;
}

/** "(Sent at 10:52, UTC+01:00)" — the phone's local time. */
export function timeNote(now: Date = new Date()): string {
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `(Sent at ${pad(now.getHours())}:${pad(now.getMinutes())}, UTC${sign}${pad(
    Math.floor(abs / 60),
  )}:${pad(abs % 60)})`;
}

type Part = {type: string; text?: string; [key: string]: unknown};
type Message = {role: string; content?: unknown; [key: string]: unknown};

/**
 * The same messages with the time note added to the newest user message.
 * Only what is sent to the model changes; the saved chat stays as typed.
 */
export function withTimeNote<T extends Message>(
  messages: T[],
  note: string,
): T[] {
  let last = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      last = i;
      break;
    }
  }
  if (last < 0) {
    return messages;
  }
  const message = messages[last];
  let content: unknown = message.content;
  if (typeof content === 'string') {
    content = `${content}\n\n${note}`;
  } else if (Array.isArray(content)) {
    content = [...(content as Part[]), {type: 'text', text: note}];
  } else {
    return messages;
  }
  const out = [...messages];
  out[last] = {...message, content};
  return out;
}
