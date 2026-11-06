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
