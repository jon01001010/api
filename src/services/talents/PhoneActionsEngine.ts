/**
 * Phone actions as model tools: timers, alarms, and (later parts) apps,
 * maps, music, camera, settings, reminders and pre-filled messages. Each one
 * is off by default (Toolbox → Global tools), asks for approval in chat with
 * exactly what will happen, and only then sends an Android intent through
 * PhoneActionsModule. Nothing calls, sends or pays by itself.
 */
import {AppState} from 'react-native';

import {requestFileApproval} from './fileApprovalGate';
import type {
  TalentEngine,
  TalentExecuteContext,
  TalentResult,
  ToolDefinition,
} from './types';
import {
  describeFailure,
  listInstalledApps,
  performPhoneAction,
  type InstalledApp,
  type PhoneAction,
} from '../phoneActions/native';

/** What a tool call turns into, once its arguments are checked. */
interface Plan {
  action: PhoneAction;
  args: Record<string, unknown>;
  /** One line for the approval dialog: "Set a 15-minute timer named Tea". */
  ask: string;
  /** Shown under it: the details exactly as sent. */
  details?: string;
  /** For the model, on success. */
  done: string;
  /** For a failure message: "set a timer". */
  what: string;
}

type Planner = (
  args: Record<string, unknown>,
) => Plan | string | Promise<Plan | string>;

interface PhoneTool {
  description: string;
  parameters: Record<string, unknown>;
  plan: Planner;
}

/** A whole number from a number or a numeric string; undefined otherwise. */
const whole = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.round(n)
    : undefined;
};

const text = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

const DAY_NUMBERS: Record<string, number> = {
  sun: 1,
  mon: 2,
  tue: 3,
  wed: 4,
  thu: 5,
  fri: 6,
  sat: 7,
};

/** "15 minutes", "1 h 30 min", "45 s". */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [
    h ? `${h} h` : '',
    m ? `${m} min` : '',
    s ? `${s} s` : '',
  ].filter(Boolean);
  return parts.join(' ') || '0 s';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Settings pages PhoneActionsModule can open (same names as there). */
export const SETTINGS_PAGES = [
  'main',
  'wifi',
  'bluetooth',
  'battery',
  'display',
  'sound',
  'location',
  'apps',
  'notifications',
  'airplane',
] as const;
const SETTINGS_LABEL: Record<(typeof SETTINGS_PAGES)[number], string> = {
  main: 'Settings',
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  battery: 'Battery',
  display: 'Display',
  sound: 'Sound',
  location: 'Location',
  apps: 'Apps',
  notifications: 'Notification',
  airplane: 'Airplane mode',
};

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Installed apps matching a name, best first: the exact name, then names
 * starting with it, then names containing it (spaces and case ignored).
 * An exact match stands alone, so "Maps" never also offers "Maps Go".
 */
export function matchApps(query: string, apps: InstalledApp[]): InstalledApp[] {
  const q = squash(query);
  if (!q) {
    return [];
  }
  const exact = apps.filter(a => squash(a.label) === q);
  if (exact.length) {
    return exact;
  }
  const starts = apps.filter(a => squash(a.label).startsWith(q));
  const contains = apps.filter(
    a => !starts.includes(a) && squash(a.label).includes(q),
  );
  const byPackage = apps.filter(
    a =>
      !starts.includes(a) &&
      !contains.includes(a) &&
      squash(a.package).includes(q),
  );
  return [...starts, ...contains, ...byPackage];
}

export const PHONE_TOOLS: Record<string, PhoneTool> = {
  set_timer: {
    description:
      "Set a countdown timer in the phone's Clock app. " +
      'How: give the length as `minutes` and/or `seconds` (1 second to 24 hours) and an optional `label`. ' +
      'Use only the length and label the user gave. The user approves it first.',
    parameters: {
      type: 'object',
      properties: {
        minutes: {
          type: 'number',
          description: 'Minutes (can be combined with seconds).',
        },
        seconds: {
          type: 'number',
          description: 'Seconds (can be combined with minutes).',
        },
        label: {
          type: 'string',
          description: 'Optional name shown on the timer.',
        },
      },
    },
    plan: args => {
      const minutes = whole(args.minutes) ?? 0;
      const seconds = whole(args.seconds) ?? 0;
      const total = minutes * 60 + seconds;
      if (total < 1 || total > 86400) {
        return 'The timer must be between 1 second and 24 hours. Give `minutes` and/or `seconds`.';
      }
      const label = text(args.label, 60);
      const length = formatDuration(total);
      return {
        action: 'set_timer',
        args: {seconds: total, ...(label ? {label} : {}), skipUi: false},
        ask: `Set a ${length} timer${label ? ` named "${label}"` : ''}?`,
        done: `Timer set for ${length}${label ? ` (${label})` : ''}. It runs in the Clock app.`,
        what: 'set a timer',
      };
    },
  },
  show_timers: {
    description:
      "Open the Clock app's timers, only when the user asks to see them (set_timer already shows the new timer). How: no arguments.",
    parameters: {type: 'object', properties: {}},
    plan: () => ({
      action: 'show_timers',
      args: {},
      ask: 'Open your timers in the Clock app?',
      done: 'Opened the timers in the Clock app.',
      what: 'show timers',
    }),
  },
  set_alarm: {
    description:
      "Set an alarm in the phone's Clock app. " +
      'How: `hour` 0-23 and `minute` 0-59 in 24-hour time (7:30 pm → hour 19, minute 30), an optional `label`, ' +
      'and optional repeat `days` like ["mon","tue","wed","thu","fri"]. The Clock app opens so the user can check it.',
    parameters: {
      type: 'object',
      properties: {
        hour: {type: 'number', description: 'Hour, 0-23 (24-hour time).'},
        minute: {type: 'number', description: 'Minute, 0-59.'},
        label: {
          type: 'string',
          description: 'Optional name shown on the alarm.',
        },
        days: {
          type: 'array',
          items: {type: 'string', enum: Object.keys(DAY_NUMBERS)},
          description:
            'Optional repeat days: sun, mon, tue, wed, thu, fri, sat.',
        },
      },
      required: ['hour'],
    },
    plan: args => {
      const hour = whole(args.hour);
      const minute = whole(args.minute) ?? 0;
      if (
        hour === undefined ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
      ) {
        return 'Give `hour` 0-23 and `minute` 0-59 (24-hour time: 7:30 pm is hour 19, minute 30).';
      }
      const label = text(args.label, 60);
      const dayNames = Array.isArray(args.days)
        ? [
            ...new Set(
              args.days
                .map(d =>
                  typeof d === 'string'
                    ? d.trim().toLowerCase().slice(0, 3)
                    : '',
                )
                .filter(d => d in DAY_NUMBERS),
            ),
          ]
        : [];
      const time = `${pad(hour)}:${pad(minute)}`;
      const repeat = dayNames.length
        ? `, repeating ${dayNames.join(', ')}`
        : '';
      return {
        action: 'set_alarm',
        args: {
          hour,
          minutes: minute,
          ...(label ? {label} : {}),
          ...(dayNames.length ? {days: dayNames.map(d => DAY_NUMBERS[d])} : {}),
        },
        ask: `Set an alarm for ${time}${label ? ` named "${label}"` : ''}${repeat}?`,
        done: `Alarm set for ${time}${label ? ` (${label})` : ''}${repeat}. The Clock app opened to show it.`,
        what: 'set an alarm',
      };
    },
  },
  show_alarms: {
    description:
      "Open the Clock app's alarms, only when the user asks to see them (set_alarm already opens the Clock app). How: no arguments.",
    parameters: {type: 'object', properties: {}},
    plan: () => ({
      action: 'show_alarms',
      args: {},
      ask: 'Open your alarms in the Clock app?',
      done: 'Opened the alarms in the Clock app.',
      what: 'show alarms',
    }),
  },
  open_app: {
    description:
      'Open an app installed on the phone, by its name. ' +
      'Use this when the user just wants an app opened, with nothing else ("open maps", "open the camera app"). ' +
      'If they also name a place ("open maps to <place>"), use navigate_to; a song to play, use play_music; text to write or ask in it, use share_text. ' +
      'How: `name` is the app name exactly as the user said it. ' +
      'If several apps match, you get their names: ask the user which one, then call again with that exact name.',
    parameters: {
      type: 'object',
      properties: {
        name: {type: 'string', description: 'The app name the user said.'},
      },
      required: ['name'],
    },
    plan: async args => {
      const name = text(args.name, 80);
      if (!name) {
        return 'Give the app `name` the user said.';
      }
      const apps = await listInstalledApps();
      if (!apps.length) {
        return 'The list of installed apps is not available on this phone.';
      }
      const found = matchApps(name, apps);
      if (!found.length) {
        return `No installed app is called "${name}". Ask the user for the app's name as it shows on the phone.`;
      }
      if (found.length > 1) {
        const names = found.slice(0, 6).map(a => `"${a.label}"`);
        return `Several apps match "${name}": ${names.join(', ')}. Ask the user which one, then call open_app with that exact name.`;
      }
      const app = found[0];
      return {
        action: 'open_app',
        args: {package: app.package},
        ask: `Open ${app.label}?`,
        details: app.package,
        done: `Opened ${app.label}.`,
        what: `open ${app.label}`,
      };
    },
  },
  navigate_to: {
    description:
      'Show a place or route in the maps app. ' +
      'Use this whenever the user names a place, including "open maps to <place>" or "directions to <place>". ' +
      'With no place ("open maps"), use open_app instead. ' +
      'How: `destination` is the address or place exactly as the user said it; never invent one. ' +
      'The maps app opens; the user starts the route there.',
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'Address or place to go to.',
        },
      },
      required: ['destination'],
    },
    plan: args => {
      const destination = text(args.destination, 200);
      if (!destination) {
        return 'Give the `destination`: an address or a place name.';
      }
      return {
        action: 'navigate',
        args: {destination},
        ask: `Open maps for "${destination}"?`,
        done: `Opened maps for ${destination}.`,
        what: 'open maps',
      };
    },
  },
  play_music: {
    description:
      "Play music in the phone's music app by searching for it. " +
      'Only when the user names something to play; to just open a music app, use open_app. ' +
      'How: `query` is the song, artist, album or playlist exactly as the user said it. ' +
      'Which app plays it depends on the phone.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Song, artist, album or playlist.',
        },
      },
      required: ['query'],
    },
    plan: args => {
      const query = text(args.query, 200);
      if (!query) {
        return 'Give the `query`: a song, artist, album or playlist.';
      }
      return {
        action: 'play_music',
        args: {query},
        ask: `Play "${query}" in your music app?`,
        done: `Asked the music app to play ${query}.`,
        what: 'play music',
      };
    },
  },
  open_camera: {
    description:
      'Open the camera app to take a photo. How: no arguments. The user takes the photo.',
    parameters: {type: 'object', properties: {}},
    plan: () => ({
      action: 'open_camera',
      args: {},
      ask: 'Open the camera?',
      done: 'Opened the camera.',
      what: 'open the camera',
    }),
  },
  open_settings: {
    description:
      "Open a page of the phone's Settings so the user can change it there (nothing is changed by this tool). " +
      'How: `page` is one of: main, wifi, bluetooth, battery, display, sound, location, apps, notifications, airplane.',
    parameters: {
      type: 'object',
      properties: {
        page: {type: 'string', enum: [...SETTINGS_PAGES]},
      },
      required: ['page'],
    },
    plan: args => {
      const page = text(args.page, 30)
        ?.toLowerCase()
        .replace(/[^a-z]/g, '');
      const known = SETTINGS_PAGES.find(p => p === page);
      if (!known) {
        return `\`page\` must be one of: ${SETTINGS_PAGES.join(', ')}.`;
      }
      const label =
        known === 'main' ? 'Settings' : `${SETTINGS_LABEL[known]} settings`;
      return {
        action: 'open_settings',
        args: {page: known},
        ask: `Open ${label}?`,
        done: `Opened ${label}. Nothing was changed; the user makes changes there.`,
        what: `open ${label}`,
      };
    },
  },
  add_reminder: {
    description:
      'Add a reminder as a calendar event. The calendar app opens pre-filled and the user presses save. ' +
      'How: `title`, and `when` as local date-time "YYYY-MM-DDTHH:MM" (call datetime first if you need today\'s date), optional `notes`.',
    parameters: {
      type: 'object',
      properties: {
        title: {type: 'string', description: 'What to be reminded of.'},
        when: {
          type: 'string',
          description:
            'Local date and time, "YYYY-MM-DDTHH:MM", e.g. "2026-11-06T09:00".',
        },
        notes: {type: 'string', description: 'Optional details.'},
      },
      required: ['title'],
    },
    plan: args => {
      const title = text(args.title, 120);
      if (!title) {
        return 'Give the reminder `title`.';
      }
      const whenText = text(args.when, 40);
      let startMs: number | undefined;
      if (whenText) {
        const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(whenText);
        const date = m
          ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
          : undefined;
        if (
          !date ||
          Number.isNaN(date.getTime()) ||
          date.getMonth() !== +m![2] - 1
        ) {
          return '`when` must be a local date and time like "2026-11-06T09:00".';
        }
        startMs = date.getTime();
      }
      const notes = text(args.notes, 500);
      const at =
        whenText && startMs !== undefined
          ? ` on ${whenText.replace('T', ' at ')}`
          : '';
      return {
        action: 'add_reminder',
        args: {
          title,
          ...(startMs !== undefined ? {startMs} : {}),
          ...(notes ? {notes} : {}),
        },
        ask: `Add "${title}"${at} to your calendar?`,
        details: notes,
        done: `The calendar opened with "${title}"${at} filled in. The user presses save there.`,
        what: 'add a reminder',
      };
    },
  },
  compose_message: {
    description:
      'Open a call, text or e-mail screen filled in for the user, who presses call or send. Nothing is sent by this tool. ' +
      'How: `kind` is "call", "text" or "email"; `to` is the phone number or e-mail address; for text and email an optional `body`, for email an optional `subject`.',
    parameters: {
      type: 'object',
      properties: {
        kind: {type: 'string', enum: ['call', 'text', 'email']},
        to: {
          type: 'string',
          description: 'Phone number, or e-mail address for email.',
        },
        subject: {type: 'string', description: 'E-mail subject (email only).'},
        body: {type: 'string', description: 'Message text (text and email).'},
      },
      required: ['kind'],
    },
    plan: args => {
      const kind = text(args.kind, 10)?.toLowerCase();
      const to = text(args.to, 120);
      const body = text(args.body, 2000);
      const subject = text(args.subject, 200);
      const phoneOk = (v?: string) => !!v && /^\+?[\d\s().-]{3,20}$/.test(v);
      if (kind === 'call') {
        if (!phoneOk(to)) {
          return 'For a call, `to` must be a phone number.';
        }
        return {
          action: 'dial',
          args: {number: to},
          ask: `Open the dialer with ${to}? You press call.`,
          done: `The dialer opened with ${to}. The user presses call.`,
          what: 'open the dialer',
        };
      }
      if (kind === 'text') {
        if (to && !phoneOk(to)) {
          return 'For a text, `to` must be a phone number (or leave it out).';
        }
        return {
          action: 'sms',
          args: {...(to ? {number: to} : {}), ...(body ? {body} : {})},
          ask: `Open a text${to ? ` to ${to}` : ''}? You press send.`,
          details: body,
          done: `The messages app opened with the text filled in. The user presses send.`,
          what: 'open a text message',
        };
      }
      if (kind === 'email') {
        if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
          return 'For an email, `to` must be an e-mail address (or leave it out).';
        }
        return {
          action: 'email',
          args: {
            ...(to ? {to} : {}),
            ...(subject ? {subject} : {}),
            ...(body ? {body} : {}),
          },
          ask: `Open an e-mail${to ? ` to ${to}` : ''}${subject ? ` about "${subject}"` : ''}? You press send.`,
          details: body,
          done: 'The e-mail app opened with the message filled in. The user presses send.',
          what: 'open an e-mail',
        };
      }
      return '`kind` must be "call", "text" or "email".';
    },
  },
  share_text: {
    description:
      'Open an app with text already filled in, e.g. a question for a chat app or a note for a notes app; the user then presses send or save. ' +
      'Use this for "open <app> and write/ask <text>". ' +
      'How: `app` is the app name the user said (leave it out to let the user pick from the share menu), `text` is exactly what to fill in.',
    parameters: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description: 'The app name the user said; optional.',
        },
        text: {type: 'string', description: 'The text to fill in.'},
      },
      required: ['text'],
    },
    plan: async args => {
      const body = text(args.text, 4000);
      if (!body) {
        return 'Give the `text` to fill in.';
      }
      const name = text(args.app, 80);
      if (!name) {
        return {
          action: 'share_text',
          args: {text: body},
          ask: 'Share this text? You pick the app.',
          details: body,
          done: 'The share menu opened with the text. The user picks the app and sends.',
          what: 'share text',
        };
      }
      const found = matchApps(name, await listInstalledApps());
      if (!found.length) {
        return `No installed app is called "${name}". Ask the user for the app's name as it shows on the phone.`;
      }
      if (found.length > 1) {
        const names = found.slice(0, 6).map(a => `"${a.label}"`);
        return `Several apps match "${name}": ${names.join(', ')}. Ask the user which one, then call share_text with that exact name.`;
      }
      const app = found[0];
      return {
        action: 'share_text',
        args: {text: body, package: app.package},
        ask: `Open ${app.label} with this text filled in? You press send.`,
        details: body,
        done: `${app.label} opened with the text filled in. The user presses send there.`,
        what: `fill in text in ${app.label} (it may not accept shared text)`,
      };
    },
  },
  search_in_app: {
    description:
      'Search for something: inside an app that has its own search (video, store, shopping apps) or, with no app, on the web. ' +
      'How: `query` is exactly what the user wants to find; `app` is the app name they said (optional).',
    parameters: {
      type: 'object',
      properties: {
        query: {type: 'string', description: 'What to search for.'},
        app: {
          type: 'string',
          description: 'The app name the user said; optional.',
        },
      },
      required: ['query'],
    },
    plan: async args => {
      const query = text(args.query, 300);
      if (!query) {
        return 'Give the `query` to search for.';
      }
      const name = text(args.app, 80);
      if (!name) {
        return {
          action: 'search',
          args: {query},
          ask: `Search the web for "${query}"?`,
          done: `Opened a web search for ${query}.`,
          what: 'search the web',
        };
      }
      const found = matchApps(name, await listInstalledApps());
      if (found.length !== 1) {
        return found.length
          ? `Several apps match "${name}": ${found
              .slice(0, 6)
              .map(a => `"${a.label}"`)
              .join(', ')}. Ask the user which one.`
          : `No installed app is called "${name}".`;
      }
      const app = found[0];
      return {
        action: 'search',
        args: {query, package: app.package},
        ask: `Search ${app.label} for "${query}"?`,
        done: `Opened ${app.label} searching for ${query}.`,
        what: `search in ${app.label} (it may not support search from other apps)`,
      };
    },
  },
};

export const PHONE_TOOL_NAMES = Object.keys(PHONE_TOOLS);

/** What every finished action tells the model, so it stops there. */
const STOP =
  'This request is complete: confirm it to the user in one short sentence and call no other tool for it unless they ask for more.';

/** Same action, same details, within this window: not done again. */
const REPEAT_WINDOW_MS = 60_000;
const recentlyDone = new Map<string, number>();

/** Test helper. */
export function resetRecentPhoneActions(): void {
  recentlyDone.clear();
}

export class PhoneActionsEngine implements TalentEngine {
  constructor(readonly name: string) {
    if (!PHONE_TOOLS[name]) {
      throw new Error(`Unknown phone action tool: ${name}`);
    }
  }

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const plan = await PHONE_TOOLS[this.name].plan(args ?? {});
    if (typeof plan === 'string') {
      return {
        type: 'error',
        summary: `${this.name}: ${plan}`,
        errorMessage: plan,
      };
    }
    // Asked twice for the same thing within a minute: a small model looping
    // after a success. Don't do it (or ask) again.
    const key = `${plan.action}:${JSON.stringify(plan.args)}`;
    const last = recentlyDone.get(key);
    if (last !== undefined && Date.now() - last < REPEAT_WINDOW_MS) {
      return {
        type: 'text',
        summary: `Already done a moment ago (${plan.what}); not repeated. ${STOP}`,
      };
    }
    // Approval needs PocketAgent on screen. After an action opens another
    // app it is not, and that is not the user saying no.
    if (AppState.currentState !== 'active') {
      return {
        type: 'text',
        summary: `Not done: another app is on screen, so the user could not be asked (${plan.what}). Stop here; the user can ask again when they are back.`,
      };
    }
    const approved = await requestFileApproval(
      {
        action: 'phone_action',
        filename: plan.ask,
        content: plan.details ?? '',
      },
      ctx?.signal,
    );
    if (!approved || ctx?.signal?.aborted) {
      return {
        type: 'text',
        summary: `The user said no (${plan.what}). Nothing was done. Do not try it again unless they ask.`,
      };
    }
    const result = await performPhoneAction(plan.action, plan.args);
    if (!result.ok) {
      const why = describeFailure(result, plan.what);
      return {
        type: 'error',
        summary: `${this.name}: ${why}`,
        errorMessage: why,
      };
    }
    recentlyDone.set(key, Date.now());
    return {type: 'text', summary: `Done: ${plan.done} ${STOP}`};
  }

  toToolDefinition(): ToolDefinition {
    const tool = PHONE_TOOLS[this.name];
    return {
      type: 'function',
      function: {
        name: this.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }
}
