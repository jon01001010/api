import {
  AskModelChainEngine,
  AskModelsEngine,
  type ManyModelsDeps,
} from '../AskModelsEngine';
import {REFUSED_HANDOFF, STOPPED_HANDOFFS} from '../AskOtherModelEngine';
import {
  allowNothingMore,
  markPrivateRead,
  REFUSED_NOTHING_MORE,
  resetChatGuards,
} from '../../agent/chatGuard';
import {
  handoffsIn,
  MAX_HANDOFFS,
  noteHandoff,
  resetHandoffs,
  SUB_SYSTEM_PROMPT,
  type SubModel,
} from '../../agent/subAgent';
import {
  capFor,
  companiesLine,
  continuationTask,
  differences,
  pickModels,
} from '../../agent/manyModels';
import {RemoteHttpError} from '../../../utils/errors';
import type {FileProposal} from '../fileApprovalGate';

const pc: SubModel = {
  id: 'home-pc/qwen',
  name: 'qwen',
  place: 'home_pc',
  where: 'on your PC (Home PC)',
  modelId: 'pc/qwen',
  serverId: 'pc',
  remoteModelId: 'qwen',
};
const claude: SubModel = {
  id: 'claude/sonnet',
  name: 'sonnet',
  place: 'cloud',
  where: 'sent to Claude with your key',
  provider: 'Claude',
  modelId: 'c/sonnet',
  serverId: 'c',
  remoteModelId: 'sonnet',
};
const openai: SubModel = {
  id: 'openai/gpt',
  name: 'gpt',
  place: 'cloud',
  where: 'sent to OpenAI with your key',
  provider: 'OpenAI',
  modelId: 'o/gpt',
  serverId: 'o',
  remoteModelId: 'gpt',
};
const deepseek: SubModel = {
  id: 'deepseek/chat',
  name: 'deepseek-chat',
  place: 'cloud',
  where: 'sent to DeepSeek with your key',
  provider: 'DeepSeek',
  modelId: 'd/chat',
  serverId: 'd',
  remoteModelId: 'chat',
};
const ALL = [pc, claude, openai, deepseek];

type Behaviour =
  | {answer: string; tokens?: number; partial?: string}
  | {error: unknown; partial?: string}
  | {hang: true; partial?: string}
  | {result: Record<string, unknown>};

/** A fake engine per model: each answers, fails or hangs as told. */
function setup(
  behave: Record<string, Behaviour>,
  more: Partial<ManyModelsDeps> & {
    answers?: boolean[];
    choose?: ManyModelsDeps['choose'];
  } = {},
) {
  const asked: FileProposal[] = [];
  const logged: any[] = [];
  const sent: {model: string; params: any}[] = [];
  const started: string[] = [];
  const answers = more.answers ?? [];
  const engineFor = jest.fn(async (model: SubModel) => ({
    completion: jest.fn(async (params: any, onData?: (d: any) => void) => {
      started.push(model.id);
      sent.push({model: model.id, params});
      const b = behave[model.id] ?? {answer: `answer from ${model.name}`};
      if ('partial' in b && b.partial) {
        onData?.({token: b.partial, content: b.partial});
      }
      if ('hang' in b) {
        return new Promise<never>(() => {});
      }
      if ('error' in b) {
        throw b.error;
      }
      if ('result' in b) {
        return b.result;
      }
      return {
        content: b.answer,
        text: b.answer,
        tokens_evaluated: b.tokens ?? 30,
        tokens_predicted: 10,
      };
    }),
    stopCompletion: jest.fn(async () => {}),
  }));
  const deps: ManyModelsDeps = {
    models: () => ALL,
    engineFor: engineFor as any,
    ask: jest.fn(async (p: FileProposal) => {
      asked.push(p);
      return answers.length ? answers.shift()! : true;
    }),
    choose: jest.fn(async (p: FileProposal) => {
      asked.push(p);
      return (p.targets ?? []).map(t => t.id);
    }),
    log: e => logged.push(e),
    now: () => 1000,
    timeLimitMs: 30,
    ...more,
  };
  return {
    and: new AskModelsEngine(deps),
    or: new AskModelChainEngine(deps),
    deps,
    asked,
    logged,
    sent,
    started,
    engineFor,
  };
}
const ctx = (chat = 'chat-1') => ({
  signal: new AbortController().signal,
  chat,
});

beforeEach(() => {
  resetChatGuards();
  resetHandoffs();
});

describe('manyModels helpers', () => {
  it('only listed ids, at least two, at most four, each once', () => {
    expect(pickModels(ALL, ['claude/sonnet', 'nope'])).toMatchObject({
      ok: false,
    });
    expect(pickModels(ALL, ['claude/sonnet', 'claude/sonnet'])).toMatchObject({
      ok: false,
    });
    expect(pickModels(ALL, 'claude/sonnet')).toMatchObject({ok: false});
    expect(pickModels(ALL, ['claude/sonnet', 'home-pc/qwen'])).toEqual({
      ok: true,
      models: [claude, pc],
    });
  });

  it('"the same text goes to N companies"', () => {
    expect(companiesLine([pc, claude, openai])).toBe(
      'The same text goes to 2 companies: Claude, OpenAI.',
    );
    expect(companiesLine([pc])).toBeNull();
  });

  it('flags plain differences, honestly roughly', () => {
    expect(
      differences([
        {model: 'a', answer: 'Yes, it is safe.'},
        {model: 'b', answer: 'No, it is not.'},
      ]),
    ).toEqual(['a and b: one says yes, the other no.']);
    expect(
      differences([
        {model: 'a', answer: 'Paris'},
        {model: 'b', answer: 'paris.'},
      ]),
    ).toEqual([]);
    const long = (n: number) =>
      `The total over the whole year comes to ${n} euros after all the costs are counted and checked twice by the team.`;
    expect(
      differences([
        {model: 'a', answer: long(42)},
        {model: 'b', answer: long(41)},
      ]),
    ).toEqual(['a and b: different numbers.']);
  });

  it('the next model gets the task and the end of the work so far', () => {
    const text = continuationTask('Task.', 'x'.repeat(5000), claude);
    expect(text.startsWith('Task.\n\nAnother model (sonnet)')).toBe(true);
    expect(text).toContain('[… 1000 characters before]');
    expect(continuationTask('Task.', '', claude)).toBe('Task.');
  });
});

describe('ask_models ("and")', () => {
  it('one question lists every target, the text and the companies; all run at once, labelled and untrusted', async () => {
    const t = setup({
      'claude/sonnet': {answer: 'The answer is 4.'},
      'openai/gpt': {answer: 'The answer is 4.'},
    });
    const result = await t.and.execute(
      {
        models: ['home-pc/qwen', 'claude/sonnet', 'openai/gpt'],
        task: '2+2?',
        reason: 'compare',
      },
      ctx(),
    );
    expect(t.asked).toHaveLength(1);
    const q = t.asked[0];
    expect(q.action).toBe('ask_models');
    expect(q.content).toBe('2+2?');
    expect(q.targets?.map(x => x.id)).toEqual([
      'home-pc/qwen',
      'claude/sonnet',
      'openai/gpt',
    ]);
    expect(q.targets?.[1].label).toBe('sonnet: sent to Claude with your key');
    expect(q.filename).toContain(
      'The same text goes to 2 companies: Claude, OpenAI.',
    );
    expect(q.alert).toBeUndefined();
    expect(t.started.sort()).toEqual([
      'claude/sonnet',
      'home-pc/qwen',
      'openai/gpt',
    ]);
    // No tools for any of them: the helper prompt and the task only.
    for (const s of t.sent) {
      expect(s.params.messages).toEqual([
        {role: 'system', content: SUB_SYSTEM_PROMPT},
        {role: 'user', content: '2+2?'},
      ]);
      expect(s.params.tools).toBeUndefined();
    }
    expect(result.type).toBe('model_answers');
    if (result.type !== 'model_answers') return;
    expect(result.answers.map(a => a.model)).toEqual(['qwen', 'sonnet', 'gpt']);
    expect(
      result.summary.match(/BEGIN ANSWER FROM ANOTHER MODEL/g),
    ).toHaveLength(3);
    expect(result.summary).toContain('Answer from sonnet.');
    expect(result.lines.join(' ')).toMatch(
      /qwen and sonnet: different short answers|different/,
    );
    expect(t.logged.map(e => e.outcome)).toEqual([
      'answered',
      'answered',
      'answered',
    ]);
    expect(JSON.stringify(t.logged)).not.toContain('2+2?');
    expect(handoffsIn('chat-1').count).toBe(3);
  });

  it('only the ticked targets get the text; unticked ones are logged', async () => {
    const t = setup(
      {},
      {choose: jest.fn(async () => ['openai/gpt', 'not-in-question'])},
    );
    const result = await t.and.execute(
      {models: ['claude/sonnet', 'openai/gpt'], task: 'Hi'},
      ctx(),
    );
    expect(t.started).toEqual(['openai/gpt']);
    expect(t.logged.map(e => [e.model, e.outcome])).toEqual([
      ['sonnet', 'unticked'],
      ['gpt', 'answered'],
    ]);
    expect(result.type === 'model_answers' && result.lines[0]).toBe(
      'Not asked (unticked by you): sonnet.',
    );
  });

  it('no, or nothing ticked: nothing is sent', async () => {
    const t = setup({}, {choose: jest.fn(async () => null)});
    expect(
      await t.and.execute(
        {models: ['claude/sonnet', 'openai/gpt'], task: 'Hi'},
        ctx(),
      ),
    ).toEqual({type: 'text', summary: REFUSED_HANDOFF});
    expect(t.engineFor).not.toHaveBeenCalled();
  });

  it('a red line after a private read when a target is cloud', async () => {
    markPrivateRead('chat-1', 'clipboard_read');
    const t = setup({});
    await t.and.execute(
      {models: ['home-pc/qwen', 'claude/sonnet'], task: 'Hi'},
      ctx(),
    );
    expect(t.asked[0].alert).toMatch(
      /read private data \(clipboard_read\)[\s\S]*Claude/,
    );
  });

  it('"don\'t allow anything more" refuses before asking', async () => {
    allowNothingMore('chat-1');
    const t = setup({});
    expect(
      await t.and.execute(
        {models: ['claude/sonnet', 'openai/gpt'], task: 'Hi'},
        ctx(),
      ),
    ).toEqual({type: 'text', summary: REFUSED_NOTHING_MORE});
    expect(t.asked).toHaveLength(0);
  });

  it('each model counts toward the caps: past them, Continue / Stop first', async () => {
    for (let i = 0; i < MAX_HANDOFFS - 1; i++) noteHandoff('chat-1', 10, 10);
    expect(capFor('chat-1', 2)).toMatch(/limit is 5/);
    const t = setup({}, {answers: [false]});
    expect(
      await t.and.execute(
        {models: ['claude/sonnet', 'openai/gpt'], task: 'Hi'},
        ctx(),
      ),
    ).toEqual({type: 'text', summary: STOPPED_HANDOFFS});
    expect(t.asked[0].action).toBe('handoff_cap');
    expect(t.engineFor).not.toHaveBeenCalled();
  });

  it('one failing or slow model does not lose the others', async () => {
    const t = setup({
      'claude/sonnet': {hang: true},
      'openai/gpt': {error: new RemoteHttpError('Server error: 500', 500)},
    });
    const result = await t.and.execute(
      {models: ['home-pc/qwen', 'claude/sonnet', 'openai/gpt'], task: 'Hi'},
      ctx(),
    );
    if (result.type !== 'model_answers') throw new Error(result.type);
    expect(result.answers.map(a => a.problem)).toEqual([
      undefined,
      expect.stringMatching(/did not answer within/),
      expect.stringMatching(/500/),
    ]);
    expect(t.logged.map(e => e.outcome)).toEqual([
      'answered',
      'timed_out',
      'failed',
    ]);
  });
});

describe('ask_model_chain ("or")', () => {
  const chainArgs = {
    models: ['claude/sonnet', 'openai/gpt', 'home-pc/qwen'],
    task: 'Write it.',
  };

  it('the question shows the whole chain and the cap up front', async () => {
    const t = setup({});
    await t.or.execute(chainArgs, ctx());
    expect(t.asked[0].action).toBe('ask_model_chain');
    expect(t.asked[0].targets?.map(x => x.id)).toEqual(chainArgs.models);
    expect(t.asked[0].filename).toMatch(/Cap: at most 3 models/);
    expect(t.started).toEqual(['claude/sonnet']);
  });

  it.each([
    [
      'quota',
      new RemoteHttpError(
        'Server error: 429 — You exceeded your current quota',
        429,
      ),
      'quota or credits used up',
    ],
    [
      'credits',
      new Error('Claude API error 400: Your credit balance is too low'),
      'quota or credits used up',
    ],
    [
      'rate limit',
      new Error('Anthropic rate limit reached. Wait a moment and try again.'),
      'rate limit',
    ],
    [
      'context',
      new RemoteHttpError(
        "Server error: 400 — This model's maximum context length is 8192 tokens",
        400,
      ),
      'the text is too long for it',
    ],
    ['server', new RemoteHttpError('Server error: 503', 503), 'server error'],
  ])('%s: moves on, with a visible line', async (_name, error, why) => {
    const t = setup({'claude/sonnet': {error, partial: 'Half of it'}});
    const result = await t.or.execute(chainArgs, ctx());
    if (result.type !== 'model_answers') throw new Error(result.type);
    expect(result.lines).toEqual([
      `sonnet ran out (${why}): continuing with gpt`,
    ]);
    expect(result.answers).toEqual([
      {
        model: 'gpt',
        where: 'sent to OpenAI with your key',
        answer: 'answer from gpt',
      },
    ]);
    expect(t.started).toEqual(['claude/sonnet', 'openai/gpt']);
    // The next model gets the task and the work so far.
    expect(t.sent[1].params.messages[1].content).toMatch(
      /^Write it\.\n\nAnother model \(sonnet\)[\s\S]*Half of it/,
    );
    expect(t.logged.map(e => e.outcome)).toEqual(['ran_out', 'answered']);
    expect(handoffsIn('chat-1').count).toBe(2);
  });

  it('timeout: moves on', async () => {
    const t = setup({'claude/sonnet': {hang: true, partial: 'Started'}});
    const result = await t.or.execute(chainArgs, ctx());
    if (result.type !== 'model_answers') throw new Error(result.type);
    expect(result.lines[0]).toBe(
      'sonnet ran out (no answer in time): continuing with gpt',
    );
  });

  it('a full local context: moves on', async () => {
    const t = setup({
      'claude/sonnet': {result: {content: 'Some', context_full: true}},
    });
    const result = await t.or.execute(chainArgs, ctx());
    if (result.type !== 'model_answers') throw new Error(result.type);
    expect(result.lines[0]).toMatch(/too long for it/);
  });

  it('a rejected key (401) stops and is reported; nothing else is tried', async () => {
    const t = setup({
      'claude/sonnet': {
        error: new Error(
          'Anthropic rejected the API key (401). Check it in the server settings.',
        ),
      },
    });
    const result = await t.or.execute(chainArgs, ctx());
    expect(t.started).toEqual(['claude/sonnet']);
    if (result.type !== 'model_answers') throw new Error(result.type);
    expect(result.lines[0]).toMatch(
      /sonnet failed \(Anthropic rejected the API key[\s\S]*chain stops here/,
    );
    expect(result.summary).toMatch(/nothing else was tried/);
    expect(t.logged.map(e => e.outcome)).toEqual(['failed']);
  });

  it('a refusal stops; it never hops', async () => {
    const t = setup({
      'claude/sonnet': {answer: 'Claude declined to answer this request.'},
    });
    const result = await t.or.execute(chainArgs, ctx());
    expect(t.started).toEqual(['claude/sonnet']);
    if (result.type !== 'model_answers') throw new Error(result.type);
    expect(result.lines[0]).toMatch(/refused: the chain stops/);
  });

  it('every model ran out: says so', async () => {
    const quota = new RemoteHttpError('Server error: 429 — quota', 429);
    const t = setup({
      'claude/sonnet': {error: quota},
      'openai/gpt': {error: quota, partial: 'Partial'},
      'home-pc/qwen': {error: new Error('Your PC could not be reached')},
    });
    const result = await t.or.execute(chainArgs, ctx());
    if (result.type !== 'model_answers') throw new Error(result.type);
    expect(result.lines).toEqual([
      'sonnet ran out (quota or credits used up): continuing with gpt',
      'gpt ran out (quota or credits used up): continuing with qwen',
      'qwen ran out (could not be reached).',
    ]);
    expect(result.summary).toMatch(/All 3 models in the chain ran out/);
    expect(result.answers[0]).toMatchObject({model: 'qwen', answer: 'Partial'});
  });

  it('after a private read, moving on to a different cloud company asks again', async () => {
    markPrivateRead('chat-1', 'outside_files');
    const t = setup(
      {
        'claude/sonnet': {
          error: new RemoteHttpError('Server error: 429 — quota', 429),
        },
      },
      {answers: [true, false]},
    );
    const result = await t.or.execute(chainArgs, ctx());
    expect(t.asked.map(a => a.action)).toEqual([
      'ask_model_chain',
      'ask_other_model',
    ]);
    expect(t.asked[1].alert).toMatch(
      /private data \(outside_files\)[\s\S]*OpenAI/,
    );
    expect(t.asked[1].content).toContain('Write it.');
    expect(t.started).toEqual(['claude/sonnet']);
    expect(result.summary).toMatch(/said no to sending this to gpt/);
    expect(t.logged.map(e => e.outcome)).toEqual(['ran_out', 'refused']);
  });

  it('no re-ask for the same company or a model that is not cloud', async () => {
    markPrivateRead('chat-1', 'outside_files');
    const t = setup({'claude/sonnet': {error: new RemoteHttpError('x', 503)}});
    await t.or.execute(
      {models: ['claude/sonnet', 'home-pc/qwen'], task: 'T'},
      ctx(),
    );
    expect(t.asked.map(a => a.action)).toEqual(['ask_model_chain']);
    expect(t.started).toEqual(['claude/sonnet', 'home-pc/qwen']);
  });

  it('each model counts toward the caps: Stop ends the chain', async () => {
    for (let i = 0; i < MAX_HANDOFFS - 1; i++) noteHandoff('chat-1', 10, 10);
    const t = setup(
      {'claude/sonnet': {error: new RemoteHttpError('x', 503)}},
      {answers: [true, false]},
    );
    const result = await t.or.execute(chainArgs, ctx());
    expect(t.asked.map(a => a.action)).toEqual([
      'ask_model_chain',
      'handoff_cap',
    ]);
    expect(t.started).toEqual(['claude/sonnet']);
    expect(result.summary).toContain(STOPPED_HANDOFFS);
  });

  it('"don\'t allow anything more" answered meanwhile stops the chain', async () => {
    const t = setup({'claude/sonnet': {error: new RemoteHttpError('x', 503)}});
    (t.deps.ask as jest.Mock).mockImplementationOnce(
      async (p: FileProposal) => {
        t.asked.push(p);
        allowNothingMore('chat-1');
        return true;
      },
    );
    const result = await t.or.execute(chainArgs, ctx());
    expect(t.started).toEqual(['claude/sonnet']);
    expect(result.summary).toContain(REFUSED_NOTHING_MORE);
  });
});
