import {
  LoopGuardEngine,
  addTimings,
  guardThinkingLoops,
  withoutThinking,
} from '../loopGuardEngine';
import {THINKING_BUDGET_MESSAGE} from '../../utils/thinkingBudget';
import type {
  ApiCompletionParams,
  CompletionEngine,
  CompletionResult,
  CompletionStreamData,
} from '../../utils/completionTypes';

const LOOP = 'Wait, I should greet the user back politely now. ';

/** An engine that streams the given chunks; stop ends the stream. */
class FakeEngine implements CompletionEngine {
  calls: ApiCompletionParams[] = [];
  stops = 0;
  private stopped = false;
  constructor(
    private replies: {
      chunks: CompletionStreamData[];
      result: CompletionResult;
    }[],
    private throwOnStop = false,
  ) {}
  async completion(
    params: ApiCompletionParams,
    callback?: (d: CompletionStreamData) => void,
  ): Promise<CompletionResult> {
    this.calls.push(params);
    this.stopped = false;
    const reply = this.replies[this.calls.length - 1];
    for (const chunk of reply.chunks) {
      if (this.stopped) {
        if (this.throwOnStop) {
          throw new Error('aborted');
        }
        return {...reply.result, interrupted: true};
      }
      callback?.(chunk);
    }
    return reply.result;
  }
  async stopCompletion() {
    this.stops++;
    this.stopped = true;
  }
}

const thinking: ApiCompletionParams = {
  messages: [{role: 'user', content: 'hi'}],
  enable_thinking: true,
  reasoning: {enabled: true, budgetTokens: 2048, budgetMessage: 'x'},
  thinking_budget_tokens: 2048,
} as ApiCompletionParams;

const loopChunks = (n: number): CompletionStreamData[] =>
  Array.from({length: n}, (_, i) => ({
    reasoning_content: LOOP.repeat(i + 1),
  }));

describe('LoopGuardEngine', () => {
  it('passes normal replies through unchanged', async () => {
    const result = {text: 'Hello!', content: 'Hello!'};
    const inner = new FakeEngine([
      {
        chunks: [
          {reasoning_content: 'The user greets me.'},
          {content: 'Hello!'},
        ],
        result,
      },
    ]);
    const seen: CompletionStreamData[] = [];
    const out = await new LoopGuardEngine(inner).completion(thinking, d =>
      seen.push(d),
    );
    expect(out).toBe(result);
    expect(inner.calls).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  it('stops a looping thought and asks again with thinking off', async () => {
    const inner = new FakeEngine([
      {chunks: loopChunks(20), result: {text: '', content: ''}},
      {
        chunks: [{content: 'Hi'}, {content: 'Hi there!'}],
        result: {
          text: 'Hi there!',
          content: 'Hi there!',
          timings: {predicted_n: 5, predicted_ms: 100},
        },
      },
    ]);
    const onLoop = jest.fn();
    const seen: CompletionStreamData[] = [];
    const out = await new LoopGuardEngine(inner, onLoop).completion(
      thinking,
      d => seen.push(d),
    );
    expect(onLoop).toHaveBeenCalledTimes(1);
    expect(inner.stops).toBe(1);
    expect(inner.calls).toHaveLength(2);
    const second = inner.calls[1] as any;
    expect(second.enable_thinking).toBe(false);
    expect(second.reasoning).toEqual({enabled: false, effort: undefined});
    expect(second.thinking_budget_tokens).toBeUndefined();
    expect(second.messages).toEqual(thinking.messages);
    expect(out.content).toBe('Hi there!');
    expect(out.reasoning_content).toContain(LOOP.trim());
    expect(out.reasoning_content?.endsWith(THINKING_BUDGET_MESSAGE)).toBe(true);
    // The answer keeps the thought shown above it while it streams.
    const last = seen[seen.length - 1];
    expect(last.content).toBe('Hi there!');
    expect(last.reasoning_content).toBe(out.reasoning_content);
  });

  it('handles a server engine that throws when stopped', async () => {
    const inner = new FakeEngine(
      [
        {chunks: loopChunks(20), result: {text: '', content: ''}},
        {chunks: [{content: 'Hi!'}], result: {text: 'Hi!', content: 'Hi!'}},
      ],
      true,
    );
    const out = await new LoopGuardEngine(inner).completion(thinking);
    expect(out.content).toBe('Hi!');
  });

  it('never asks again after the user pressed Stop', async () => {
    const inner = new FakeEngine([
      {chunks: loopChunks(20), result: {text: '', content: ''}},
    ]);
    const guard = new LoopGuardEngine(inner);
    const run = guard.completion(thinking, () => {});
    await guard.stopCompletion();
    await run;
    expect(inner.calls).toHaveLength(1);
  });

  it('does not watch once the answer has started', async () => {
    const chunks = loopChunks(20).map(c => ({...c, content: 'Hello'}));
    const inner = new FakeEngine([
      {chunks, result: {text: 'Hello', content: 'Hello'}},
    ]);
    await new LoopGuardEngine(inner).completion(thinking);
    expect(inner.calls).toHaveLength(1);
    expect(inner.stops).toBe(0);
  });

  it('does nothing when thinking is off', async () => {
    const inner = new FakeEngine([
      {chunks: loopChunks(20), result: {text: '', content: ''}},
    ]);
    await new LoopGuardEngine(inner).completion({
      ...thinking,
      enable_thinking: false,
    });
    expect(inner.stops).toBe(0);
  });
});

describe('helpers', () => {
  it('withoutThinking leaves the original alone', () => {
    const next = withoutThinking(thinking) as any;
    expect(next.chat_template_kwargs).toEqual({enable_thinking: false});
    expect((thinking as any).thinking_budget_tokens).toBe(2048);
    expect(thinking.reasoning?.enabled).toBe(true);
  });

  it('addTimings adds up tokens and time', () => {
    expect(
      addTimings(
        {predicted_n: 10, predicted_ms: 1000},
        {predicted_n: 10, predicted_ms: 1000},
      ),
    ).toMatchObject({
      predicted_n: 20,
      predicted_ms: 2000,
      predicted_per_second: 10,
    });
    expect(addTimings(undefined, {predicted_n: 1})).toEqual({predicted_n: 1});
  });

  it('guardThinkingLoops skips engines with their own thinking', () => {
    const own = {
      managesThinking: true,
      completion: jest.fn(),
      stopCompletion: jest.fn(),
    } as unknown as CompletionEngine;
    expect(guardThinkingLoops(own)).toBe(own);
    const plain = new FakeEngine([]);
    expect(guardThinkingLoops(plain)).toBeInstanceOf(LoopGuardEngine);
  });
});
