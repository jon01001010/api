/**
 * Several phone actions for one request, one after another ("navigate home,
 * then play my playlist"). The user first sees every step, then each step
 * still asks just before it runs ("Step 2 of 3: Play … ?"); a no, a failure
 * or Stop ends the chain and nothing after it runs. Off until switched on,
 * like every tool, and each step's own phone action must be switched on too.
 * A chain never skips a step's question (unlike an approved shortcut).
 */
import {AppState, type AppStateStatus} from 'react-native';

import {requestFileApproval} from './fileApprovalGate';
import {
  PHONE_TOOLS,
  PHONE_TOOL_NAMES,
  PhoneActionsEngine,
} from './PhoneActionsEngine';
import type {
  TalentEngine,
  TalentExecuteContext,
  TalentResult,
  ToolDefinition,
} from './types';

export const CHAIN_TOOL_NAME = 'phone_actions_chain';
export const MAX_CHAIN_STEPS = 5;

/** After a step opens another app: how long that takes to show. */
const LEAVE_GRACE_MS = 1500;
/** How long the next step waits for the user to come back to PocketAgent. */
const RETURN_WAIT_MS = 10 * 60_000;

const STOP_REST = 'Do not do the remaining steps unless the user asks again.';

/** The Toolbox switches, read when the chain runs (fail closed). */
async function switchedOnTools(): Promise<string[]> {
  try {
    // Required here: globalToolSettings imports the talents index.
    const {readGlobalTools} = require('../../utils/globalToolSettings');
    return await readGlobalTools();
  } catch {
    return [];
  }
}

/**
 * The tool list as offered to the model: the chain only when at least one
 * phone action is switched on too (it can use nothing else).
 */
export function withChainOnlyIfUsable(names: string[]): string[] {
  return names.includes(CHAIN_TOOL_NAME) &&
    !names.some(n => PHONE_TOOL_NAMES.includes(n))
    ? names.filter(n => n !== CHAIN_TOOL_NAME)
    : names;
}

/**
 * Resolves true once `want(state)` holds, false after `ms` or on Stop.
 */
function waitForAppState(
  want: (state: AppStateStatus) => boolean,
  ms: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (want(AppState.currentState)) {
    return Promise.resolve(true);
  }
  if (signal?.aborted) {
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      sub?.remove();
      signal?.removeEventListener('abort', onAbort);
      resolve(ok);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), ms);
    const sub = AppState.addEventListener('change', state => {
      if (want(state)) {
        finish(true);
      }
    });
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

/**
 * Before the next step: if the last one opened another app, wait until the
 * user is back in PocketAgent, so the next question can be shown. False if
 * they don't come back in time or press Stop.
 */
async function backInApp(signal?: AbortSignal): Promise<boolean> {
  await waitForAppState(s => s !== 'active', LEAVE_GRACE_MS, signal);
  if (signal?.aborted) {
    return false;
  }
  return waitForAppState(s => s === 'active', RETURN_WAIT_MS, signal);
}

interface Step {
  action: string;
  args: Record<string, unknown>;
  /** The step's own question, for the list shown first. */
  ask: string;
  details?: string;
}

/** The steps, each checked by its own tool, or why not (nothing done). */
async function checkSteps(
  input: unknown,
  switchedOn: string[],
): Promise<Step[] | string> {
  if (!Array.isArray(input) || input.length < 2) {
    return `Give \`steps\`: 2 to ${MAX_CHAIN_STEPS} phone actions in order. For a single action, call its own tool.`;
  }
  if (input.length > MAX_CHAIN_STEPS) {
    return `At most ${MAX_CHAIN_STEPS} steps in one chain. Ask the user which to do first.`;
  }
  const steps: Step[] = [];
  for (const [i, raw] of input.entries()) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const action = typeof s.action === 'string' ? s.action.trim() : '';
    if (!PHONE_TOOL_NAMES.includes(action)) {
      return `Step ${i + 1}: "${action}" is not a phone action. A chain can only use: ${PHONE_TOOL_NAMES.join(', ')}.`;
    }
    if (!switchedOn.includes(action)) {
      return `Step ${i + 1}: ${action} is switched off (Toolbox). Tell the user; don't try another way.`;
    }
    const args =
      s.args && typeof s.args === 'object' && !Array.isArray(s.args)
        ? (s.args as Record<string, unknown>)
        : {};
    const plan = await PHONE_TOOLS[action].plan(args);
    if (typeof plan === 'string') {
      return `Step ${i + 1} (${action}): ${plan}`;
    }
    steps.push({action, args, ask: plan.ask, details: plan.details});
  }
  return steps;
}

export class PhoneActionChainEngine implements TalentEngine {
  readonly name = CHAIN_TOOL_NAME;

  async execute(
    args: Record<string, any>,
    ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const signal = ctx?.signal;
    const checked = await checkSteps(args?.steps, await switchedOnTools());
    if (typeof checked === 'string') {
      const summary = `${CHAIN_TOOL_NAME}: ${checked} Nothing was done.`;
      return {type: 'error', summary, errorMessage: checked};
    }
    const total = checked.length;
    // First the whole plan; each step still asks again before it runs.
    const plan = checked
      .map(
        (s, i) =>
          `${i + 1}. ${s.ask.replace(/\?$/, '')}` +
          (s.details ? `\n   ${s.details.replace(/\n/g, '\n   ')}` : ''),
      )
      .join('\n');
    const approved =
      AppState.currentState === 'active' &&
      (await requestFileApproval(
        {
          action: 'phone_action',
          filename: `Do these ${total} steps? Each one asks again before it runs.`,
          content: plan,
        },
        signal,
      ));
    if (!approved || signal?.aborted) {
      return {
        type: 'text',
        summary:
          'The user said no to these steps. Nothing was done. Do not try them again unless they ask.',
      };
    }
    const done: string[] = [];
    const notDone = (from: number) =>
      checked
        .slice(from)
        .map((s, j) => `${from + j + 1}. ${s.action}`)
        .join(', ');
    const stopped = (
      i: number,
      why: string,
      type: 'text' | 'error' = 'text',
    ): TalentResult => {
      const summary =
        `Stopped at step ${i + 1} of ${total} (${checked[i].action}): ${why}\n` +
        (done.length
          ? `Done before that:\n${done.join('\n')}\n`
          : 'Nothing was done.\n') +
        `Not done: ${notDone(i)}. ${STOP_REST}`;
      return type === 'error'
        ? {type, summary, errorMessage: summary}
        : {type, summary};
    };
    for (const [i, step] of checked.entries()) {
      if (signal?.aborted) {
        return stopped(i, 'the user pressed Stop.');
      }
      if (i > 0 && !(await backInApp(signal))) {
        return stopped(
          i,
          signal?.aborted
            ? 'the user pressed Stop.'
            : 'the user did not come back to PocketAgent, so this step could not be asked.',
        );
      }
      const result = await new PhoneActionsEngine(step.action).run(
        step.args,
        ctx,
        {number: i + 1, total},
      );
      if (result.type === 'error') {
        return stopped(i, result.summary, 'error');
      }
      if (/^(The user said no|Not done)/.test(result.summary)) {
        return stopped(i, result.summary);
      }
      done.push(`${i + 1}. ${result.summary}`);
    }
    return {
      type: 'text',
      summary:
        `All ${total} steps done:\n${done.join('\n')}\n` +
        'This request is complete: confirm it to the user in one short sentence and call no other tool for it unless they ask for more.',
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: CHAIN_TOOL_NAME,
        description:
          'Do several phone actions one after another for one request, e.g. "directions to <place>, then play <playlist>". ' +
          'The user sees the whole list first, then confirms each step just before it runs and can cancel the rest. ' +
          'Use it only when the user asked for 2 or more phone actions at once; for one action, call its own tool. ' +
          `How: \`steps\` is the list in order (2 to ${MAX_CHAIN_STEPS}); each step has \`action\` (the phone action tool's name, e.g. navigate_to or play_music) ` +
          "and `args` (exactly the arguments that tool takes, from the user's own words).",
        parameters: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              minItems: 2,
              maxItems: MAX_CHAIN_STEPS,
              items: {
                type: 'object',
                properties: {
                  action: {type: 'string', enum: [...PHONE_TOOL_NAMES]},
                  args: {
                    type: 'object',
                    description: "The arguments for that action's tool.",
                  },
                },
                required: ['action', 'args'],
              },
            },
          },
          required: ['steps'],
        },
      },
    };
  }
}
