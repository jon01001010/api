// Stand-in for the SDK: streams scripted events, then a final message.
const mockStream = jest.fn();
const mockRetrieve = jest.fn();
const mockClientOptions: any[] = [];
jest.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
    constructor(status?: number, message = 'api error') {
      super(message);
      this.status = status;
    }
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    static RateLimitError = RateLimitError;
    options: any;
    constructor(options: any) {
      this.options = options;
      mockClientOptions.push(options);
    }
    beta = {messages: {stream: mockStream}};
    models = {retrieve: mockRetrieve};
  }
  return {__esModule: true, default: Anthropic};
});

import Anthropic from '@anthropic-ai/sdk';
import {ClaudeCompletionEngine} from '../engine';
import {xhrFetch} from '../xhrFetch';

const endpoint = {
  url: 'https://api.anthropic.com',
  remoteModelId: 'claude-opus-5-5',
  apiKey: 'sk-test',
  serverType: 'Claude' as const,
};

function script(events: any[], final: any) {
  mockStream.mockImplementationOnce(() => ({
    async *[Symbol.asyncIterator]() {
      for (const e of events) {
        yield e;
      }
    },
    finalMessage: () => Promise.resolve(final),
  }));
}

describe('ClaudeCompletionEngine', () => {
  beforeEach(() => {
    mockStream.mockReset();
    mockRetrieve.mockReset().mockResolvedValue({max_tokens: 64000});
  });

  it('streams text and thinking, word by word', async () => {
    script(
      [
        {
          type: 'content_block_start',
          index: 0,
          content_block: {type: 'thinking'},
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {type: 'thinking_delta', thinking: 'Hmm. '},
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: {type: 'text_delta', text: 'Hello'},
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: {type: 'text_delta', text: ' there'},
        },
      ],
      {
        content: [
          {type: 'thinking', thinking: 'Hmm. ', signature: 's'},
          {type: 'text', text: 'Hello there'},
        ],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 90,
        },
      },
    );
    const engine = new ClaudeCompletionEngine(endpoint);
    const seen: any[] = [];
    const result = await engine.completion(
      {messages: [{role: 'user', content: 'Hi'}]} as any,
      d => seen.push(d),
    );
    expect(seen.map(s => s.token)).toEqual(['Hmm. ', 'Hello', ' there']);
    expect(seen[2].content).toBe('Hello there');
    expect(result).toMatchObject({
      content: 'Hello there',
      reasoning_content: 'Hmm. ',
      tokens_predicted: 5,
      tokens_evaluated: 100,
      stopped_eos: true,
    });
    const [request, options] = mockStream.mock.calls[0];
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.max_tokens).toBe(32000);
    expect(request.betas).toContain('server-side-fallback-2026-07-01');
    expect(options.signal).toBeDefined();
    // The SDK gets the key and the XHR streaming fetch.
    expect(mockClientOptions.at(-1)).toMatchObject({
      apiKey: 'sk-test',
      fetch: xhrFetch,
    });
  });

  it('returns tool calls and replays Claude’s own turn next time', async () => {
    const toolTurn = [
      {type: 'thinking', thinking: '', signature: 'sig'},
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'weather',
        input: {city: 'Paris'},
      },
    ];
    script(
      [
        {
          type: 'content_block_start',
          index: 1,
          content_block: {type: 'tool_use', id: 'toolu_1', name: 'weather'},
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: {type: 'input_json_delta', partial_json: '{"city":'},
        },
      ],
      {content: toolTurn, stop_reason: 'tool_use', usage: {}},
    );
    const engine = new ClaudeCompletionEngine(endpoint);
    const seen: any[] = [];
    const first = await engine.completion(
      {messages: [{role: 'user', content: 'Weather?'}]} as any,
      d => seen.push(d),
    );
    expect(seen[0].tool_calls[0]).toMatchObject({id: 'toolu_1'});
    expect(first.tool_calls).toEqual([
      {
        type: 'function',
        id: 'toolu_1',
        function: {name: 'weather', arguments: '{"city":"Paris"}'},
      },
    ]);

    script([], {
      content: [{type: 'text', text: 'Sunny'}],
      stop_reason: 'end_turn',
      usage: {},
    });
    await engine.completion({
      messages: [
        {role: 'user', content: 'Weather?'},
        {role: 'assistant', content: '', tool_calls: first.tool_calls},
        {role: 'tool', tool_call_id: 'toolu_1', content: 'Sunny'},
      ],
    } as any);
    const replay = mockStream.mock.calls[1][0].messages;
    expect(replay[1]).toEqual({role: 'assistant', content: toolTurn});
    // The model's output cap is read once.
    expect(mockRetrieve).toHaveBeenCalledTimes(1);
  });

  it("doesn't run a tool call cut off by the output limit", async () => {
    script([], {
      content: [{type: 'tool_use', id: 't', name: 'x', input: {}}],
      stop_reason: 'max_tokens',
      usage: {},
    });
    const result = await new ClaudeCompletionEngine(endpoint).completion({
      messages: [{role: 'user', content: 'Hi'}],
    } as any);
    expect(result.tool_calls).toBeUndefined();
    expect(result.stopped_limit).toBe(1);
  });

  it('says so when Claude declines', async () => {
    script([], {content: [], stop_reason: 'refusal', usage: {}});
    const result = await new ClaudeCompletionEngine(endpoint).completion({
      messages: [{role: 'user', content: 'Hi'}],
    } as any);
    expect(result.content).toBe('Claude declined to answer this request.');
  });

  it('Stop returns what arrived so far', async () => {
    const engine = new ClaudeCompletionEngine(endpoint);
    mockStream.mockImplementationOnce((_req: any, {signal}: any) => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: {type: 'text_delta', text: 'Part'},
        };
        await engine.stopCompletion();
        if (signal.aborted) {
          throw new Error('aborted');
        }
      },
      finalMessage: () => Promise.reject(new Error('aborted')),
    }));
    const result = await engine.completion({
      messages: [{role: 'user', content: 'Hi'}],
    } as any);
    expect(result).toMatchObject({content: 'Part', interrupted: true});
  });

  it('explains a rejected API key', async () => {
    mockStream.mockImplementationOnce(() => {
      throw new (Anthropic as any).AuthenticationError(
        401,
        'invalid x-api-key',
      );
    });
    await expect(
      new ClaudeCompletionEngine(endpoint).completion({
        messages: [{role: 'user', content: 'Hi'}],
      } as any),
    ).rejects.toThrow('Anthropic rejected the API key');
  });
});
