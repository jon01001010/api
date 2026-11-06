import {matchWake, words} from '../wakeWord';

describe('matchWake', () => {
  const phrase = 'Hey Agent';

  it.each([
    ['Hey Agent.', ''],
    ['Hey, agent!', ''],
    ['hey agent what time is it', 'what time is it'],
    [
      'Hey Agent, set a timer for five minutes.',
      'set a timer for five minutes.',
    ],
    ['Okay, hey agent. Play music', 'Play music'],
    ['Hey agents', ''],
    ['Hey a gent, open maps', 'open maps'],
    ['Hey, Agent? What is the weather?', 'What is the weather?'],
  ])('wakes on "%s"', (heard, rest) => {
    expect(matchWake(heard, phrase)).toEqual({woke: true, rest});
  });

  it.each([
    'Hey there',
    'The agent said hello',
    'I told my agent hey',
    'Hey',
    '',
    'Okay so then later hey agent',
  ])('stays asleep on "%s"', heard => {
    expect(matchWake(heard, phrase).woke).toBe(false);
  });

  it('works with any phrase', () => {
    expect(matchWake('Computer, lights on', 'Computer')).toEqual({
      woke: true,
      rest: 'lights on',
    });
    expect(matchWake('Hello Pocket Agent', 'hello pocket agent').woke).toBe(
      true,
    );
  });

  it('splits words without punctuation', () => {
    expect(words("Hey, Agent! What's up?")).toEqual([
      'hey',
      'agent',
      "what's",
      'up',
    ]);
  });
});
