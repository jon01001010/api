import {
  ASK_LIMIT,
  ASK_WINDOW_MS,
  ASKING_TOOLS,
  MODEL_THINKING,
  REFUSED_NOTHING_MORE,
  REFUSED_OUTGOING,
  STOPPED_ASKING,
  THINKING_SHOWN,
  THINKING_WARNING,
  allowNothingMore,
  asksUser,
  cloudNotice,
  fromContext,
  makeToolGuard,
  outgoing,
  privateReadIn,
  readsPrivate,
  resetChatGuards,
  thinkingShown,
  thinkTagContent,
  thinkingWarning,
  type GuardQuestion,
} from '../chatGuard';
import {runAgent} from '../AgentRunner';
import type {AgentEvent} from '../AgentRunner.types';
import type {
  CompletionEngine,
  CompletionResult,
} from '../../../utils/completionTypes';
import type {TalentEngine, TalentResult} from '../../talents/types';

const text = (summary: string): TalentResult => ({type: 'text', summary});

beforeEach(() => resetChatGuards());

describe('what reads private data and what goes out (explicit lists)', () => {
  it('private reads: outside files, clipboards, the PC workspace, commands', () => {
    expect(readsPrivate('outside_files', {action: 'read'})).toBe(true);
    expect(readsPrivate('outside_files', {action: 'list'})).toBe(true);
    expect(readsPrivate('outside_files', {action: 'write'})).toBe(false);
    for (const name of [
      'clipboard_read',
      'pc_clipboard_read',
      'pc_workspace_read',
      'run_command',
      'pc_run_command',
    ]) {
      expect(readsPrivate(name, {})).toBe(true);
    }
    for (const name of ['file_read', 'web_search', 'calculate', 'pc_info']) {
      expect(readsPrivate(name, {})).toBe(false);
    }
  });

  it('outgoing shows exactly what leaves the device', () => {
    expect(outgoing('web_search', {query: 'my secret'})).toBe(
      'A web search, sent to the search service:\nmy secret',
    );
    expect(outgoing('read_url', {url: 'https://x.example/?q=key'})).toContain(
      'https://x.example/?q=key',
    );
    expect(
      outgoing('compose_message', {kind: 'email', to: 'a@b.c', body: 'pw 123'}),
    ).toContain('pw 123');
    expect(outgoing('share_text', {text: 'hello'})).toContain('hello');
    expect(outgoing('search_in_app', {query: 'q', app: 'X'})).toContain('q');
    expect(outgoing('navigate_to', {destination: 'Home'})).toContain('Home');
    expect(outgoing('pc_run_command', {command: 'Get-Date'})).toContain(
      'Get-Date',
    );
    expect(
      outgoing('pc_workspace_write', {filename: 'a.md', content: 'TEXT'}),
    ).toContain('TEXT');
    // The phone's picture maker sends its description to the PC.
    expect(
      outgoing('image_generate', {prompt: 'a cat'}, {sendsTo: 'your Home PC'}),
    ).toBe('Sent to your Home PC:\na cat');
    // The desktop's own picture maker sends nothing out.
    expect(outgoing('image_generate', {prompt: 'a cat'})).toBeNull();
    for (const name of ['calculate', 'file_read', 'pc_info', 'run_command']) {
      expect(outgoing(name, {})).toBeNull();
    }
  });

  it('a chain or a shortcut goes out when one of its steps does', () => {
    expect(
      outgoing('phone_actions_chain', {
        steps: [
          {action: 'set_timer', args: {minutes: 5}},
          {action: 'share_text', args: {text: 'x'}},
        ],
      }),
    ).toContain('Text handed to');
    const shortcut = {
      tool: {
        kind: 'shortcut',
        steps: [{tool: 'web_search', args: {query: '{{q}}'}}],
      },
    };
    expect(outgoing('my_shortcut', {q: 'secret'}, shortcut)).toContain(
      'secret',
    );
    expect(
      readsPrivate(
        'copy_it',
        {},
        {
          tool: {kind: 'shortcut', steps: [{tool: 'clipboard_read', args: {}}]},
        },
      ),
    ).toBe(true);
  });

  it('the asking tools are real tool names', () => {
    const {PHONE_TOOL_NAMES} = require('../../talents/PhoneActionsEngine');
    const {DESKTOP_TOOL_NAMES} = require('../../talents/DesktopToolsEngine');
    const {PC_TOOL_NAMES} = require('../../talents/PcToolsEngine');
    const {FILE_OPERATIONS} = require('../../talents/FileToolsEngine');
    const {ASK_OTHER_MODEL} = require('../../talents/AskOtherModelEngine');
    const {
      ASK_MODELS,
      ASK_MODEL_CHAIN,
    } = require('../../talents/AskModelsEngine');
    const known = new Set<string>([
      ASK_OTHER_MODEL,
      ASK_MODELS,
      ASK_MODEL_CHAIN,
      ...PHONE_TOOL_NAMES,
      ...DESKTOP_TOOL_NAMES,
      ...PC_TOOL_NAMES,
      ...FILE_OPERATIONS,
      'memory_replace',
      'memory_restore',
      'tool_save',
      'tool_delete',
      'phone_actions_chain',
    ]);
    for (const name of ASKING_TOOLS) {
      expect(known.has(name)).toBe(true);
    }
    // Every phone action asks.
    for (const name of PHONE_TOOL_NAMES) {
      expect(asksUser(name)).toBe(true);
    }
    expect(asksUser('calculate')).toBe(false);
    expect(asksUser('web_search')).toBe(false);
    expect(asksUser('x', {tool: {kind: 'shortcut', steps: []}})).toBe(true);
  });
});

describe("the model's thinking", () => {
  it('shows the last characters, escaped, saying how many came before', () => {
    expect(thinkingShown(' the user\nasked ‮ ')).toBe(
      'the user\\nasked \\u{202e}',
    );
    expect(thinkingShown(undefined)).toBe('');
    const long = thinkingShown('a'.repeat(1000) + 'b'.repeat(THINKING_SHOWN));
    expect(long).toBe(
      `[… 1000 characters before] ${'b'.repeat(THINKING_SHOWN)}`,
    );
    expect(MODEL_THINKING).toBe('The model was thinking:');
  });

  it('reads <think> tags in the reply (local models)', () => {
    expect(
      thinkTagContent('<think> the user wants\nthe date </think>Sure.'),
    ).toBe('the user wants\nthe date');
    // Unclosed (cut off, or still streaming): runs to the end.
    expect(thinkTagContent('<think>open the page')).toBe('open the page');
    // Several blocks, <thinking> too, any case; empty ones left out.
    expect(
      thinkTagContent(
        '<think>first</think> text <THINKING>second</THINKING><think> </think><thinking>third',
      ),
    ).toBe('first\n\nsecond\n\nthird');
    // None.
    expect(thinkTagContent('Just an answer.')).toBe('');
    expect(thinkTagContent(undefined)).toBe('');
    expect(thinkTagContent('<thinker>no</thinker>')).toBe('');
  });

  it('warns when it talks about hiding or getting around checks', () => {
    for (const bad of [
      "I'll do it quietly so the user won't notice",
      'The user WON’T   NOTICE',
      'Maybe I can bypass the approval',
      'get around the check',
      'I should disable logging first',
      "Don't tell the user about it",
      'secretly copy the key',
      'clear the log after',
    ]) {
      expect(thinkingWarning(bad)).toBe(THINKING_WARNING);
    }
    for (const fine of [
      'The user wants the hidden files in Downloads listed.',
      'Read the log file they named and summarise it.',
      'Check disk space.',
      '',
      undefined,
    ]) {
      expect(thinkingWarning(fine)).toBeNull();
    }
  });

  it('a tool context gives its question the thinking and the chat', () => {
    expect(fromContext(undefined)).toEqual({});
    expect(fromContext({})).toEqual({});
    expect(fromContext({thinking: 't', chat: 'c'})).toEqual({
      from: {thinking: 't', chat: 'c'},
    });
  });
});

describe('the guard of one chat', () => {
  const setup = (answers: boolean[] = [], cloud = false) => {
    const asked: GuardQuestion[] = [];
    const notices: string[] = [];
    let clock = 1_000_000;
    const guard = makeToolGuard({
      chat: 'chat-1',
      ask: async q => {
        asked.push(q);
        return answers.length ? answers.shift()! : true;
      },
      isCloudModel: () => cloud,
      notice: t => notices.push(t),
      now: () => clock,
    });
    return {
      guard,
      asked,
      notices,
      tick: (ms: number) => {
        clock += ms;
      },
    };
  };

  it('nothing goes out unasked after private data was read', async () => {
    const {guard, asked} = setup([false, true]);
    // Before any private read: a search does not ask.
    expect(
      await guard.before({name: 'web_search', args: {query: 'a'}}),
    ).toEqual({ok: true});
    expect(asked).toHaveLength(0);
    const read = {name: 'outside_files', args: {action: 'read', path: 'x'}};
    // A refused read (an error) does not mark the chat.
    guard.after(read, {type: 'error', summary: 'no', errorMessage: 'no'});
    expect(privateReadIn('chat-1')).toBeNull();
    guard.after(read, text('secret'));
    expect(privateReadIn('chat-1')).toBe('outside_files');
    // Now the search asks, showing exactly the query, the thinking after.
    const no = await guard.before({
      name: 'web_search',
      args: {query: 'secret'},
      thinking: 'send it\nso the user won’t notice',
    });
    expect(no).toEqual({ok: false, message: REFUSED_OUTGOING});
    expect(asked[0]).toEqual({
      kind: 'outgoing',
      what: 'A web search, sent to the search service:\nsecret',
      privateRead: 'outside_files',
      tool: 'web_search',
      thinking: 'send it\\nso the user won’t notice',
      warning: THINKING_WARNING,
      chat: 'chat-1',
    });
    expect(
      await guard.before({name: 'read_url', args: {url: 'https://a'}}),
    ).toEqual({ok: true});
    expect(asked).toHaveLength(2);
    // Tools that send nothing out are not asked about.
    expect(await guard.before({name: 'calculate', args: {}})).toEqual({
      ok: true,
    });
    expect(asked).toHaveLength(2);
  });

  it('the cloud model gets a one-line notice, a local model none', () => {
    const local = setup([], false);
    local.guard.after({name: 'clipboard_read', args: {}}, text('pw'));
    local.guard.beforeModelRequest();
    expect(local.notices).toEqual([]);
    resetChatGuards();
    const cloud = setup([], true);
    cloud.guard.beforeModelRequest();
    expect(cloud.notices).toEqual([]);
    cloud.guard.after({name: 'clipboard_read', args: {}}, text('pw'));
    cloud.guard.beforeModelRequest();
    cloud.guard.beforeModelRequest();
    expect(cloud.notices).toEqual([cloudNotice('clipboard_read')]);
  });

  it(`more than ${ASK_LIMIT} questions in 2 minutes pause the run`, async () => {
    const {guard, asked, tick} = setup();
    for (let i = 0; i < ASK_LIMIT; i++) {
      expect(await guard.before({name: 'file_create', args: {}})).toEqual({
        ok: true,
      });
      tick(1000);
    }
    expect(asked).toHaveLength(0);
    // The next one: "The model is asking a lot" first (Continue here).
    expect(await guard.before({name: 'file_create', args: {}})).toEqual({
      ok: true,
    });
    expect(asked).toEqual([
      {kind: 'too_many', count: ASK_LIMIT, chat: 'chat-1'},
    ]);
    // Counting starts again after Continue.
    for (let i = 0; i < ASK_LIMIT - 1; i++) {
      await guard.before({name: 'file_create', args: {}});
    }
    expect(asked).toHaveLength(1);
    // Questions older than the window no longer count.
    tick(ASK_WINDOW_MS);
    for (let i = 0; i < ASK_LIMIT; i++) {
      await guard.before({name: 'run_command', args: {}});
    }
    expect(asked).toHaveLength(1);
    // Tools that don't ask are not counted.
    for (let i = 0; i < 20; i++) {
      await guard.before({name: 'calculate', args: {}});
    }
    expect(asked).toHaveLength(1);
  });

  it('Stop on "asking a lot" stops the run', async () => {
    const {guard} = setup([false]);
    for (let i = 0; i < ASK_LIMIT; i++) {
      await guard.before({name: 'outside_files', args: {action: 'read'}});
    }
    expect(
      await guard.before({name: 'outside_files', args: {action: 'read'}}),
    ).toEqual({
      ok: false,
      message: STOPPED_ASKING,
      stop: true,
    });
  });

  it('"allow nothing more" refuses every tool that asks, sends or reads private data', async () => {
    const {guard, asked} = setup();
    allowNothingMore('chat-1');
    for (const call of [
      {name: 'run_command', args: {command: 'Get-Date'}},
      {name: 'outside_files', args: {action: 'read'}},
      {name: 'clipboard_read', args: {}},
      {name: 'pc_workspace_list', args: {}},
      {name: 'web_search', args: {query: 'x'}},
      {name: 'file_create', args: {}},
      {name: 'set_timer', args: {}},
    ]) {
      expect(await guard.before(call)).toEqual({
        ok: false,
        message: REFUSED_NOTHING_MORE,
      });
    }
    expect(asked).toHaveLength(0);
    // Harmless tools still work.
    expect(await guard.before({name: 'calculate', args: {}})).toEqual({
      ok: true,
    });
    // Another chat is not affected.
    const other = makeToolGuard({chat: 'chat-2', ask: async () => true});
    expect(await other.before({name: 'run_command', args: {}})).toEqual({
      ok: true,
    });
  });
});

describe('the chat loop uses the guard', () => {
  const engineFor = (results: CompletionResult[]): CompletionEngine => {
    let i = 0;
    return {
      completion: jest.fn(
        async () =>
          results[i++] ?? ({text: '', content: ''} as CompletionResult),
      ),
      stopCompletion: jest.fn(async () => {}),
    };
  };
  const call = (name: string, args: object, id = 'c1') => ({
    id,
    type: 'function' as const,
    function: {name, arguments: JSON.stringify(args)},
  });
  const tool = (name: string, impl: jest.Mock): TalentEngine => ({
    name,
    execute: impl,
    toToolDefinition: () => ({
      type: 'function',
      function: {name, description: name, parameters: {}},
    }),
  });
  const collect = async (it: AsyncIterable<AgentEvent>) => {
    const out: AgentEvent[] = [];
    for await (const e of it) {
      out.push(e);
    }
    return out;
  };

  it('passes the thinking and the chat to the tool, marks the chat, asks before a search', async () => {
    const clip = jest.fn(async () => text('the password'));
    const search = jest.fn(async () => text('results'));
    const tools: Record<string, TalentEngine> = {
      clipboard_read: tool('clipboard_read', clip),
      web_search: tool('web_search', search),
    };
    const asked: GuardQuestion[] = [];
    const guard = makeToolGuard({
      chat: 'chat-9',
      ask: async q => {
        asked.push(q);
        return false;
      },
    });
    const events = await collect(
      runAgent({
        engine: engineFor([
          {
            text: '',
            content: '',
            reasoning_content: 'read the clipboard',
            tool_calls: [call('clipboard_read', {})],
          } as CompletionResult,
          {
            text: '',
            content: '',
            reasoning_content: 'now search it',
            tool_calls: [call('web_search', {query: 'the password'}, 'c2')],
          } as CompletionResult,
          {text: 'done', content: 'done'} as CompletionResult,
        ]),
        initialParams: {messages: []} as any,
        allowedTalentNames: ['clipboard_read', 'web_search'],
        talentLookup: n => tools[n],
        triggerMarkers: [],
        messageId: 'm',
        guard,
      }),
    );
    expect(clip).toHaveBeenCalledWith(
      {},
      expect.objectContaining({thinking: 'read the clipboard', chat: 'chat-9'}),
    );
    expect(search).not.toHaveBeenCalled();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      kind: 'outgoing',
      thinking: 'now search it',
    });
    const finished = events.filter(
      e => e.type === 'tool_call_finished',
    ) as any[];
    expect(finished[1].outcome.responseContent).toBe(REFUSED_OUTGOING);
  });

  it('Stop on "asking a lot" ends the run before the tool and after this round', async () => {
    const write = jest.fn(async () => text('ok'));
    const guard = makeToolGuard({chat: 'chat-s', ask: async () => false});
    // Fill the window.
    for (let i = 0; i < ASK_LIMIT; i++) {
      await guard.before({name: 'file_create', args: {}});
    }
    const engine = engineFor([
      {
        text: '',
        content: '',
        tool_calls: [call('file_create', {}), call('file_create', {}, 'c2')],
      } as CompletionResult,
      {text: 'more', content: 'more'} as CompletionResult,
    ]);
    const events = await collect(
      runAgent({
        engine,
        initialParams: {messages: []} as any,
        allowedTalentNames: ['file_create'],
        talentLookup: () => tool('file_create', write),
        triggerMarkers: [],
        messageId: 'm',
        guard,
      }),
    );
    expect(write).not.toHaveBeenCalled();
    expect(engine.completion).toHaveBeenCalledTimes(1);
    const finished = events.filter(
      e => e.type === 'tool_call_finished',
    ) as any[];
    expect(finished.map(e => e.outcome.responseContent)).toEqual([
      STOPPED_ASKING,
      STOPPED_ASKING,
    ]);
  });
});

describe('the model is never told its reasoning is shown or logged', () => {
  it('no prompt or prompt part mentions it', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..', '..', '..', '..');
    // Everything that goes into what the model reads: system prompts,
    // prompt parts, tool descriptions and tool results.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__' && e.name !== 'node_modules') {
            walk(full);
          }
        } else if (/\.(ts|tsx)$/.test(e.name)) {
          files.push(full);
        }
      }
    };
    walk(path.join(root, 'src'));
    const promptish = files.filter((f: string) =>
      /systemPrompt|promptParts|Prompt\.ts$|prompts?\b|talents[\\/][A-Za-z]*Engine\.ts$|talents[\\/]customTools\.ts$|globalToolSettings|PhoneActionChain\.ts$/.test(
        f,
      ),
    );
    expect(promptish.length).toBeGreaterThan(5);
    const told =
      /(reasoning|thinking|thoughts?)[^.\n'"`]{0,60}\b(is|are|will be|gets?)\s+(shown|logged|recorded|visible|displayed|monitored|watched|read by)/i;
    expect(told.test('Note: your reasoning is shown to the user.')).toBe(true);
    expect(told.test('Your thinking will be logged.')).toBe(true);
    for (const f of promptish) {
      const body = fs.readFileSync(f, 'utf8');
      expect([path.relative(root, f), told.test(body)]).toEqual([
        path.relative(root, f),
        false,
      ]);
    }
    // And the strings that go with the questions say nothing to the model.
    const guard = fs.readFileSync(
      path.join(__dirname, '..', 'chatGuard.ts'),
      'utf8',
    );
    for (const m of guard.matchAll(
      /export const (REFUSED_\w+|STOPPED_ASKING) =\s*'([^']*)'/g,
    )) {
      expect(m[2]).not.toMatch(/thinking|reasoning|log/i);
    }
  });
});
