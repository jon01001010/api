import React from 'react';

describe('Make a loop sheet', () => {
  const {render, fireEvent, waitFor} = require('../../../jest/test-utils');
  const {MakeLoopSheet} = require('../MakeLoopSheet');
  const makeLoop = require('../../services/loops/makeLoop');
  const loops = require('../../services/loops/loops');

  afterEach(() => jest.restoreAllMocks());

  it('drafts, lets the user edit and reorder steps, and starts only on Start', async () => {
    jest.spyOn(makeLoop, 'draftLoop').mockResolvedValue({
      ok: true,
      draft: {
        title: 'Fit by summer',
        prompt: 'Help me get fit.',
        every: 'day',
        at: {hour: 7, minute: 0},
        maxRuns: 10,
        days: 10,
        steps: ['Walk', 'Stretch', 'Sleep early'],
      },
    });
    const start = jest
      .spyOn(loops, 'startLoop')
      .mockResolvedValue({ok: true, loop: {title: 'x'}} as any);
    jest.spyOn(loops, 'summary').mockReturnValue('summary');
    const onDone = jest.fn();
    const {getByTestId, getByLabelText, queryByTestId} = render(
      <MakeLoopSheet onDone={onDone} />,
    );
    fireEvent.changeText(getByTestId('make-loop-sentence'), 'get fit');
    fireEvent.press(getByTestId('make-loop-draft'));
    await waitFor(() => getByTestId('make-loop-review'));
    expect(makeLoop.draftLoop).toHaveBeenCalledWith('get fit', 'normal');
    expect(start).not.toHaveBeenCalled();

    fireEvent.press(getByLabelText('Move step 2 up'));
    fireEvent.press(getByLabelText('Delete step 3'));
    expect(queryByTestId('make-loop-step-2')).toBeNull();
    expect(getByTestId('make-loop-prompt').props.children).toContain(
      '1. Stretch\n2. Walk',
    );

    fireEvent.press(getByTestId('make-loop-start'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const input = start.mock.calls[0][0] as any;
    expect(input.templateId).toBe('custom');
    expect(input.custom.title).toBe('Fit by summer');
    expect(input.custom.prompt).toContain('1. Stretch\n2. Walk');
    expect(input.custom.prompt).not.toContain('Sleep early');
  });

  it('shows why a draft failed, and offers to write it yourself', async () => {
    jest
      .spyOn(makeLoop, 'draftLoop')
      .mockResolvedValue({ok: false, error: 'Load a model first'});
    const {getByTestId} = render(<MakeLoopSheet onDone={() => {}} />);
    fireEvent.changeText(getByTestId('make-loop-sentence'), 'plan my move');
    fireEvent.press(getByTestId('make-loop-draft'));
    await waitFor(() =>
      expect(getByTestId('make-loop-error').props.children).toBe(
        'Load a model first',
      ),
    );
    fireEvent.press(getByTestId('make-loop-myself'));
    expect(getByTestId('make-loop-review')).toBeTruthy();
  });
});
