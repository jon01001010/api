import {
  textKey,
  toClaudeMessages,
  toClaudeToolChoice,
  toClaudeTools,
} from '../convert';

describe('toClaudeMessages', () => {
  it('moves system messages to the system prompt', () => {
    const out = toClaudeMessages(
      [
        {role: 'system', content: 'Be brief.'},
        {role: 'system', content: [{type: 'text', text: 'Memory: likes tea'}]},
        {role: 'user', content: 'Hi'},
      ],
      new Map(),
      true,
    );
    expect(out.system).toBe('Be brief.\n\nMemory: likes tea');
    expect(out.messages).toEqual([
      {role: 'user', content: [{type: 'text', text: 'Hi'}]},
    ]);
  });

  it('turns pictures into image blocks', () => {
    const out = toClaudeMessages(
      [
        {
          role: 'user',
          content: [
            {type: 'image_url', image_url: {url: 'data:image/png;base64,QUJD'}},
            {type: 'image_url', image_url: {url: 'https://x.test/cat.jpg'}},
            {type: 'image_url', image_url: {url: 'file:///local.jpg'}},
            {type: 'text', text: 'What is this?'},
          ],
        },
      ],
      new Map(),
      true,
    );
    expect(out.messages[0].content).toEqual([
      {
        type: 'image',
        source: {type: 'base64', media_type: 'image/png', data: 'QUJD'},
      },
      {type: 'image', source: {type: 'url', url: 'https://x.test/cat.jpg'}},
      {type: 'text', text: 'What is this?'},
    ]);
  });

  it('maps tool calls and puts all tool results in one user message', () => {
    const out = toClaudeMessages(
      [
        {role: 'user', content: 'Weather in Paris and Rome?'},
        {
          role: 'assistant',
          content: 'Checking.',
          tool_calls: [
            {
              id: 't1',
              function: {name: 'weather', arguments: '{"city":"Paris"}'},
            },
            {id: 't2', function: {name: 'weather', arguments: 'not json'}},
          ],
        },
        {role: 'tool', tool_call_id: 't1', content: 'Sunny'},
        {role: 'tool', tool_call_id: 't2', content: ''},
      ],
      new Map(),
      true,
    );
    expect(out.messages[1]).toEqual({
      role: 'assistant',
      content: [
        {type: 'text', text: 'Checking.'},
        {type: 'tool_use', id: 't1', name: 'weather', input: {city: 'Paris'}},
        {type: 'tool_use', id: 't2', name: 'weather', input: {}},
      ],
    });
    expect(out.messages[2]).toEqual({
      role: 'user',
      content: [
        {type: 'tool_result', tool_use_id: 't1', content: 'Sunny'},
        {type: 'tool_result', tool_use_id: 't2', content: '(no output)'},
      ],
    });
  });

  it("replays Claude's own content (with thinking) for remembered turns", () => {
    const raw: any[] = [
      {type: 'thinking', thinking: 'plan', signature: 'sig'},
      {type: 'tool_use', id: 't1', name: 'weather', input: {city: 'Paris'}},
    ];
    const finalRaw: any[] = [
      {type: 'thinking', thinking: '', signature: 's2'},
      {type: 'text', text: 'It is sunny.'},
    ];
    const cache = new Map<string, any[]>([
      ['t1', raw],
      [textKey('It is sunny.'), finalRaw],
    ]);
    const history = [
      {role: 'user', content: 'Weather?'},
      {
        role: 'assistant',
        content: '',
        tool_calls: [{id: 't1', function: {name: 'weather', arguments: '{}'}}],
      },
      {role: 'tool', tool_call_id: 't1', content: 'Sunny'},
      {role: 'assistant', content: 'It is sunny.'},
      {role: 'user', content: 'Thanks'},
    ];
    const kept = toClaudeMessages(history, cache, true);
    expect(kept.messages[1].content).toBe(raw);
    expect(kept.messages[3].content).toBe(finalRaw);

    const stripped = toClaudeMessages(history, cache, false);
    expect(stripped.messages[1].content).toEqual([raw[1]]);
    expect(stripped.messages[3].content).toEqual([finalRaw[1]]);
  });

  it('starts with the user (drops a leading greeting)', () => {
    const out = toClaudeMessages(
      [
        {role: 'assistant', content: 'Hello! How can I help?'},
        {role: 'user', content: 'Hi'},
      ],
      new Map(),
      true,
    );
    expect(out.messages.map(m => m.role)).toEqual(['user']);
  });

  it('merges back-to-back user messages', () => {
    const out = toClaudeMessages(
      [
        {role: 'user', content: 'One'},
        {role: 'user', content: 'Two'},
        {role: 'assistant', content: ''},
      ],
      new Map(),
      true,
    );
    expect(out.messages).toEqual([
      {
        role: 'user',
        content: [
          {type: 'text', text: 'One'},
          {type: 'text', text: 'Two'},
        ],
      },
    ]);
  });
});

describe('tools', () => {
  it('maps function tools', () => {
    expect(
      toClaudeTools([
        {
          type: 'function',
          function: {
            name: 'file_read',
            description: 'Read a file',
            parameters: {
              type: 'object',
              properties: {filename: {type: 'string'}},
              required: ['filename'],
            },
          },
        },
        {type: 'function', function: {name: 'memory_get'}},
        {type: 'other'},
      ]),
    ).toEqual([
      {
        name: 'file_read',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: {filename: {type: 'string'}},
          required: ['filename'],
        },
      },
      {name: 'memory_get', description: '', input_schema: {type: 'object'}},
    ]);
  });

  it('never forces a tool (newer models reject it)', () => {
    expect(toClaudeToolChoice('none')).toEqual({type: 'none'});
    expect(toClaudeToolChoice('auto')).toEqual({type: 'auto'});
    expect(toClaudeToolChoice('required')).toEqual({type: 'auto'});
    expect(
      toClaudeToolChoice({type: 'function', function: {name: 'x'}}),
    ).toEqual({type: 'auto'});
    expect(toClaudeToolChoice(undefined)).toBeUndefined();
  });
});
