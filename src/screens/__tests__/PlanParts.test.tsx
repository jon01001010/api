import React from 'react';

describe('plans on screen', () => {
  const {render, fireEvent, waitFor} = require('../../../jest/test-utils');
  const {MakeLoopSheet} = require('../MakeLoopSheet');
  const {PlanRunPanel} = require('../PlanParts');
  const makeLoop = require('../../services/loops/makeLoop');
  const planStore = require('../../services/loops/planStore');
  const planRunner = require('../../services/loops/planRunner');
  const loops = require('../../services/loops/loops');

  afterEach(() => jest.restoreAllMocks());

  it('drafts a plan, lets the user edit its steps, shows the dry run, starts only on confirm', async () => {
    jest
      .spyOn(planRunner, 'planToolsNow')
      .mockReturnValue({web_search: ['query']});
    jest.spyOn(makeLoop, 'draftLoop').mockResolvedValue({
      ok: true,
      draft: {
        ...makeLoop.blankDraft('watch prices'),
        program: {
          plan: {
            steps: [
              {
                ...require('../../services/loops/plan').newStep('ask_model'),
                name: 'Think',
                prompt: 'Ideas',
              },
              {
                ...require('../../services/loops/plan').newStep('ask_user'),
                name: 'Pick',
                question: 'Which?',
                choices: ['A', 'B'],
              },
            ],
            guards: {
              maxSteps: 50,
              maxMinutes: 10,
              maxModelCalls: 10,
              maxToolCalls: 10,
            },
          },
          notes: ['Step 3 dropped: unknown kind "run_code".'],
        },
      },
    });
    const start = jest
      .spyOn(planStore, 'startPlanLoop')
      .mockResolvedValue({ok: true, loop: {title: 'x'}} as any);
    jest.spyOn(loops, 'summary').mockReturnValue('summary');
    const onDone = jest.fn();
    const {getByTestId, getByText, queryByTestId} = render(
      <MakeLoopSheet onDone={onDone} />,
    );
    fireEvent.changeText(getByTestId('make-loop-sentence'), 'watch prices');
    fireEvent.press(getByTestId('make-loop-as-plan'));
    fireEvent.press(getByTestId('make-loop-draft'));
    await waitFor(() => getByTestId('plan-editor'));
    expect(makeLoop.draftLoop.mock.calls[0][2].tools).toEqual({
      web_search: ['query'],
    });
    expect(getByText(/unknown kind "run_code"/)).toBeTruthy();
    expect(queryByTestId('make-loop-prompt')).toBeNull();
    // Add a notify step.
    fireEvent.press(getByTestId('plan-add-step'));
    fireEvent.press(getByTestId('plan-add-notify'));
    expect(getByTestId('plan-step-3')).toBeTruthy();
    fireEvent.press(getByTestId('make-loop-start'));
    await waitFor(() => getByTestId('plan-dry-run'));
    expect(getByText(/Which\? \[A \/ B\]/)).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('plan-start'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const plan = start.mock.calls[0][1] as any;
    // The empty notify step was dropped by the validator before Start.
    expect(plan.steps.map((s: any) => s.kind)).toEqual([
      'ask_model',
      'ask_user',
    ]);
  });

  it('a run panel shows the question and the guard choices', () => {
    const answer = jest
      .spyOn(planRunner, 'answerQuestion')
      .mockResolvedValue(undefined);
    const resolve = jest
      .spyOn(planRunner, 'resolveHold')
      .mockResolvedValue(undefined);
    const base = {
      loopId: 'L',
      version: 1,
      plan: {steps: [], guards: {}},
      pc: 0,
      counts: {steps: 1, model: 1, tools: 0},
      trace: [{at: 1, step: 1, name: 'Think', kind: 'ask_model', output: 'hi'}],
    };
    const {getByTestId, rerender, getByText} = render(
      <PlanRunPanel
        run={{
          ...base,
          status: 'asking',
          question: {step: 2, text: 'Which?', choices: ['A', 'B']},
        }}
      />,
    );
    fireEvent.press(getByTestId('plan-answer-B'));
    expect(answer).toHaveBeenCalledWith('L', 'B');
    rerender(
      <PlanRunPanel
        run={{
          ...base,
          status: 'paused',
          hold: {kind: 'guard', guard: 'model', why: 'Asked 10 times.'},
        }}
      />,
    );
    expect(getByText(/Guard hit: Model calls per run/)).toBeTruthy();
    fireEvent.press(getByTestId('plan-choice-raise'));
    expect(resolve).toHaveBeenCalledWith('L', 'raise');
  });
});
