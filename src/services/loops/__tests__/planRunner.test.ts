jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const store = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    clear: jest.fn(async () => values.clear()),
  };
  return {__esModule: true, default: store, ...store};
});
jest.mock('../loopNotify', () => ({
  syncLoopAlarms: jest.fn(async () => {}),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import {loadLoops, type LoopInput} from '../loops';
import {
  DEFAULT_GUARDS,
  newStep,
  type Plan,
  type PlanStep,
  type PlanTools,
} from '../plan';
import {
  answerQuestion,
  drivePlan,
  guardHit,
  holdChoices,
  pausePlanRun,
  type PlanDeps,
  planRunOf,
  type PlanRun,
  resetPlanRunsForTests,
  resolveHold,
  setPlanDeps,
  startPlanRun,
  stopPlanRun,
} from '../planRunner';
import {
  currentPlan,
  lastResultsOf,
  MAX_VERSIONS,
  planVersions,
  restorePlanVersion,
  savePlanEdit,
  savePlanVersion,
  startPlanLoop,
} from '../planStore';

const TOOLS: PlanTools = {
  web_search: ['query'],
  memory_get: [],
  memory_replace: ['content', 'expected_previous'],
  file_append: ['filename', 'content'],
  file_create: ['filename', 'content'],
};

const step = (
  kind: PlanStep['kind'],
  over: Partial<PlanStep> = {},
): PlanStep => ({
  ...newStep(kind),
  ...over,
});

const plan = (steps: PlanStep[], guards = {}): Plan => ({
  steps,
  guards: {...DEFAULT_GUARDS, ...guards},
});

let calls: {
  model: string[];
  tools: {name: string; args: any}[];
  notes: string[];
  log: string[];
};
let replies: (string | Error | ((signal: AbortSignal) => Promise<string>))[];
let toolReply: (name: string, args: any) => Promise<string>;
let clock: number;

function fakeDeps(over: Partial<PlanDeps> = {}) {
  setPlanDeps({
    complete: async (prompt, signal) => {
      calls.model.push(prompt);
      const r = replies.shift() ?? `reply ${calls.model.length}`;
      if (typeof r === 'function') {
        return r(signal);
      }
      if (r instanceof Error) {
        throw r;
      }
      return r;
    },
    runTool: async (name, args) => {
      calls.tools.push({name, args});
      return toolReply(name, args);
    },
    notify: (_t, text) => {
      calls.notes.push(text);
    },
    log: async (_id, what) => {
      calls.log.push(what);
    },
    sleep: async () => {},
    now: () => (clock += 1000),
    ...over,
  });
}

const LOOP = {id: 'L1', title: 'My plan'};

async function seed(p: Plan, id = LOOP.id) {
  const r = await savePlanVersion(id, p, 'Made', TOOLS);
  if (!r.ok) {
    throw new Error(r.error);
  }
}

async function runToEnd(p: Plan, options = {}): Promise<PlanRun> {
  await seed(p);
  expect(await startPlanRun(LOOP, options)).toBeUndefined();
  await drivePlan(LOOP.id);
  return (await planRunOf(LOOP.id))!;
}

beforeEach(async () => {
  resetPlanRunsForTests();
  await (AsyncStorage as any).clear();
  calls = {model: [], tools: [], notes: [], log: []};
  replies = [];
  toolReply = async name => `${name} result`;
  clock = 1_000_000;
  fakeDeps();
});

afterAll(() => setPlanDeps(null));

describe('the plan runner', () => {
  it('runs every step in order, filling earlier results in as plain text', async () => {
    replies = ['cheap flights'];
    const run = await runToEnd(
      plan([
        step('ask_model', {prompt: 'Topic?'}),
        step('use_tool', {
          tool: 'web_search',
          args: {query: 'find {{step:1}}'},
        }),
        step('ask_model', {prompt: 'Sum up: {{step:2}}'}),
        step('notify', {text: 'Done: {{step:3}}'}),
      ]),
    );
    expect(run.status).toBe('done');
    expect(calls.model).toEqual(['Topic?', 'Sum up: web_search result']);
    expect(calls.tools).toEqual([
      {name: 'web_search', args: {query: 'find cheap flights'}},
    ]);
    expect(calls.notes).toEqual(['Done: reply 2']);
    expect(run.counts).toEqual({steps: 4, model: 2, tools: 1});
    expect(run.trace.map(t => t.step)).toEqual([0, 1, 2, 3, 4, 0]);
    expect(run.trace[2]).toMatchObject({
      input: 'web_search {"query":"find cheap flights"}',
      output: 'web_search result',
    });
    expect(calls.log[0]).toMatch(
      /Plan run done: 4 steps, 2 model calls, 1 tool calls/,
    );
    // Fingerprints only, for "changed since the last run".
    expect(Object.keys(await lastResultsOf(LOOP.id))).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(JSON.stringify(await lastResultsOf(LOOP.id))).not.toMatch(/cheap/);
  });

  it('caps what the trace and results keep', async () => {
    replies = ['x'.repeat(10_000)];
    const run = await runToEnd(plan([step('ask_model', {prompt: 'Long'})]));
    expect(run.results['1'].length).toBe(2000);
    expect(run.trace[1].output!.length).toBeLessThanOrEqual(200);
  });

  it('waits for the user at an "ask me" step; only its choices are taken', async () => {
    await seed(
      plan([
        step('ask_user', {question: 'Gym or run?', choices: ['Gym', 'Run']}),
        step('ask_model', {prompt: 'Plan a {{step:1}}'}),
      ]),
    );
    await startPlanRun(LOOP);
    await drivePlan(LOOP.id);
    let run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('asking');
    expect(run.question).toEqual({
      step: 1,
      text: 'Gym or run?',
      choices: ['Gym', 'Run'],
    });
    expect(calls.model).toEqual([]);
    expect(await answerQuestion(LOOP.id, 'Swim')).toBe(
      'Not one of the choices',
    );
    expect(await answerQuestion(LOOP.id, 'Run')).toBeUndefined();
    await drivePlan(LOOP.id);
    run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('done');
    expect(calls.model).toEqual(['Plan a Run']);
  });

  it('skips the next step or ends a repeat on a check', async () => {
    replies = ['nothing yet', 'still nothing', 'price 10'];
    const run = await runToEnd(
      plan([
        step('repeat', {count: 2, times: 5}),
        step('ask_model', {prompt: 'Look'}),
        step('check', {
          ref: 2,
          test: 'not_contains',
          value: 'price',
          ifNot: 'end',
        }),
        step('check', {ref: 2, test: 'above', value: '50', ifNot: 'skip_next'}),
        step('notify', {text: 'Expensive'}),
        step('notify', {text: 'Bye'}),
      ]),
    );
    expect(run.status).toBe('done');
    expect(calls.model).toHaveLength(3);
    expect(calls.notes).toEqual(['Bye']);
  });

  it('retries once, then stops and asks; skip goes on', async () => {
    replies = [new Error('offline'), new Error('offline again')];
    await seed(
      plan([
        step('ask_model', {prompt: 'A', onFail: 'retry'}),
        step('ask_model', {prompt: 'B', onFail: 'skip'}),
        step('notify', {text: '{{step:2}}'}),
      ]),
    );
    await startPlanRun(LOOP);
    await drivePlan(LOOP.id);
    let run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('paused');
    expect(run.hold).toMatchObject({kind: 'failed', step: 1});
    expect(run.hold!.why).toMatch(/offline again/);
    expect(holdChoices(run)).toEqual(['retry', 'skip', 'stop']);
    replies = [new Error('down')];
    expect(await resolveHold(LOOP.id, 'skip')).toBeUndefined();
    await drivePlan(LOOP.id);
    run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('done');
    expect(calls.notes[0]).toMatch(/^\(skipped: down\)/);
    expect(
      run.trace.some(t => /You chose: Skip the step/.test(t.note ?? '')),
    ).toBe(true);
  });

  it('stops a step at its time limit', async () => {
    jest.useFakeTimers();
    try {
      replies = [() => new Promise(() => {})];
      await seed(plan([step('ask_model', {prompt: 'Slow', timeLimitSec: 5})]));
      await startPlanRun(LOOP);
      const going = drivePlan(LOOP.id);
      await jest.advanceTimersByTimeAsync(6000);
      await going;
      const run = (await planRunOf(LOOP.id))!;
      expect(run.hold?.why).toMatch(/Took longer than 5 s/);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('guards', () => {
  it('pauses at the model budget; continue once, raise and stop are the user’s', async () => {
    await seed(
      plan(
        [
          step('repeat', {count: 1, times: 10}),
          step('ask_model', {prompt: 'Next'}),
        ],
        {maxModelCalls: 2},
      ),
    );
    await startPlanRun(LOOP);
    await drivePlan(LOOP.id);
    let run = (await planRunOf(LOOP.id))!;
    expect(calls.model).toHaveLength(2);
    expect(run.hold).toMatchObject({kind: 'guard', guard: 'model'});
    expect(holdChoices(run)).toEqual(['once', 'raise', 'stop']);
    await resolveHold(LOOP.id, 'once');
    await drivePlan(LOOP.id);
    run = (await planRunOf(LOOP.id))!;
    expect(calls.model).toHaveLength(3);
    expect(run.hold?.guard).toBe('model');
    await resolveHold(LOOP.id, 'raise');
    await drivePlan(LOOP.id);
    run = (await planRunOf(LOOP.id))!;
    expect(run.limits.maxModelCalls).toBe(6);
    expect(calls.model).toHaveLength(6);
    await resolveHold(LOOP.id, 'stop');
    run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('stopped');
    expect(calls.log.join('\n')).toMatch(
      /you chose continue once \(Model calls per run\)/,
    );
    expect(calls.log.join('\n')).toMatch(/you chose raise the limit to 6/);
    expect(calls.log.join('\n')).toMatch(/you chose stop/);
  });

  it('pauses at the step and tool limits', async () => {
    let run = await runToEnd(
      plan(
        [
          step('notify', {text: 'a'}),
          step('notify', {text: 'b'}),
          step('notify', {text: 'c'}),
        ],
        {maxSteps: 2},
      ),
    );
    expect(run.hold).toMatchObject({guard: 'steps', step: 3});
    resetPlanRunsForTests();
    await (AsyncStorage as any).clear();
    run = await runToEnd(
      plan(
        [
          step('use_tool', {tool: 'web_search', args: {query: 'a'}}),
          step('save', {target: 'memory', text: 'x'}),
        ],
        {maxToolCalls: 2},
      ),
    );
    expect(run.hold).toMatchObject({guard: 'tools', step: 2});
  });

  it('pauses on no progress (same step, same result twice)', async () => {
    replies = ['same', 'same', 'same', 'same'];
    await seed(
      plan([
        step('repeat', {count: 1, times: 4}),
        step('ask_model', {prompt: 'Any news?'}),
      ]),
    );
    await startPlanRun(LOOP);
    await drivePlan(LOOP.id);
    let run = (await planRunOf(LOOP.id))!;
    expect(calls.model).toHaveLength(2);
    expect(run.hold).toMatchObject({guard: 'no_progress', step: 2});
    await resolveHold(LOOP.id, 'raise');
    await drivePlan(LOOP.id);
    run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('done');
    expect(calls.model).toHaveLength(4);
  });

  it('pauses at the working-time limit (waits not counted)', async () => {
    let t = 0;
    setPlanDeps(null);
    fakeDeps({now: () => (t += 4 * 60_000)});
    const run = await runToEnd(
      plan(
        [
          step('wait', {seconds: 3600}),
          ...['a', 'b', 'c', 'd', 'e'].map(p => step('ask_model', {prompt: p})),
        ],
        {maxMinutes: 10},
      ),
    );
    expect(run.hold?.guard).toBe('time');
    expect(calls.model).toHaveLength(3);
  });

  it('runaway stop: a plan tool that changes tools is never run', () => {
    const run = {
      limits: {...DEFAULT_GUARDS},
      counts: {steps: 0, model: 0, tools: 0},
      busyMs: 0,
    } as PlanRun;
    expect(guardHit(run, step('use_tool', {tool: 'tool_save'}))?.guard).toBe(
      'runaway',
    );
  });

  it('one unfinished plan run at a time, and its plan is not edited under it', async () => {
    await seed(plan([step('ask_user', {question: 'Q?', choices: ['A', 'B']})]));
    await seed(plan([step('notify', {text: 'x'})]), 'L2');
    await startPlanRun(LOOP);
    await drivePlan(LOOP.id);
    expect(await startPlanRun({id: 'L2', title: 'Other'})).toMatch(
      /Another plan \("My plan"\)/,
    );
    expect(await startPlanRun(LOOP)).toMatch(/last run isn't finished/);
    const r = await savePlanVersion(
      LOOP.id,
      plan([step('notify', {text: 'y'})]),
      'Edited',
      TOOLS,
    );
    expect(r).toEqual({
      ok: false,
      error: expect.stringMatching(/stop it first/),
    });
    await stopPlanRun(LOOP.id);
    expect(await startPlanRun({id: 'L2', title: 'Other'})).toBeUndefined();
  });
});

describe('pause, step through, stop', () => {
  it('steps through one step at a time', async () => {
    await seed(
      plan([
        step('notify', {text: 'a'}),
        step('notify', {text: 'b'}),
        step('notify', {text: 'c'}),
      ]),
    );
    await startPlanRun(LOOP, {stepThrough: true});
    await drivePlan(LOOP.id);
    expect(calls.notes).toEqual(['a']);
    let run = (await planRunOf(LOOP.id))!;
    expect(run.hold?.kind).toBe('step');
    expect(holdChoices(run)).toEqual(['continue', 'step', 'stop']);
    await resolveHold(LOOP.id, 'step');
    await drivePlan(LOOP.id);
    expect(calls.notes).toEqual(['a', 'b']);
    await resolveHold(LOOP.id, 'continue');
    await drivePlan(LOOP.id);
    run = (await planRunOf(LOOP.id))!;
    expect(calls.notes).toEqual(['a', 'b', 'c']);
    expect(run.status).toBe('done');
  });

  it('pauses during a wait (kept) and stops a run', async () => {
    setPlanDeps(null);
    fakeDeps({
      sleep: (_ms, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Stopped'))),
        ),
    });
    await seed(
      plan([step('wait', {seconds: 600}), step('notify', {text: 'after'})]),
    );
    await startPlanRun(LOOP);
    const going = drivePlan(LOOP.id);
    await new Promise(r => setTimeout(r, 0));
    await pausePlanRun(LOOP.id);
    await going;
    let run = (await planRunOf(LOOP.id))!;
    expect(run.hold?.kind).toBe('user');
    expect(run.waitUntil).toBeGreaterThan(0);
    await stopPlanRun(LOOP.id);
    run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('stopped');
    expect(calls.notes).toEqual([]);
  });
});

describe('after an app restart', () => {
  it('a step that was running is asked about, never re-run by itself', async () => {
    replies = [() => new Promise(() => {})];
    await seed(
      plan([
        step('ask_model', {prompt: 'Slow'}),
        step('notify', {text: 'end'}),
      ]),
    );
    await startPlanRun(LOOP);
    await new Promise(r => setTimeout(r, 0));
    expect(calls.model).toHaveLength(1);
    // The app is closed mid-step, then opened again.
    resetPlanRunsForTests();
    let run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('paused');
    expect(run.hold).toMatchObject({kind: 'restart', step: 1});
    expect(run.inFlight).toBeUndefined();
    expect(holdChoices(run)).toEqual(['retry', 'skip', 'stop']);
    await new Promise(r => setTimeout(r, 0));
    expect(calls.model).toHaveLength(1);
    replies = ['ok'];
    await resolveHold(LOOP.id, 'retry');
    await drivePlan(LOOP.id);
    run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('done');
    expect(calls.model).toHaveLength(2);
    expect(calls.notes).toEqual(['end']);
  });

  it('a question waiting stays; a run between steps continues where it stopped', async () => {
    await seed(
      plan([
        step('notify', {text: 'one'}),
        step('ask_user', {question: 'Q?', choices: ['A', 'B']}),
        step('notify', {text: '{{step:2}}'}),
      ]),
    );
    await startPlanRun(LOOP);
    await drivePlan(LOOP.id);
    resetPlanRunsForTests();
    let run = (await planRunOf(LOOP.id))!;
    expect(run.status).toBe('asking');
    await answerQuestion(LOOP.id, 'B');
    await drivePlan(LOOP.id);
    expect(calls.notes).toEqual(['one', 'B']);
    // A run saved as "running" between steps (closed after a step).
    resetPlanRunsForTests();
    await (AsyncStorage as any).clear();
    await seed(
      plan([step('notify', {text: 'x'}), step('notify', {text: 'y'})]),
    );
    await AsyncStorage.setItem(
      '@pocketagent/loop-plan-runs/v1',
      JSON.stringify({
        L1: {
          ...(run as any),
          plan: plan([
            step('notify', {text: 'x'}),
            step('notify', {text: 'y'}),
          ]),
          status: 'running',
          question: undefined,
          inFlight: undefined,
          pc: 1,
          trace: [],
        },
      }),
    );
    resetPlanRunsForTests();
    run = (await planRunOf(LOOP.id))!;
    expect(run.hold).toMatchObject({kind: 'restart'});
    expect(holdChoices(run)).toEqual(['continue', 'step', 'stop']);
    calls.notes = [];
    await resolveHold(LOOP.id, 'continue');
    await drivePlan(LOOP.id);
    expect(calls.notes).toEqual(['y']);
  });
});

describe('save steps', () => {
  it('save to memory reads then asks to replace (through the tools)', async () => {
    toolReply = async name => (name === 'memory_get' ? 'old' : 'ok');
    await runToEnd(plan([step('save', {target: 'memory', text: 'new line'})]));
    expect(calls.tools).toEqual([
      {name: 'memory_get', args: {}},
      {
        name: 'memory_replace',
        args: {content: 'old\nnew line', expected_previous: 'old'},
      },
    ]);
  });

  it('save to the workspace appends, or makes the file', async () => {
    toolReply = async name => {
      if (name === 'file_append') {
        throw new Error('File not found. Use file_create.');
      }
      return 'ok';
    };
    const run = await runToEnd(
      plan([step('save', {target: 'workspace', file: 'n.md', text: 'hi'})]),
    );
    expect(calls.tools.map(c => c.name)).toEqual([
      'file_append',
      'file_create',
    ]);
    expect(run.results['1']).toBe('Saved as n.md');
  });
});

describe('versions', () => {
  it('keeps the last 10 versions; going back saves a copy as the newest', async () => {
    for (let i = 1; i <= 12; i++) {
      await seed(plan([step('notify', {text: `v${i}`})]));
    }
    const list = await planVersions(LOOP.id);
    expect(list).toHaveLength(MAX_VERSIONS);
    expect(list[0].v).toBe(3);
    const back = await restorePlanVersion(LOOP.id, 5, TOOLS);
    expect(back.ok && back.version.v).toBe(13);
    expect((await currentPlan(LOOP.id))!.plan.steps[0].text).toBe('v5');
    expect((await currentPlan(LOOP.id))!.note).toBe('Back to version 5');
    expect(await restorePlanVersion(LOOP.id, 1, TOOLS)).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });

  it('a run uses the version it started with', async () => {
    await seed(
      plan([
        step('ask_user', {question: 'Q?', choices: ['A', 'B']}),
        step('notify', {text: 'old'}),
      ]),
    );
    await startPlanRun(LOOP);
    await drivePlan(LOOP.id);
    const run = (await planRunOf(LOOP.id))!;
    expect(run.version).toBe(1);
    await answerQuestion(LOOP.id, 'A');
    await drivePlan(LOOP.id);
    expect(calls.notes).toEqual(['old']);
  });

  it('starts a plan loop and saves edits as new versions', async () => {
    const input: LoopInput = {
      templateId: 'custom',
      values: {},
      custom: {title: 'Watch', prompt: 'x'},
      every: 'day',
      at: {hour: 9, minute: 0},
      maxRuns: 5,
      days: 5,
    };
    const r = await startPlanLoop(
      input,
      plan([step('notify', {text: 'hi'}), {kind: 'bogus'} as any]),
      TOOLS,
    );
    expect(r.ok).toBe(true);
    const loop = (await loadLoops())[0];
    expect(loop.kind).toBe('plan');
    expect(loop.prompt).toMatch(/^1\. Notify me: Shows you: "hi"/);
    const e = await savePlanEdit(
      loop.id,
      plan([step('notify', {text: 'bye'})]),
      TOOLS,
    );
    expect(e.ok).toBe(true);
    const after = (await loadLoops())[0];
    expect(after.prompt).toMatch(/bye/);
    expect(after.log[0].what).toBe('Plan: edited (version 2)');
  });
});
