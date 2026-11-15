import {isThinkingLoop, makeLoopWatcher} from '../thinkingLoop';

const NORMAL = `The user asks how many apples are left. They start with 12 apples.
They give away a third of them, which is 4 apples, so 8 remain. Then they buy
5 more, making 13. Let me double-check the first step: one third of 12 is 4,
yes. After giving 4 away there are 8. Adding 5 gives 13. Is there any trick in
the wording? The question says "how many are left now", which means after all
the steps. Some people might read "a third" as a third of the final amount, but
the order of events is clear. I should also consider whether eating any apples
was mentioned; it was not. So the final answer is 13 apples. I will explain the
steps briefly: start with 12, give away 4, buy 5, end with 13. Maybe I should
also show the arithmetic as an equation for clarity: 12 - 4 + 5 = 13. That
seems helpful without being too long. Let me write a short friendly answer.`;

const QUOTING = `The user wrote: "what is the capital of France and why".
The capital of France is Paris. The question "what is the capital of France
and why" also asks why. Paris became the capital because of its central place
on the Seine, its history with the Capetian kings, and its growth as a center
of trade. So for "what is the capital of France and why" I answer Paris and
give a few reasons. That covers both parts. Let me keep it to three sentences.`;

describe('isThinkingLoop', () => {
  it('lets normal varied reasoning through', () => {
    expect(isThinkingLoop(NORMAL)).toBe(false);
    expect(isThinkingLoop(NORMAL + '\n' + NORMAL.slice(0, 200))).toBe(false);
  });

  it('lets reasoning that quotes the question a few times through', () => {
    expect(isThinkingLoop(QUOTING)).toBe(false);
  });

  it('ignores short or empty text', () => {
    expect(isThinkingLoop('')).toBe(false);
    expect(isThinkingLoop('Wait. Wait. Wait.')).toBe(false);
  });

  it('catches "wait, I should…" circles with different openers', () => {
    const loop =
      'The user said hi. Wait, I should greet the user back politely. ' +
      'But maybe they want more. Hmm, I should greet the user back politely. ' +
      'Or ask how I can help. But I should greet the user back politely. ';
    expect(isThinkingLoop(loop)).toBe(true);
  });

  it('catches a block repeated back to back', () => {
    const block =
      'Maybe I should answer with a greeting, but first I need to check what they mean by hi ';
    expect(isThinkingLoop('Okay. ' + block.repeat(3))).toBe(true);
  });

  it('catches the same ten words three times among other text', () => {
    const run = 'the user only said hi and nothing else at all';
    const text = [
      `First, ${run}.`,
      'So a short reply is fine, although I could offer help with something.',
      `Then again ${run}, which makes me think about tone.`,
      'A friendly tone would work, and a question back could be nice too.',
      `Still, ${run}, so keep it short.`,
    ].join(' ');
    expect(isThinkingLoop(text)).toBe(true);
  });

  it('catches a short phrase repeated many times', () => {
    expect(isThinkingLoop('Hmm. ' + 'no wait '.repeat(20))).toBe(true);
  });
});

describe('makeLoopWatcher', () => {
  it('checks only after enough new text', () => {
    const watch = makeLoopWatcher(100);
    const loop = 'Wait, I should greet the user back politely now. '.repeat(4);
    expect(watch(loop.slice(0, 50))).toBe(false);
    expect(watch(loop)).toBe(true);
  });

  it('does not recheck the same text', () => {
    const watch = makeLoopWatcher(10);
    expect(watch(NORMAL)).toBe(false);
    expect(watch(NORMAL)).toBe(false);
  });
});
