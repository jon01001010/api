jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const store = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return {__esModule: true, default: store, ...store};
});

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  buildBackgroundParts,
  buildPromptPreview,
  DEFAULT_PROMPT_PARTS,
  joinParts,
  readPromptPartSettings,
  timeLine,
  writePromptPartSettings,
} from '../promptParts';

// 23:29 local on a Saturday (what a small model fixated on).
const late = new Date(2026, 10, 7, 23, 29);

describe('what the model sees', () => {
  it('date and time: off, date only (default), or date and time — local, never UTC', () => {
    expect(timeLine(late, 'off')).toBe('');
    expect(timeLine(late, 'date')).toBe(
      'Background: today is Saturday, 7 November 2026.',
    );
    expect(timeLine(late, 'datetime')).toMatch(
      /^Background: today is Saturday, 7 November 2026; the local time is 23:29 \(UTC[+-]\d\d:\d\d\)\.$/,
    );
    expect(DEFAULT_PROMPT_PARTS.time).toBe('date');
  });

  it('each part follows its switch, in a fixed order, empty parts left out', () => {
    const base = {
      now: late,
      globalInstructions: '  Be brief.  ',
      memoryContext: 'Memory: likes tea',
      summaryContext: '',
      toolLine: 'Available tools: web_search.',
    };
    const all = buildBackgroundParts({...base, settings: DEFAULT_PROMPT_PARTS});
    expect(all.map(p => p.id)).toEqual(['time', 'global', 'memory', 'tools']);
    expect(joinParts(all)).toBe(
      'Background: today is Saturday, 7 November 2026.\n\nBe brief.\n\nMemory: likes tea\n\nAvailable tools: web_search.',
    );
    const none = buildBackgroundParts({
      ...base,
      globalInstructions: '',
      settings: {
        ...DEFAULT_PROMPT_PARTS,
        time: 'off',
        memory: false,
        toolList: false,
      },
    });
    expect(none).toEqual([]);
    // Every part says where to change it.
    for (const p of all) {
      expect(p.source.length).toBeGreaterThan(5);
    }
  });

  it('the preview holds the model prompt and tool guidance only when switched on', () => {
    const input = {
      now: late,
      modelDefaultPrompt: 'You are a helpful assistant.',
      toolGuidance: ['You can search the web with web_search.'],
      globalInstructions: '',
      memoryContext: '',
      toolLine: '',
    };
    expect(
      buildPromptPreview({...input, settings: DEFAULT_PROMPT_PARTS}).map(
        p => p.id,
      ),
    ).toEqual(['model', 'guidance-0', 'time']);
    expect(
      buildPromptPreview({
        ...input,
        settings: {
          ...DEFAULT_PROMPT_PARTS,
          modelDefaultPrompt: false,
          toolGuidance: false,
        },
      }).map(p => p.id),
    ).toEqual(['time']);
  });

  it('settings are saved, and anything unreadable falls back to the defaults', async () => {
    await expect(readPromptPartSettings()).resolves.toEqual(
      DEFAULT_PROMPT_PARTS,
    );
    await writePromptPartSettings({
      ...DEFAULT_PROMPT_PARTS,
      time: 'off',
      memory: false,
    });
    await expect(readPromptPartSettings()).resolves.toMatchObject({
      time: 'off',
      memory: false,
    });
    await AsyncStorage.setItem(
      '@pocketagent/prompt-parts/v1',
      '{"time":"always","memory":"yes"}',
    );
    await expect(readPromptPartSettings()).resolves.toMatchObject({
      time: 'date',
      memory: true,
    });
    await AsyncStorage.setItem('@pocketagent/prompt-parts/v1', 'not json');
    await expect(readPromptPartSettings()).resolves.toEqual(
      DEFAULT_PROMPT_PARTS,
    );
  });
});
