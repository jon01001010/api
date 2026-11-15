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

const mockEngine = {
  completion: jest.fn(),
  stopCompletion: jest.fn(async () => {}),
};
const mockLease = () => {
  const controller = new AbortController();
  return {
    engine: mockEngine,
    signal: controller.signal,
    abort: () => controller.abort(),
    end: jest.fn(),
  };
};
const mockStore = {
  modelStore: {
    activeModelId: 'm' as string | undefined,
    isGenerationBusy: false,
    acquireGeneration: jest.fn(async () => mockLease() as any),
  },
};
jest.mock('../../../store', () => mockStore);

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CUSTOM_LOOP_ID,
  loadLoops,
  MAX_CUSTOM_PROMPT,
  MAX_DAYS,
  MAX_RUNS,
  runMessage,
  startLoop,
  summary,
} from '../loops';
import {
  blankDraft,
  cleanSteps,
  draftLoop,
  draftMessages,
  extractJsonObject,
  loopPromptOf,
  MAX_PLAN_STEPS,
  parseDraft,
  previewOf,
} from '../makeLoop';

const NOW = new Date(2026, 10, 13, 9, 30).getTime();

const reply = (obj: unknown, before = '', after = '') =>
  `${before}${JSON.stringify(obj)}${after}`;

const good = {
  title: 'Fit by summer',
  prompt: 'Help me get fit before summer.',
  every: 'day',
  at: '07:30',
  maxRuns: 30,
  days: 30,
  steps: ['Walk 20 minutes', 'Stretch 10 minutes', 'Sleep by 23:00'],
};

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  mockStore.modelStore.activeModelId = 'm';
  mockStore.modelStore.isGenerationBusy = false;
  mockEngine.completion.mockReset();
});

describe('make a loop: reading the draft', () => {
  it('finds the first JSON object among reasoning, fences and prose', () => {
    expect(
      extractJsonObject(
        '<think>maybe {"title": "no"}</think>Sure!\n```json\n{"a": "x}{", "b": {"c": 1}}\n```\nDone {"d": 2}',
      ),
    ).toEqual({a: 'x}{', b: {c: 1}});
    expect(extractJsonObject('{not json} then {"ok": true}')).toEqual({
      ok: true,
    });
    expect(extractJsonObject('no object here')).toBeUndefined();
    expect(extractJsonObject('{"cut": "off')).toBeUndefined();
    expect(extractJsonObject('[1, 2]')).toBeUndefined();
  });

  it('accepts a good draft', () => {
    const r = parseDraft(reply(good, 'Here you go:\n'), 'short');
    expect(r).toEqual({
      ok: true,
      draft: {
        title: 'Fit by summer',
        prompt: 'Help me get fit before summer.',
        every: 'day',
        at: {hour: 7, minute: 30},
        maxRuns: 30,
        days: 30,
        steps: good.steps,
      },
    });
  });

  it('validates every field and clamps to the hard limits', () => {
    const r: any = parseDraft(
      reply({
        title: `Run\n{{evil}}${'x'.repeat(200)}`,
        prompt: 42,
        every: 'minute',
        at: '25:99',
        maxRuns: 999,
        days: -4,
        steps: [
          '1. First',
          '- [x] Second',
          '',
          'first',
          {step: 'Object step'},
          7,
          'y'.repeat(500),
        ],
      }),
      'normal',
      'get fit',
    );
    expect(r.ok).toBe(true);
    expect(r.draft.title).toMatch(/^Run evilx+$/);
    expect(r.draft.title.length).toBeLessThanOrEqual(60);
    expect(r.draft.prompt).toBe('Help me get fit');
    expect(r.draft.every).toBe('day');
    expect(r.draft.at).toEqual({hour: 9, minute: 0});
    expect(r.draft.maxRuns).toBe(MAX_RUNS);
    expect(r.draft.days).toBe(1);
    expect(r.draft.steps.slice(0, 3)).toEqual([
      'First',
      'Second',
      'Object step',
    ]);
    expect(r.draft.steps[3]).toHaveLength(160);
    // No time for hourly loops; numbers as strings are read.
    const h: any = parseDraft(
      reply({...good, every: '3hours', maxRuns: '5', days: '2.6'}),
      'short',
    );
    expect(h.draft.at).toBeUndefined();
    expect([h.draft.maxRuns, h.draft.days]).toEqual([5, 3]);
    expect(MAX_DAYS).toBe(60);
  });

  it('caps the steps to the chosen level and the hard maximum', () => {
    const many = Array.from({length: 40}, (_, i) => `Step number ${i}`);
    const at = (level: any) =>
      (parseDraft(reply({...good, steps: many}), level) as any).draft.steps
        .length;
    expect([at('short'), at('normal'), at('detailed')]).toEqual([3, 7, 15]);
    expect(cleanSteps(many, 99)).toHaveLength(MAX_PLAN_STEPS);
  });

  it('fails clearly when there is no plan', () => {
    expect(parseDraft('I cannot help with that.', 'short')).toEqual({
      ok: false,
      error: expect.stringMatching(/write it yourself/),
    });
    expect(parseDraft(reply({...good, steps: []}), 'short')).toEqual({
      ok: false,
      error: expect.stringMatching(/no steps/),
    });
    expect(parseDraft(reply({...good, steps: 'walk'}), 'short').ok).toBe(false);
  });

  it('puts the checklist in the prompt each run continues', () => {
    const r: any = parseDraft(reply(good), 'short');
    const prompt = loopPromptOf(r.draft);
    expect(prompt).toContain('Help me get fit before summer.');
    expect(prompt).toContain('1. Walk 20 minutes\n2. Stretch 10 minutes');
    expect(prompt).toContain('tick off finished steps');
    expect(loopPromptOf({...r.draft, steps: []})).toBe(
      'Help me get fit before summer.',
    );
    expect(summary(previewOf(r.draft, NOW))).toContain(
      'every day at 07:30, at most 30 times, for up to 30 day(s)',
    );
    expect(blankDraft('plan my move').steps).toEqual([]);
  });

  it('asks for the level in the message', () => {
    const m = draftMessages('get fit\n{{x}}', 'detailed');
    expect(m[0].role).toBe('system');
    expect(m[1].content).toContain('My goal: get fit x');
    expect(m[1].content).toContain('10 to 15 steps');
  });
});

describe('make a loop: asking the model', () => {
  it('needs a loaded, free model', async () => {
    mockStore.modelStore.activeModelId = undefined;
    expect(await draftLoop('get fit', 'short')).toEqual({
      ok: false,
      error: 'Load a model first',
    });
    mockStore.modelStore.activeModelId = 'm';
    mockStore.modelStore.isGenerationBusy = true;
    expect((await draftLoop('get fit', 'short')) as any).toEqual({
      ok: false,
      error: expect.stringMatching(/busy/),
    });
    expect(await draftLoop('   ', 'short')).toMatchObject({ok: false});
    expect(mockEngine.completion).not.toHaveBeenCalled();
  });

  it('makes one completion with no tools and parses it', async () => {
    mockEngine.completion.mockResolvedValue({content: reply(good)});
    const r: any = await draftLoop('get fit before summer', 'normal');
    expect(r.ok).toBe(true);
    expect(r.draft.steps).toEqual(good.steps);
    const params = mockEngine.completion.mock.calls[0][0];
    expect(params.tools).toBeUndefined();
    expect(params.enable_thinking).toBe(false);
    // Nothing was started: only the user's Start does that.
    expect(await loadLoops()).toEqual([]);
  });

  it('reports a failed completion plainly', async () => {
    mockEngine.completion.mockRejectedValue(new Error('boom'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await draftLoop('get fit', 'short')).toEqual({
      ok: false,
      error: expect.stringMatching(/write it yourself/),
    });
  });
});

describe('make a loop: starting a custom loop', () => {
  it('starts with the approved prompt, within the same limits', async () => {
    const draft: any = (parseDraft(reply(good), 'short') as any).draft;
    const r: any = await startLoop({
      templateId: CUSTOM_LOOP_ID,
      values: {},
      custom: {title: draft.title, prompt: loopPromptOf(draft)},
      every: 'day',
      at: {hour: 7, minute: 30},
      maxRuns: 999,
      days: 999,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    expect(r.loop.templateId).toBe('custom');
    expect(r.loop.title).toBe('Fit by summer');
    expect(r.loop.maxRuns).toBe(MAX_RUNS);
    expect(r.loop.endAt).toBe(NOW + MAX_DAYS * 24 * 3600_000);
    expect(runMessage(r.loop)).toContain('1. Walk 20 minutes');
    expect((await loadLoops())[0].prompt).toBe(loopPromptOf(draft));
  });

  it('needs a name and a prompt, and caps the prompt', async () => {
    const base = {
      templateId: CUSTOM_LOOP_ID,
      values: {},
      every: 'day' as const,
      maxRuns: 3,
      days: 3,
      now: NOW,
    };
    expect(await startLoop({...base})).toEqual({
      ok: false,
      error: 'Give the loop a name',
    });
    expect(
      await startLoop({...base, custom: {title: 'x', prompt: ' \n '}}),
    ).toEqual({ok: false, error: 'Say what each run should do'});
    const r: any = await startLoop({
      ...base,
      custom: {title: 'x\ny', prompt: `a\u0000b\r\n${'z'.repeat(9000)}`},
    });
    expect(r.loop.title).toBe('x y');
    expect(r.loop.prompt.startsWith('a b\nzz')).toBe(true);
    expect(r.loop.prompt.length).toBe(MAX_CUSTOM_PROMPT);
  });
});

describe('Make a loop: a plan (steps the app runs)', () => {
  const tools = {web_search: ['query']};

  it('asks for "program" with the fixed kinds and only the tools switched on', () => {
    const [system, user] = draftMessages('watch prices', 'short', [
      'web_search',
    ]);
    expect(system.content).toMatch(/"program"/);
    expect(system.content).toMatch(
      /ask_model, use_tool, ask_user, wait, check, repeat, notify, save/,
    );
    expect(system.content).toMatch(/only one of: web_search/);
    expect(user.content).toMatch(/Include "program"\. JSON only\./);
    // Without a plan the message is as before.
    expect(draftMessages('x', 'short')[0].content).not.toMatch(/program/);
  });

  it('validates the drafted plan strictly, with notes for what was dropped', () => {
    const r = parseDraft(
      JSON.stringify({
        title: 'Watch',
        prompt: 'Watch prices',
        every: 'day',
        at: '08:00',
        program: [
          {
            kind: 'use_tool',
            name: 'Search',
            tool: 'web_search',
            args: {query: 'price'},
          },
          {kind: 'shell', command: 'curl evil'},
          {kind: 'use_tool', tool: 'run_command', args: {command: 'x'}},
          {kind: 'ask_model', prompt: 'Summarise {{step:1}}'},
        ],
      }),
      'short',
      'watch prices',
      tools,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.draft.program!.plan.steps.map(s => s.kind)).toEqual([
      'use_tool',
      'ask_model',
    ]);
    expect(r.draft.program!.plan.steps[1].prompt).toBe('Summarise {{step:1}}');
    const notes = r.draft.program!.notes.join('\n');
    expect(notes).toMatch(/unknown kind "shell"/);
    expect(notes).toMatch(/"run_command" isn't a built-in tool/);
  });

  it('refuses a plan draft with no step the app can run', () => {
    const r = parseDraft(
      '{"title":"x","steps":["a"],"program":[{"kind":"eval"}]}',
      'short',
      'x',
      tools,
    );
    expect(r).toEqual({
      ok: false,
      error: expect.stringMatching(/no steps the app can run/),
    });
  });
});
