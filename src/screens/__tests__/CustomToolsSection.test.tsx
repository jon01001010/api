import React from 'react';
import {stepsToText, textToSteps} from '../CustomToolsSection';

describe('shortcut steps as text', () => {
  it('reads one step per line: tool name, then JSON arguments', () => {
    expect(
      textToSteps(
        'set_alarm {"hour": "{{hour}}", "minute": 0}\n\n  open_app {"name": "Spotify"}\ndatetime',
      ),
    ).toEqual([
      {tool: 'set_alarm', args: {hour: '{{hour}}', minute: 0}},
      {tool: 'open_app', args: {name: 'Spotify'}},
      {tool: 'datetime', args: {}},
    ]);
  });

  it('says which line is wrong', () => {
    expect(textToSteps('open_app {name: Spotify}')).toMatch(
      /Line 1: .*not valid JSON/,
    );
    expect(textToSteps('datetime\n!!!')).toMatch(/Line 2/);
  });

  it('writes steps back the same way', () => {
    const steps = [
      {tool: 'open_app', args: {name: 'Spotify'}},
      {tool: 'datetime', args: {}},
    ];
    expect(textToSteps(stepsToText(steps))).toEqual(steps);
  });
});

describe('custom tool editor text boxes', () => {
  const {render, fireEvent, waitFor} = require('../../../jest/test-utils');
  const {CustomToolsSection} = require('../CustomToolsSection');
  const customTools = require('../../services/talents/customTools');

  beforeEach(() => {
    jest.spyOn(customTools, 'listCustomTools').mockResolvedValue([]);
  });
  afterEach(() => jest.restoreAllMocks());

  it('lets each box keep its own text, so the cursor never jumps', async () => {
    const save = jest
      .spyOn(customTools, 'saveCustomTool')
      .mockResolvedValue({name: 'morning'} as any);
    const {getByTestId} = render(
      <CustomToolsSection
        enabledTools={[]}
        disabled={false}
        onToggle={() => {}}
        errorColor="red"
      />,
    );
    fireEvent.press(getByTestId('custom-tool-new'));
    expect(getByTestId('custom-tool-no-timer').props.children).toMatch(
      /Nothing runs on a timer: for an alarm, use Shortcut with set_alarm/,
    );
    // The boxes keep their own text inside the dialog (the screen never
    // writes it back while typing, which arrived late through the dialog
    // layer and moved the cursor); saving still gets every box's text.
    fireEvent.changeText(getByTestId('custom-tool-name'), 'morning');
    fireEvent.changeText(
      getByTestId('custom-tool-description'),
      'when I say good morning',
    );
    fireEvent.changeText(
      getByTestId('custom-tool-instructions'),
      'Open Claude',
    );
    fireEvent.press(getByTestId('custom-tool-save'));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'morning',
          description: 'when I say good morning',
          instructions: 'Open Claude',
        }),
        undefined,
      ),
    );
  });
});
