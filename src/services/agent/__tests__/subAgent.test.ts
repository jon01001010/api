import {
  answerText,
  capReached,
  costText,
  describeModels,
  handoffParams,
  handoffQuestion,
  HANDOFF_MAX_OUTPUT_TOKENS,
  listModels,
  MAX_ANSWER_CHARS,
  MAX_CHAT_MS,
  MAX_CHAT_TOKENS,
  MAX_HANDOFFS,
  noteHandoff,
  pickModel,
  resetCaps,
  resetHandoffs,
  SUB_SYSTEM_PROMPT,
  totalsText,
  type ModelsInput,
} from '../subAgent';

const servers: ModelsInput['servers'] = [
  {id: 's-claude', name: 'Claude', url: 'https://api.anthropic.com'},
  {id: 's-pc', name: 'My PC', url: 'http://127.0.0.1:41000', homeLinkPc: 'pc1'},
  {id: 's-lan', name: 'Box', url: 'http://192.168.1.5:8080'},
  {id: 's-router', name: 'Router', url: 'http://192.168.1.6:8080'},
];
const input = (more: Partial<ModelsInput> = {}): ModelsInput => ({
  active: {id: 'qwen', name: 'Qwen3 4B', local: true},
  servers,
  remote: [
    {serverId: 's-claude', remoteModelId: 'claude-sonnet'},
    {serverId: 's-pc', remoteModelId: 'C:\\models\\gemma.gguf'},
    {serverId: 's-lan', remoteModelId: 'llama'},
    {serverId: 's-router', remoteModelId: 'other'},
    {serverId: 'gone', remoteModelId: 'x'},
  ],
  needsLoading: id => id === 's-router',
  providerFor: url => (url.includes('anthropic') ? 'Claude' : undefined),
  isLocal: url => url.includes('127.0.0.1') || url.includes('192.168.'),
  ...more,
});

beforeEach(() => resetHandoffs());

describe('the models the main model may name', () => {
  it('lists the loaded model, the Home PC, the home network and cloud models, by short id', () => {
    const models = listModels(input());
    expect(models.map(m => [m.id, m.place, m.where])).toEqual([
      ['current', 'device', 'on this phone'],
      ['claude/claude-sonnet', 'cloud', 'sent to Claude with your key'],
      ['my-pc/gemma.gguf', 'home_pc', 'on your PC (Home PC)'],
      ['box/llama', 'home_network', 'on your home network (Box)'],
    ]);
    // Never a model that needs loading, nor one whose server is gone.
    expect(models.some(m => m.serverId === 's-router')).toBe(false);
  });

  it('the desktop says "on this PC"; no loaded model, no "current"', () => {
    expect(listModels(input({desktop: true}))[0].where).toBe('on this PC');
    expect(
      listModels(input({active: undefined})).some(m => m.id === 'current'),
    ).toBe(false);
  });

  it('a loaded remote model is "current" once, not listed twice', () => {
    const models = listModels(
      input({
        active: {
          id: 's-claude/claude-sonnet',
          name: 'claude-sonnet',
          local: false,
          serverId: 's-claude',
          remoteModelId: 'claude-sonnet',
        },
      }),
    );
    expect(models.filter(m => m.modelId === 's-claude/claude-sonnet')).toEqual([
      expect.objectContaining({id: 'current', place: 'cloud', current: true}),
    ]);
  });

  it('only a listed id counts', () => {
    const models = listModels(input());
    expect(pickModel(models, 'current')?.name).toBe('Qwen3 4B');
    expect(pickModel(models, ' box/llama ')?.serverId).toBe('s-lan');
    for (const bad of [
      'router/other',
      'gpt-5',
      's-claude/claude-sonnet',
      '',
      3,
      null,
    ]) {
      expect(pickModel(models, bad)).toBeNull();
    }
  });

  it('the description lists each by id and plain name', () => {
    const text = describeModels(listModels(input()));
    expect(text).toContain('- current: Qwen3 4B (on this phone)');
    expect(text).toContain(
      '- claude/claude-sonnet: claude-sonnet (cloud, Claude)',
    );
    expect(describeModels([])).toMatch(/No other model is set up/);
  });
});

describe('the question', () => {
  const [local, cloud, pc] = listModels(input());

  it('facts first: model, where, size, cost, what the other model gets', () => {
    const q = handoffQuestion({
      model: cloud,
      task: 'Summarise: abc',
      chat: 'c',
    });
    expect(q.facts.split('\n')[0]).toBe(
      'The model wants to hand a task to claude-sonnet.',
    );
    expect(q.facts).toContain('Where: sent to Claude with your key.');
    expect(q.facts).toContain('This text leaves this device');
    expect(q.facts).toContain('14 characters, about 4 tokens');
    expect(q.facts).toContain('Cost: not known here; Claude bills your key');
    expect(q.facts).toContain('no chat history, memory or files');
    expect(q.text).toBe('Summarise: abc');
    expect(q.alert).toBeUndefined();
    expect(handoffQuestion({model: local, task: 'x'}).facts).toContain(
      'It stays on this device.',
    );
    expect(costText(local, 'x')).toMatch(/nothing/);
    expect(
      costText(cloud, 'x'.repeat(4000), {
        inputPerM: 3,
        outputPerM: 15,
        currency: '$',
      }),
    ).toBe('Cost: about $0.0255 at most for the answer');
  });

  it('after a private read, a cloud target is said in red', () => {
    const q = handoffQuestion({
      model: cloud,
      task: 't',
      privateRead: 'clipboard_read',
    });
    expect(q.alert).toMatch(
      /read private data \(clipboard_read\)[\s\S]*cloud model \(Claude\)/,
    );
    // The PC: said with the facts, not red; this device: not at all.
    const p = handoffQuestion({
      model: pc,
      task: 't',
      privateRead: 'clipboard_read',
    });
    expect(p.alert).toBeUndefined();
    expect(p.facts).toContain('read private data (clipboard_read)');
    expect(
      handoffQuestion({model: local, task: 't', privateRead: 'clipboard_read'})
        .alert,
    ).toBeUndefined();
  });

  it("the model's words come after the facts, capped", () => {
    const q = handoffQuestion({model: local, task: 't', reason: ' faster '});
    expect(q.modelSays).toBe('faster');
    expect(
      handoffQuestion({model: local, task: 't', reason: 'x'.repeat(900)})
        .modelSays,
    ).toHaveLength(600);
  });
});

describe('the run', () => {
  it('only the helper prompt and the task: no tools, output capped', () => {
    const params = handoffParams('Do this');
    expect(params).toEqual({
      messages: [
        {role: 'system', content: SUB_SYSTEM_PROMPT},
        {role: 'user', content: 'Do this'},
      ],
      n_predict: HANDOFF_MAX_OUTPUT_TOKENS,
      temperature: 0.3,
      jinja: true,
      enable_thinking: false,
    });
    expect(params).not.toHaveProperty('tools');
    expect(params).not.toHaveProperty('tool_choice');
    expect(SUB_SYSTEM_PROMPT).toMatch(/no tools/);
  });

  it('the answer: thinking taken out, capped', () => {
    expect(answerText({content: '<think>hm</think> Hi'})).toBe('Hi');
    expect(answerText({text: 'plain'})).toBe('plain');
    const long = answerText({content: 'y'.repeat(MAX_ANSWER_CHARS + 5)});
    expect(long).toMatch(/\[… cut: the answer was \d+ characters\]$/);
  });
});

describe('per-chat caps', () => {
  it('hand-offs, tokens and time each reach a cap; Continue starts again', () => {
    for (let i = 0; i < MAX_HANDOFFS - 1; i++) {
      noteHandoff('a', 10, 10);
    }
    expect(capReached('a')).toBeNull();
    noteHandoff('a', 10, 10);
    expect(capReached('a')).toMatch(/handed 5 tasks/);
    expect(capReached('b')).toBeNull();
    resetCaps('a');
    expect(capReached('a')).toBeNull();
    expect(totalsText('a')).toMatch(/5 hand-offs, about 50 tokens \(0 of 5/);

    noteHandoff('t', MAX_CHAT_TOKENS, 1);
    expect(capReached('t')).toMatch(/tokens/);
    noteHandoff('m', 1, MAX_CHAT_MS);
    expect(capReached('m')).toMatch(/minutes/);
  });
});
