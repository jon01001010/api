/**
 * Phone actions as model tools: timers, alarms, and (later parts) apps,
 * maps, music, camera, settings, reminders and pre-filled messages. Each one
 * is off by default (Toolbox → Global tools), asks for approval in chat with
 * exactly what will happen, and only then sends an Android intent through
 * PhoneActionsModule. Nothing calls, sends or pays by itself.
 */
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
      'Example: "tea timer for 4 minutes" → {"minutes": 4, "label": "Tea"}. The user approves it first.',
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
      "Open the Clock app's timers, so the user can see or stop running timers. How: no arguments.",
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
    description: "Open the Clock app's alarms. How: no arguments.",
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
      'How: `name` is the app name as the user says it ("Spotify", "maps"). ' +
      'If several apps match, you get their names: ask the user which one, then call again with that exact name.',
    parameters: {
      type: 'object',
      properties: {
        name: {type: 'string', description: 'The app name, e.g. "Spotify".'},
      },
      required: ['name'],
    },
    plan: async args => {
      const name = text(args.name, 80);
      if (!name) {
        return 'Give the app `name`, e.g. "Spotify".';
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
};

export const PHONE_TOOL_NAMES = Object.keys(PHONE_TOOLS);

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
        summary: `The user did not approve this (${plan.what}). Nothing was done.`,
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
    return {type: 'text', summary: plan.done};
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
