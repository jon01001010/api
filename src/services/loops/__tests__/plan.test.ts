import {fingerprint} from '../loops';
import {
  cleanFileName,
  DEFAULT_GUARDS,
  describeStep,
  dryRunPlan,
  evalCheck,
  fillRefs,
  GUARD_CAPS,
  moveStep,
  newStep,
  type PlanStep,
  type PlanTools,
  removeStep,
  STEP_KINDS,
  validatePlan,
} from '../plan';

const TOOLS: PlanTools = {
  web_search: ['query'],
  read_url: ['url'],
  memory_get: [],
  memory_replace: ['content', 'expected_previous'],
  file_append: ['filename', 'content'],
  file_create: ['filename', 'content'],
};

const ask = (prompt: string, name = 'Think'): PlanStep => ({
  ...newStep('ask_model'),
  name,
  prompt,
});

describe('validatePlan', () => {
  it('keeps the fixed kinds with their fields and defaults', () => {
    const {plan, notes} = validatePlan(
      {
        steps: [
          {kind: 'ask_model', name: 'Idea', prompt: 'Give one idea'},
          {kind: 'use_tool', tool: 'web_search', args: {query: '{{step:1}}'}},
          {kind: 'ask_user', question: 'Good?', choices: ['Yes', 'No', 'yes']},
          {kind: 'wait', seconds: '90'},
          {
            kind: 'check',
            step: 2,
            test: 'contains',
            value: 'price',
            ifNot: 'end',
          },
          {kind: 'repeat', count: 1, times: 3},
          {kind: 'notify', text: 'Done: {{step:1}}'},
          {kind: 'save', target: 'workspace', text: 'x', file: 'notes.md'},
        ],
        guards: {maxSteps: 9999, maxModelCalls: '3'},
      },
      TOOLS,
    );
    expect(notes).toEqual([]);
    expect(plan.steps.map(s => s.kind)).toEqual([
      'ask_model',
      'use_tool',
      'ask_user',
      'wait',
      'check',
      'repeat',
      'notify',
      'save',
    ]);
    expect(plan.steps[0]).toMatchObject({
      name: 'Idea',
      timeLimitSec: 120,
      onFail: 'stop',
    });
    expect(plan.steps[1].args).toEqual({query: '{{step:1}}'});
    expect(plan.steps[2].choices).toEqual(['Yes', 'No']);
    expect(plan.steps[3].seconds).toBe(90);
    expect(plan.steps[4]).toMatchObject({
      ref: 2,
      test: 'contains',
      ifNot: 'end',
    });
    expect(plan.guards).toEqual({
      ...DEFAULT_GUARDS,
      maxSteps: GUARD_CAPS.maxSteps,
      maxModelCalls: 3,
    });
  });

  it('drops unknown kinds, unknown or forbidden tools and odd inputs, with notes', () => {
    const {plan, notes} = validatePlan(
      [
        {kind: 'run_code', code: 'rm -rf /'},
        {kind: 'use_tool', tool: 'tool_save', args: {}},
        {kind: 'use_tool', tool: 'my_custom_tool'},
        {
          kind: 'use_tool',
          tool: 'read_url',
          args: {url: 'https://a.b', evil: 'x', n: {a: 1}},
        },
        'just text',
        {kind: 'ask_user', question: 'Only one?', choices: ['A']},
        {kind: 'save', target: 'workspace', text: 'x', file: '../etc/passwd'},
      ],
      TOOLS,
    );
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].args).toEqual({url: 'https://a.b'});
    expect(notes.join('\n')).toMatch(/Step 1 dropped: unknown kind "run_code"/);
    expect(notes.join('\n')).toMatch(
      /Step 2 dropped: "tool_save" changes tools/,
    );
    expect(notes.join('\n')).toMatch(
      /Step 3 dropped: "my_custom_tool" isn't a built-in tool/,
    );
    expect(notes.join('\n')).toMatch(/input "evil" isn't one read_url takes/);
    expect(notes.join('\n')).toMatch(/Step 5 dropped: not a step/);
    expect(notes.join('\n')).toMatch(/Step 6 dropped: needs 2 to 4 choices/);
    expect(notes.join('\n')).toMatch(/Step 7 dropped: needs a plain file name/);
  });

  it('renumbers references after dropped steps; a check on a dropped step goes too', () => {
    const {plan, notes} = validatePlan(
      [
        {kind: 'bogus'},
        {kind: 'ask_model', prompt: 'A'},
        {
          kind: 'ask_model',
          prompt: 'Use {{step:2}} and {{step:1}} and {{step:9}}',
        },
        {kind: 'check', step: 1, test: 'changed'},
      ],
      TOOLS,
    );
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1].prompt).toBe(
      'Use {{step:1}} and (removed step) and (removed step)',
    );
    expect(notes.join('\n')).toMatch(
      /Step 4 dropped: checks no earlier step|the step it checks was dropped/,
    );
  });

  it('clamps repeats to 10 and keeps a block from holding another repeat', () => {
    const {plan, notes} = validatePlan(
      [
        {kind: 'repeat', count: 5, times: 50},
        {kind: 'ask_model', prompt: 'A'},
        {kind: 'repeat', count: 1, times: 2},
        {kind: 'ask_model', prompt: 'B'},
      ],
      TOOLS,
    );
    expect(plan.steps[0]).toMatchObject({kind: 'repeat', count: 1, times: 10});
    expect(plan.steps[2]).toMatchObject({kind: 'repeat', count: 1, times: 2});
    expect(notes.join('\n')).toMatch(/cut to 10 times/);
    expect(notes.join('\n')).toMatch(/can't hold another repeat/);
  });

  it('keeps at most 20 steps and caps text', () => {
    const many = Array.from({length: 30}, (_, i) => ({
      kind: 'notify',
      text: `n${i}`,
    }));
    const {plan, notes} = validatePlan(many, TOOLS);
    expect(plan.steps).toHaveLength(20);
    expect(notes[0]).toMatch(/More than 20 steps/);
    const long = validatePlan(
      [{kind: 'ask_model', prompt: 'x'.repeat(5000)}],
      TOOLS,
    );
    expect(long.plan.steps[0].prompt!.length).toBe(1500);
  });

  it('accepts only the fixed list of kinds', () => {
    expect([...STEP_KINDS].sort()).toEqual([
      'ask_model',
      'ask_user',
      'check',
      'notify',
      'repeat',
      'save',
      'use_tool',
      'wait',
    ]);
  });
});

describe('references and checks', () => {
  it('fills results as plain text, one pass only', () => {
    expect(
      fillRefs('A {{step:1}} B {{ step : 2 }} C {{step:3}}', {
        '1': 'one {{step:2}}',
        '2': 'two',
      }),
    ).toBe('A one {{step:2}} B two C (no result yet)');
  });

  it('moves and removes steps with references following', () => {
    const steps = [ask('a'), ask('b'), ask('{{step:1}}+{{step:2}}')];
    const moved = moveStep(steps, 0, 1);
    expect(moved.map(s => s.prompt)).toEqual([
      'b',
      'a',
      '{{step:2}}+{{step:1}}',
    ]);
    const removed = removeStep(steps, 0);
    expect(removed.map(s => s.prompt)).toEqual([
      'b',
      '(removed step)+{{step:1}}',
    ]);
    const check = {...newStep('check'), ref: 2};
    expect(removeStep([ask('a'), ask('b'), check], 0)[1].ref).toBe(1);
  });

  it('evaluates checks', () => {
    const results = {'1': 'Price is 42,5 EUR', '2': 'nothing'};
    const c = (over: Partial<PlanStep>) => ({
      ...newStep('check'),
      ref: 1,
      ...over,
    });
    expect(evalCheck(c({test: 'contains', value: 'price'}), results)).toBe(
      true,
    );
    expect(evalCheck(c({test: 'not_contains', value: 'price'}), results)).toBe(
      false,
    );
    expect(evalCheck(c({test: 'above', value: '40'}), results)).toBe(true);
    expect(evalCheck(c({test: 'below', value: '40'}), results)).toBe(false);
    expect(evalCheck(c({ref: 2, test: 'above', value: '1'}), results)).toBe(
      false,
    );
    expect(evalCheck(c({test: 'changed'}), results)).toBe(true);
    expect(
      evalCheck(c({test: 'changed'}), results, {
        '1': fingerprint(results['1']),
      }),
    ).toBe(false);
    expect(evalCheck(c({test: 'changed'}), results, {'1': 'other'})).toBe(true);
  });

  it('cleans workspace file names', () => {
    expect(cleanFileName('notes.md')).toBe('notes.md');
    expect(cleanFileName('a/b.md')).toBeUndefined();
    expect(cleanFileName('x.exe')).toBeUndefined();
    expect(cleanFileName('a..md')).toBeUndefined();
  });
});

describe('dry run', () => {
  it('walks the plan without calling anything, with questions and limits', () => {
    const {plan} = validatePlan(
      {
        steps: [
          {kind: 'repeat', count: 2, times: 8},
          {kind: 'ask_model', prompt: 'Next idea'},
          {kind: 'use_tool', tool: 'web_search', args: {query: 'x'}},
          {kind: 'ask_user', question: 'Keep going?', choices: ['Yes', 'No']},
          {kind: 'save', text: 'note'},
        ],
        guards: {maxModelCalls: 5},
      },
      TOOLS,
    );
    const dry = dryRunPlan(plan, ['web_search']);
    expect(dry.lines.map(l => l.rounds)).toEqual([1, 8, 8, 1, 1]);
    expect(dry.lines[2].warn).toMatch(/Switched on/);
    expect(dry.lines[4].warn).toMatch(
      /memory_get and memory_replace switched off/,
    );
    expect(dry.questions).toEqual(['Keep going? [Yes / No]']);
    expect(dry.most).toEqual({steps: 19, model: 8, tools: 10});
    expect(dry.guardNotes.join('\n')).toMatch(
      /asks the model 8 times: it would pause at 5/,
    );
    expect(dryRunPlan(plan, []).lines[2].warn).toMatch(/switched off/);
    expect(describeStep(plan.steps[0], 1)).toBe(
      'Repeats steps 2–3 up to 8 times',
    );
  });
});
