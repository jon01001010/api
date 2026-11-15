import {bm25Rank, pickNotes, splitNotes, stem, tokenize} from '../memorySearch';
import {
  formatPastSnippets,
  pickPastSnippets,
  snippetAround,
  type PastChatMessage,
} from '../pastChats';

const MEMORY = [
  'Name: Jon, lives in Leeds',
  'Has a dog called Rex (a border collie)',
  'Allergic to peanuts and shellfish',
  'Works as a nurse, night shifts on weekends',
  'Favourite music: jazz and old soul records',
  '',
  'Project:',
  'PocketAgent runs models on the phone',
  'Wants the desktop app on Linux too',
].join('\n');

describe('tokenize and stem', () => {
  it('lower-cases, drops stop words and stems English plurals and -ing', () => {
    expect(tokenize('The Dogs are RUNNING to the parks')).toEqual([
      'dog',
      'run',
      'park',
    ]);
    expect(stem('allergies')).toBe(stem('allergy'));
    expect(stem('liked')).toBe(stem('likes'));
    expect(stem('boxes')).toBe('box');
  });

  it('keeps accents from breaking matches', () => {
    expect(tokenize('Café')).toEqual(tokenize('cafe'));
  });

  it('works on non-Latin text: words with spaces, and scripts without', () => {
    expect(tokenize('Моя собака Рекс')).toEqual(['моя', 'собака', 'рекс']);
    expect(tokenize('مرحبا بالعالم')).toEqual(['مرحبا', 'بالعالم']);
    // Chinese: single characters and pairs.
    expect(tokenize('我的狗')).toEqual(['我', '我的', '的', '的狗', '狗']);
    // Mixed scripts in one chunk.
    expect(tokenize('Rex是狗')).toEqual(['rex', '是', '是狗', '狗']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize('!!! ... ???')).toEqual([]);
  });
});

describe('splitNotes', () => {
  it('one note per line; a heading helps the lines under it', () => {
    const notes = splitNotes(MEMORY, 'user');
    expect(notes).toHaveLength(7);
    expect(notes[5]).toMatchObject({
      text: 'PocketAgent runs models on the phone',
      context: 'Project:',
    });
    // A heading with nothing under it is a note itself.
    expect(splitNotes('Todo:\n\nBuy milk', 'user').map(n => n.text)).toEqual([
      'Todo:',
      'Buy milk',
    ]);
    expect(splitNotes('', 'user')).toEqual([]);
    expect(splitNotes('\n\n  \n', 'model')).toEqual([]);
  });
});

describe('ranking', () => {
  const notes = splitNotes(MEMORY, 'user');

  it.each([
    ['What should I feed my dog?', 'Has a dog called Rex'],
    ['Can I eat peanut butter?', 'Allergic to peanuts'],
    ['recommend some jazz albums', 'Favourite music: jazz'],
    ['Am I working this weekend?', 'Works as a nurse'],
    ['how is the project going', 'PocketAgent runs models'],
  ])('%p ranks the right note first', (query, expected) => {
    const picked = pickNotes(notes, query);
    expect(picked[0].text).toContain(expected);
  });

  it('nothing matches: nothing is sent', () => {
    expect(pickNotes(notes, 'quantum chromodynamics')).toEqual([]);
    expect(pickNotes(notes, 'the and of to')).toEqual([]);
    expect(pickNotes(notes, '')).toEqual([]);
  });

  it('empty memory sends nothing', () => {
    expect(pickNotes([], 'my dog')).toEqual([]);
    expect(bm25Rank([], 'my dog')).toEqual([]);
  });

  it('keeps to top N and the character budget', () => {
    const many = splitNotes(
      Array.from(
        {length: 30},
        (_, i) => `tea note ${i} ${'x'.repeat(50)}`,
      ).join('\n'),
      'user',
    );
    expect(pickNotes(many, 'tea')).toHaveLength(8);
    expect(pickNotes(many, 'tea', {topN: 3})).toHaveLength(3);
    const budgeted = pickNotes(many, 'tea', {topN: 30, budget: 300});
    const used = budgeted.reduce((n, note) => n + note.text.length + 1, 0);
    expect(used).toBeLessThanOrEqual(300);
    expect(budgeted.length).toBeGreaterThan(0);
    // A note longer than the budget is skipped, a shorter one still goes.
    const mixed = splitNotes(`tea ${'y'.repeat(500)}\ntea short`, 'user');
    expect(pickNotes(mixed, 'tea', {budget: 100}).map(n => n.text)).toEqual([
      'tea short',
    ]);
  });

  it('rare words count more than common ones', () => {
    const docs = [
      'coffee in the morning',
      'coffee with Anna',
      'Anna birthday 3 May',
    ];
    expect(bm25Rank(docs, "Anna's birthday")[0].index).toBe(2);
  });

  it('the earlier message helps a short follow-up, but counts less', () => {
    const picked = pickNotes(notes, [
      {text: 'and his breed?', weight: 1},
      {text: 'tell me about my dog', weight: 0.5},
    ]);
    expect(picked[0].text).toContain('dog called Rex');
  });

  it('non-Latin notes match non-Latin messages', () => {
    const ru = splitNotes(
      'Собака Рекс любит гулять\nАллергия на орехи\nРаботаю медсестрой',
      'user',
    );
    expect(pickNotes(ru, 'Можно мне орехи?')[0].text).toBe('Аллергия на орехи');
    const zh = splitNotes('我的狗叫雷克斯\n我对花生过敏\n我是护士', 'user');
    expect(pickNotes(zh, '我可以吃花生吗？')[0].text).toBe('我对花生过敏');
    const ja = splitNotes('猫が好き\n東京に住んでいる', 'user');
    expect(pickNotes(ja, '東京のおすすめ')[0].text).toBe('東京に住んでいる');
  });
});

describe('earlier chats', () => {
  const messages: PastChatMessage[] = [
    {
      sessionId: 'a',
      title: 'Trip',
      date: '2026-10-01T10:00:00.000Z',
      text: 'We are going to Lisbon in March',
      createdAt: 1,
    },
    {
      sessionId: 'a',
      title: 'Trip',
      date: '2026-10-01T10:00:00.000Z',
      text: 'Lisbon hotels near the river?',
      createdAt: 2,
    },
    {
      sessionId: 'b',
      title: 'Cooking',
      date: '2026-10-05T10:00:00.000Z',
      text: 'Recipe for bacalhau from Lisbon',
      createdAt: 3,
    },
    {
      sessionId: 'c',
      title: 'Work',
      date: '2026-10-06T10:00:00.000Z',
      text: 'Rota for next week',
      createdAt: 4,
    },
    {
      sessionId: 'd',
      title: 'More',
      date: 'not a date',
      text: 'Lisbon again',
      createdAt: 0,
    },
    {
      sessionId: 'e',
      title: 'Even more',
      date: '2026-10-07',
      text: 'Lisbon Lisbon',
      createdAt: 5,
    },
  ];

  it('at most 3 snippets, one per chat, only matching ones, labelled', () => {
    const picked = pickPastSnippets(messages, 'When is my Lisbon trip?');
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map(p => p.sessionId)).size).toBe(3);
    expect(picked.map(p => p.sessionId)).not.toContain('c');
    expect(pickPastSnippets(messages, 'nothing relevant here')).toEqual([]);
    expect(pickPastSnippets([], 'Lisbon')).toEqual([]);
    const text = formatPastSnippets([
      {
        sessionId: 'a',
        title: 'Trip',
        day: '2026-10-01',
        text: 'Lisbon in March',
      },
      {sessionId: 'd', title: '  ', day: '', text: 'Lisbon again'},
    ]);
    expect(text).toBe(
      'From "Trip" (2026-10-01): Lisbon in March\nFrom "Untitled chat": Lisbon again',
    );
  });

  it('snippets are short and around the matching word', () => {
    const long =
      'x '.repeat(300) +
      'my passport number is in the drawer ' +
      'y '.repeat(300);
    const snippet = snippetAround(long, 'where is my passport', 120);
    expect(snippet.length).toBeLessThanOrEqual(122);
    expect(snippet).toContain('passport');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippetAround('short one', 'one')).toBe('short one');
  });
});
