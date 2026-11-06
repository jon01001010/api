import {todayLine, timeNote, withTimeNote} from '../currentTime';

describe('current date and time for the model', () => {
  const now = new Date(2026, 10, 6, 9, 5);

  it('says the date in words', () => {
    expect(todayLine(now)).toBe('Today is Friday, 6 November 2026.');
  });

  it('gives the local time with its UTC offset', () => {
    expect(timeNote(now)).toMatch(/^\(Sent at 09:05, UTC[+-]\d\d:\d\d\)$/);
  });

  it('adds the time to the newest user message only', () => {
    const messages = [
      {role: 'system', content: 'sys'},
      {role: 'user', content: 'first'},
      {role: 'assistant', content: 'reply'},
      {role: 'user', content: 'second'},
    ];
    const out = withTimeNote(messages, '(Sent at 09:05, UTC+00:00)');
    expect(out[1].content).toBe('first');
    expect(out[3].content).toBe('second\n\n(Sent at 09:05, UTC+00:00)');
    // The chat itself is left as typed.
    expect(messages[3].content).toBe('second');
  });

  it('adds a text part when the message has a picture', () => {
    const image = {type: 'image_url', image_url: {url: 'file://a.jpg'}};
    const out = withTimeNote(
      [{role: 'user', content: [{type: 'text', text: 'what is this'}, image]}],
      '(note)',
    );
    expect(out[0].content).toEqual([
      {type: 'text', text: 'what is this'},
      image,
      {type: 'text', text: '(note)'},
    ]);
  });

  it('changes nothing when there is no user message', () => {
    const messages = [{role: 'system', content: 'sys'}];
    expect(withTimeNote(messages, '(note)')).toBe(messages);
  });
});
