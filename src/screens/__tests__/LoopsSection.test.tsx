import React from 'react';

describe('Loops section', () => {
  const {render, fireEvent, waitFor} = require('../../../jest/test-utils');
  const {LoopsSection} = require('../LoopsSection');
  const loops = require('../../services/loops/loops');
  const notify = require('../../services/loops/loopNotify');

  const NOW = Date.now();
  const running = {
    id: 'l1',
    templateId: 'focus-timer',
    title: 'Focus check-in',
    prompt: 'I am working on my report.',
    every: 'hour',
    nextAt: NOW + 3600_000,
    runs: 2,
    maxRuns: 8,
    endAt: NOW + 86400_000,
    startedAt: NOW - 7200_000,
    paused: true,
    pausedWhy: loops.NO_PROGRESS_WHY,
    log: [{at: NOW, what: 'Paused: no progress for 2 runs'}],
  };

  beforeEach(() => {
    jest.spyOn(loops, 'loadLoops').mockResolvedValue([running]);
    jest.spyOn(notify, 'isLoopNotifyOn').mockResolvedValue(false);
  });
  afterEach(() => jest.restoreAllMocks());

  it('says why a loop paused itself, and shows its battery guard', async () => {
    const {getByTestId, getByText} = render(<LoopsSection />);
    await waitFor(() => getByTestId('loop-why-l1'));
    expect(getByText(/Paused: no progress for 2 runs\. Edit it/)).toBeTruthy();
    expect(
      getByText('Phone: only when charging or battery above 20%'),
    ).toBeTruthy();
  });

  it('edits a running loop: keeps it, saves only on Save', async () => {
    const save = jest
      .spyOn(loops, 'saveLoopEdit')
      .mockResolvedValue({ok: true, loop: running});
    const {getByTestId, queryByTestId} = render(<LoopsSection />);
    await waitFor(() => getByTestId('loop-edit-open-l1'));
    fireEvent.press(getByTestId('loop-edit-open-l1'));
    expect(getByTestId('make-loop-title').props.value).toBe('Focus check-in');
    expect(getByTestId('make-loop-goal').props.value).toBe(
      'I am working on my report.',
    );
    // A ready-made loop has no steps checklist.
    expect(queryByTestId('make-loop-add-step')).toBeNull();
    fireEvent.changeText(getByTestId('make-loop-title'), 'Report focus');
    fireEvent.changeText(getByTestId('make-loop-runs'), '6');
    fireEvent.press(getByTestId('loop-battery-charger'));
    expect(save).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('loop-edit-save'));
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [id, edit] = save.mock.calls[0] as any;
    expect(id).toBe('l1');
    expect(edit).toMatchObject({
      title: 'Report focus',
      prompt: 'I am working on my report.',
      every: 'hour',
      maxRuns: 6,
      battery: {kind: 'charger'},
    });
    expect(edit.plan).toBeUndefined();
    await waitFor(() => expect(queryByTestId('loop-edit-l1')).toBeNull());
  });

  it('a ready-made loop shows a dry run before it starts', async () => {
    const start = jest
      .spyOn(loops, 'startLoop')
      .mockResolvedValue({ok: true, loop: {...running, paused: false}});
    const {getByTestId, getByText} = render(<LoopsSection />);
    await waitFor(() => getByTestId('loop-template-focus-timer'));
    fireEvent.press(getByTestId('loop-template-focus-timer'));
    fireEvent.changeText(getByTestId('loop-blank-task'), 'my thesis');
    fireEvent.press(getByTestId('loop-battery-above50'));
    fireEvent.press(getByTestId('loop-start'));
    await waitFor(() => getByTestId('loop-dry-run'));
    expect(getByTestId('loop-dry-run-message').props.children).toContain(
      'I am working on my thesis.',
    );
    expect(getByText(/^The model only\./)).toBeTruthy();
    expect(getByText(/battery above 50%; otherwise it waits/)).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('loop-dry-run-start'));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect((start.mock.calls[0] as any)[0]).toMatchObject({
      templateId: 'focus-timer',
      values: {task: 'my thesis'},
      battery: {kind: 'above', percent: 50},
    });
  });
});
