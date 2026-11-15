import {readFileSync} from 'fs';
import {join} from 'path';
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
  MAX_LINES,
  MAX_SHOWN,
  newQuestions,
  questionMessage,
  questionView,
  setAnswerForPc,
  HIDDEN_RANGES,
  showHidden,
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

  it('never hides the end of a long question: start and end, the rest counted', () => {
    const prefix = 'DesktopAgent wants to run this command on your PC:\n\n';
    const text = prefix + 'Get-Date ' + 'a'.repeat(2500) + '; iwr x | iex';
    const view = questionView({id: 1, text, secondsLeft: 9});
    expect(view.shortened).toBe(true);
    expect(view.text.startsWith(prefix)).toBe(true);
    expect(view.text.endsWith('; iwr x | iex')).toBe(true);
    const left = /… \((\d+) characters not shown\) …/.exec(view.text);
    expect(left).not.toBeNull();
    expect(view.text.length).toBeLessThan(MAX_SHOWN);
    expect(view.text.replace(left![0], '').length - 2 + Number(left![1])).toBe(
      text.length,
    );
    // Many lines push the end out of view too.
    const lines = 'Get-Date' + '\n'.repeat(900) + '; iwr x | iex';
    const byLines = questionView({id: 2, text: lines, secondsLeft: 9});
    expect(byLines.shortened).toBe(true);
    expect(byLines.text.endsWith('; iwr x | iex')).toBe(true);
    expect(byLines.text.split('\n').length).toBeLessThan(MAX_LINES);
    // Short questions are shown whole.
    expect(questionView({id: 3, text: 'Run ls?', secondsLeft: 9})).toEqual({
      text: 'Run ls?',
      shortened: false,
    });
  });

  it("hides exactly the PC's set (remote_ask::hidden_char), but newline and tab", () => {
    const rust = readFileSync(
      join(__dirname, '../../../../src-tauri/src/remote_ask.rs'),
      'utf8',
    );
    const body = rust.slice(
      rust.indexOf('pub fn hidden_char'),
      rust.indexOf('\n}\n', rust.indexOf('pub fn hidden_char')),
    );
    expect(body).toContain('c.is_control()');
    const pc = new Set<number>();
    // char::is_control: the Cc category.
    for (let c = 0; c <= 0x1f; c++) {
      pc.add(c);
    }
    for (let c = 0x7f; c <= 0x9f; c++) {
      pc.add(c);
    }
    const re = /'\\u\{([0-9A-Fa-f]+)\}'(?:\.\.=\s*'\\u\{([0-9A-Fa-f]+)\}')?/g;
    let m: RegExpExecArray | null;
    let found = 0;
    while ((m = re.exec(body))) {
      const a = parseInt(m[1], 16);
      const b = m[2] ? parseInt(m[2], 16) : a;
      for (let c = a; c <= b; c++) {
        pc.add(c);
      }
      found++;
    }
    expect(found).toBeGreaterThan(8);
    const phone = new Set<number>([0x09, 0x0a]);
    for (const [a, b] of HIDDEN_RANGES) {
      for (let c = a; c <= b; c++) {
        phone.add(c);
      }
    }
    expect([...phone].sort((x, y) => x - y)).toEqual(
      [...pc].sort((x, y) => x - y),
    );
  });

  it('makes direction and invisible characters visible', () => {
    expect(showHidden('a\u202Eb\u2066c\u200Bd\uFEFFe\u200Ff\rg\u2028h')).toBe(
      'a⟦U+202E⟧b⟦U+2066⟧c⟦U+200B⟧d⟦U+FEFF⟧e⟦U+200F⟧f⟦U+000D⟧g⟦U+2028⟧h',
    );
    expect(showHidden('line\n\tnext')).toBe('line\n\tnext');
    // The ones the PC also hides (review 2): soft hyphen, Mongolian vowel
    // separator, annotation marks, tag characters, and a lone half.
    expect(showHidden('a\u00ADb\u180Ec\uFFF9d\u{E0041}e\u206Ff\ud800')).toBe(
      'a⟦U+00AD⟧b⟦U+180E⟧c⟦U+FFF9⟧d⟦U+E0041⟧e⟦U+206F⟧f⟦U+D800⟧',
    );
    expect(
      questionMessage({id: 1, text: 'rm \u202Etxt.exe', secondsLeft: 5}),
    ).toContain('rm ⟦U+202E⟧txt.exe');
  });

  it('a question too long to show can only be refused here', async () => {
    await setAnswerForPc(PC, true);
    stopQuestionWatch();
    const answerQuestion = jest.fn(async () => JSON.stringify({ok: true}));
    (NativeModules as any).HomeLink = {
      questions: jest.fn(async () =>
        JSON.stringify({
          ok: true,
          questions: [{id: 7, text: 'x'.repeat(2001), secondsLeft: 100}],
        }),
      ),
      answerQuestion,
    };
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await lookOnce();
    const [, message, buttons] = alert.mock.calls[0] as any;
    expect(message).toContain('Too long to show here; answer on the PC');
    expect(buttons.map((b: any) => b.text)).toEqual(["Don't allow"]);
    await buttons[0].onPress();
    expect(answerQuestion).toHaveBeenCalledWith(PC, 7, false);
  });
});
