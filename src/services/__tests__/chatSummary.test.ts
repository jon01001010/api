import {runInAction} from 'mobx';

import {chatSessionStore, modelStore, uiStore} from '../../store';
import type {MessageType} from '../../utils/types';
import {
  canSummarize,
  findLatestSummary,
  messagesForModel,
  SUMMARY_AUTHOR_ID,
  summarizeCurrentChat,
  summarizedMessageIds,
  summarizeTranscript,
  summarizeWithNotice,
  transcriptOf,
} from '../chatSummary';

const USER = 'user-1';

const text = (id: string, author = USER, extra = {}): MessageType.Text =>
  ({
    id,
    author: {id: author},
    createdAt: 0,
    type: 'text',
    text: `msg ${id}`,
    ...extra,
  }) as MessageType.Text;

const marker = (id: string, keptIds: string[], summary = 'S'): any => ({
  ...text(id, SUMMARY_AUTHOR_ID),
  text: summary,
  metadata: {contextSummary: true, keptIds, summarizedCount: 2},
});

// Store order: newest first.
const chat = (n: number) =>
  Array.from({length: n}, (_, i) =>
    text(`m${n - i}`, (n - i) % 2 ? USER : 'bot'),
  );

const setMessages = (messages: MessageType.Any[]) =>
  Object.defineProperty(chatSessionStore, 'currentSessionMessages', {
    get: () => messages,
    configurable: true,
  });

describe('messagesForModel', () => {
  it('passes every message through when there is no summary', () => {
    const all = chat(3);
    expect(messagesForModel(all)).toEqual({messages: all});
  });

  it('sends the summary, newer messages and only the kept older ones', () => {
    const [m6, m5, m4, m3, m2, m1] = chat(6);
    const all = [m6, m5, marker('s1', ['m4', 'm3']), m4, m3, m2, m1];
    const out = messagesForModel(all);
    expect(out.summary).toBe('S');
    expect(out.messages.map(m => m.id)).toEqual(['m6', 'm5', 'm4', 'm3']);
  });

  it('uses only the latest summary and drops older markers', () => {
    const [m3, m2, m1] = chat(3);
    const all = [
      marker('s2', ['m3'], 'new'),
      m3,
      marker('s1', ['m2'], 'old'),
      m2,
      m1,
    ];
    const out = messagesForModel(all);
    expect(out.summary).toBe('new');
    expect(out.messages.map(m => m.id)).toEqual(['m3']);
    expect(findLatestSummary(all)?.id).toBe('s2');
  });
});

describe('summarizedMessageIds', () => {
  it('lists the older, not-kept messages', () => {
    const [m3, m2, m1] = chat(3);
    const ids = summarizedMessageIds([marker('s', ['m3']), m3, m2, m1]);
    expect([...ids].sort()).toEqual(['m1', 'm2']);
  });

  it('is empty without a summary', () => {
    expect(summarizedMessageIds(chat(3)).size).toBe(0);
  });
});

describe('transcriptOf', () => {
  it('writes user, assistant, picture and tool lines oldest first', () => {
    const turn = {
      id: 't',
      type: 'assistant_turn',
      author: {id: 'bot'},
      steps: [
        {
          content: ' Looking. ',
          toolOutcomes: [{toolName: 'web_search', result: {summary: 'found'}}],
        },
      ],
    } as any;
    const out = transcriptOf(
      [text('a', USER, {text: 'hi', imageUris: ['x']}), marker('s', []), turn],
      USER,
    );
    expect(out).toBe(
      'User: hi [1 picture(s) attached]\n' +
        'Assistant: Looking.\n' +
        'Assistant used web_search: found',
    );
  });
});

describe('summarizeTranscript', () => {
  it('summarizes long transcripts in chunks, folding in the summary so far', async () => {
    const completion = jest
      .fn()
      .mockResolvedValueOnce({content: '<think>x</think> first'})
      .mockResolvedValueOnce({content: 'second'});
    const out = await summarizeTranscript(
      {completion} as any,
      'a'.repeat(3000),
      undefined,
      // Tiny context: forces the 2000-character minimum chunk.
      100,
    );
    expect(out).toBe('second');
    expect(completion).toHaveBeenCalledTimes(2);
    const secondUser = completion.mock.calls[1][0].messages[1].content;
    expect(secondUser).toContain('Summary so far:\nfirst');
  });

  it('rejects an empty answer', async () => {
    const completion = jest.fn().mockResolvedValue({content: '  '});
    await expect(
      summarizeTranscript({completion} as any, 'x', 'prev', 4096),
    ).rejects.toThrow('empty summary');
  });
});

describe('summarizeCurrentChat', () => {
  const completion = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    uiStore.setSummaryNotice(null);
    runInAction(() => {
      modelStore.engine = {completion} as any;
    });
    completion.mockResolvedValue({content: 'the summary'});
  });

  afterEach(() => {
    runInAction(() => {
      modelStore.engine = undefined;
    });
    setMessages([]);
  });

  it('adds a marker keeping the last 4 messages and offers Undo', async () => {
    const all = chat(7);
    setMessages(all);
    expect(canSummarize(all)).toBe(true);

    await expect(summarizeCurrentChat(USER)).resolves.toBe('done');

    const added = (chatSessionStore.addMessageToCurrentSession as jest.Mock)
      .mock.calls[0][0];
    expect(added.text).toBe('the summary');
    expect(added.author.id).toBe(SUMMARY_AUTHOR_ID);
    expect(added.metadata).toEqual({
      contextSummary: true,
      keptIds: ['m7', 'm6', 'm5', 'm4'],
      summarizedCount: 3,
    });
    // Oldest first in the transcript.
    const prompt = completion.mock.calls[0][0].messages[1].content;
    expect(prompt.indexOf('msg m1')).toBeLessThan(prompt.indexOf('msg m3'));
    expect(prompt).not.toContain('msg m4');
    expect(chatSessionStore.clearCompletionSnapshot).toHaveBeenCalled();
  });

  it('does nothing with 4 or fewer messages', async () => {
    setMessages(chat(4));
    expect(canSummarize(chat(4))).toBe(false);
    await expect(summarizeCurrentChat(USER)).resolves.toBe('nothing');
    expect(completion).not.toHaveBeenCalled();
  });

  it('leaves the chat unchanged when the model fails', async () => {
    setMessages(chat(6));
    completion.mockRejectedValue(new Error('boom'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(summarizeCurrentChat(USER)).resolves.toBe('failed');
    expect(chatSessionStore.addMessageToCurrentSession).not.toHaveBeenCalled();
  });

  it('reports busy when no model is free', async () => {
    setMessages(chat(6));
    runInAction(() => {
      modelStore.engine = undefined;
    });
    await expect(summarizeCurrentChat(USER)).resolves.toBe('busy');
  });

  it('shows working, then the failure, through the notice', async () => {
    setMessages(chat(6));
    completion.mockRejectedValue(new Error('boom'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const run = summarizeWithNotice(USER);
    expect(uiStore.summaryNotice).toEqual({kind: 'working'});
    await run;
    expect(uiStore.summaryNotice).toEqual({kind: 'failed'});
  });

  it('stays quiet when an automatic run has nothing to do', async () => {
    setMessages(chat(3));
    await summarizeWithNotice(USER, {automatic: true});
    expect(uiStore.summaryNotice).toBeNull();
  });
});
