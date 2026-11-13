import {Alert, NativeModules} from 'react-native';

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

const PC = 'e'.repeat(64);
jest.mock('../../../store', () => ({
  serverStore: {servers: [{id: 's1', homeLinkPc: 'e'.repeat(64)}]},
}));

import {
  answerForPcOn,
  LOOK_AFTER_FAIL_MS,
  LOOK_EVERY_MS,
  lookOnce,
  newQuestions,
  questionMessage,
  setAnswerForPc,
  stopQuestionWatch,
} from '../pcQuestions';

describe('the PC asks, the phone can answer', () => {
  afterEach(() => {
    stopQuestionWatch();
    delete (NativeModules as any).HomeLink;
    jest.restoreAllMocks();
  });

  it('is off until switched on for that PC', async () => {
    expect(await answerForPcOn(PC)).toBe(false);
    const questions = jest.fn();
    (NativeModules as any).HomeLink = {questions};
    // Switched on for no PC: nothing asked, and the watch stops.
    expect(await lookOnce()).toBe(0);
    expect(questions).not.toHaveBeenCalled();
  });

  it("shows the PC's exact words once, and sends yes or no for that question", async () => {
    await setAnswerForPc(PC, true);
    stopQuestionWatch();
    const answerQuestion = jest.fn(async () => JSON.stringify({ok: true}));
    (NativeModules as any).HomeLink = {
      questions: jest.fn(async () =>
        JSON.stringify({
          ok: true,
          questions: [
            {id: 4, text: 'Run this command?\n\nrm x', secondsLeft: 100},
          ],
        }),
      ),
      answerQuestion,
    };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    expect(await lookOnce()).toBe(LOOK_EVERY_MS);
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0] as any;
    expect(title).toBe('Your PC asks');
    expect(message).toContain('Run this command?\n\nrm x');
    expect(buttons.map((b: any) => b.text)).toEqual([
      "Don't allow",
      'Allow once',
    ]);
    await buttons[1].onPress();
    expect(answerQuestion).toHaveBeenCalledWith(PC, 4, true);
    // Not shown again on the next look.
    await lookOnce();
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('looks less often when the PC refuses or is away', async () => {
    await setAnswerForPc(PC, true);
    stopQuestionWatch();
    (NativeModules as any).HomeLink = {
      questions: jest.fn(async () =>
        JSON.stringify({ok: false, error: 'off on the PC'}),
      ),
    };
    expect(await lookOnce()).toBe(LOOK_AFTER_FAIL_MS);
  });

  it('takes only well-formed questions', () => {
    const shown = new Set([`${PC}:1`]);
    expect(
      newQuestions(
        [
          {id: 1, text: 'seen', secondsLeft: 5},
          {id: 2, text: 'new', secondsLeft: 5},
          {id: '3', text: 'bad id'},
          {id: 4},
          null,
        ],
        shown,
        PC,
      ).map(q => q.id),
    ).toEqual([2]);
    expect(newQuestions('nope', shown, PC)).toEqual([]);
    expect(
      questionMessage({id: 1, text: 'x'.repeat(3000), secondsLeft: 0}),
    ).toContain('within 1 s');
  });
});
