import {Alert} from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const store = {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    clear: jest.fn(async () => values.clear()),
  };
  return {__esModule: true, default: store, ...store};
});

const mockStore = {
  chatSessionStore: {
    sessions: [] as {id: string}[],
    activeSessionId: null as string | null,
    setActiveSession: jest.fn(async (id: string) => {
      mockStore.chatSessionStore.activeSessionId = id;
    }),
    resetActiveSession: jest.fn(() => {
      mockStore.chatSessionStore.activeSessionId = null;
    }),
    updateSessionTitleBySessionId: jest.fn(async () => {}),
  },
  modelStore: {
    activeModelId: 'm' as string | undefined,
    isGenerationBusy: false,
  },
};
jest.mock('../../../store', () => mockStore);

import AsyncStorage from '@react-native-async-storage/async-storage';

import {LOOP_TEMPLATES} from '../loopTemplates';
import {
  cleanBlank,
  dueLoops,
  fillTemplate,
  firstRun,
  loadLoops,
  MAX_LOOPS,
  MAX_RUNS,
  nextStepsOf,
  runMessage,
  startLoop,
  stopLoop,
  summary,
} from '../loops';
import {
  lookForDue,
  runLoopNow,
  setLoopSender,
  stopLoopWatch,
} from '../loopRunner';

const goal = LOOP_TEMPLATES.find(t => t.id === 'goal-planner')!;
const NOW = new Date(2026, 10, 13, 9, 30).getTime();

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  stopLoopWatch();
  mockStore.chatSessionStore.sessions = [];
  mockStore.chatSessionStore.activeSessionId = null;
  jest.restoreAllMocks();
});

describe('ready-made loops', () => {
  it('fills blanks as plain text only, all required', () => {
    expect(fillTemplate(goal, {goal: 'x'})).toEqual({
      ok: false,
      error: 'Fill in "Time you have each day"',
    });
    const r = fillTemplate(goal, {
      goal: 'learn {{time}}\nchess',
      time: '20 min',
    });
    expect(r.ok && r.prompt).toContain('My goal: learn time chess.');
    expect(cleanBlank('a'.repeat(500))).toHaveLength(200);
    // Every shipped template's blanks are all used in its prompt.
    for (const t of LOOP_TEMPLATES) {
      for (const b of t.blanks) {
        expect([t.id, t.prompt.includes(`{{${b.key}}}`)]).toEqual([t.id, true]);
      }
    }
  });

  it('runs daily at the chosen time, within hard limits', async () => {
    expect(new Date(firstRun('day', {hour: 8, minute: 0}, NOW)).getDate()).toBe(
      14,
    );
    expect(firstRun('day', {hour: 10, minute: 0}, NOW)).toBe(
      new Date(2026, 10, 13, 10, 0).getTime(),
    );
    const r = await startLoop({
      templateId: goal.id,
      values: {goal: 'garage', time: '20 minutes'},
      every: 'day',
      at: {hour: 25, minute: 0},
      maxRuns: 999,
      days: 999,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    const loop = (r as any).loop;
    expect(loop.maxRuns).toBe(MAX_RUNS);
    expect(loop.at).toBeUndefined();
    expect(summary(loop)).toContain('Asks before each run');
    expect(await startLoop({...({} as any), templateId: 'nope'})).toEqual({
      ok: false,
      error: 'Unknown loop',
    });
  });

  it('caps how many loops exist', async () => {
    for (let i = 0; i < MAX_LOOPS; i++) {
      await startLoop({
        templateId: 'focus-timer',
        values: {task: 'x'},
        every: 'hour',
        maxRuns: 2,
        days: 1,
        now: NOW + i,
      });
    }
    const r = await startLoop({
      templateId: 'focus-timer',
      values: {task: 'x'},
      every: 'hour',
      maxRuns: 2,
      days: 1,
    });
    expect(r.ok).toBe(false);
  });

  it('reads 1–3 next steps from the end of a reply', () => {
    expect(
      nextStepsOf(
        'Done today.\n\n**Next steps:**\n1. Sort the shelf\n- Bag old paint\n* Call the dump\n4. Too many',
      ),
    ).toEqual(['Sort the shelf', 'Bag old paint', 'Call the dump']);
    expect(nextStepsOf('No steps here')).toEqual([]);
  });

  it('asks when due, and a run is a message in its own chat, counted first', async () => {
    const r: any = await startLoop({
      templateId: 'focus-timer',
      values: {task: 'report'},
      every: 'hour',
      maxRuns: 2,
      days: 1,
      now: NOW,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    expect((await lookForDue(NOW))?.id).toBe(r.loop.id);
    // Asked once per due time, not again on the next look.
    expect(await lookForDue(NOW)).toBeUndefined();
    const buttons = (alert.mock.calls[0] as any)[2].map((b: any) => b.text);
    expect(buttons).toEqual(['Skip', 'Later', 'Run now']);

    // No chat screen yet: nothing runs.
    expect(await runLoopNow(r.loop.id, NOW)).toBe('Open the chat first');
    const sent: string[] = [];
    setLoopSender(
      async text => {
        sent.push(text);
        mockStore.chatSessionStore.activeSessionId = 'chat1';
      },
      () => {},
    );
    expect(await runLoopNow(r.loop.id, NOW)).toBeUndefined();
    expect(sent[0]).toContain('first run of my loop "Focus check-in"');
    expect(sent[0]).toContain('Next steps:');
    let [saved] = await loadLoops();
    expect(saved.runs).toBe(1);
    expect(saved.sessionId).toBe('chat1');
    expect(saved.nextAt).toBeGreaterThan(NOW);
    expect(dueLoops([saved], NOW)).toEqual([]);
    expect(runMessage(saved)).toContain('run 2 of my loop');

    // The model busy or not loaded: not run.
    mockStore.modelStore.isGenerationBusy = true;
    expect(await runLoopNow(r.loop.id, NOW)).toMatch(/busy/);
    mockStore.modelStore.isGenerationBusy = false;
    await runLoopNow(r.loop.id, NOW + 3600_000);
    // At its limit: never again.
    expect(await runLoopNow(r.loop.id, NOW + 7200_000)).toMatch(/limit/);
    [saved] = await loadLoops();
    expect(saved.runs).toBe(2);
    await stopLoop(saved.id);
    expect(await loadLoops()).toEqual([]);
  });
});
