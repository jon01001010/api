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
    sessions: [] as {id: string; messages: any[]}[],
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

const mockBattery = {state: undefined as any};
jest.mock('../loopBattery', () => ({
  readBattery: jest.fn(async () => mockBattery.state),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  afterReply,
  BATTERY_WAIT_MS,
  batteryOk,
  batteryText,
  buildLoop,
  cleanBattery,
  dryRunOf,
  editLoop,
  EVERY_MS,
  loadLoops,
  type Loop,
  MAX_DAYS,
  MAX_RUNS,
  NO_PROGRESS_WHY,
  replyTo,
  runMessage,
  saveLoopEdit,
  startLoop,
  summary,
  togglePause,
  upcomingRuns,
  waitForBattery,
  WAITING_BATTERY,
} from '../loops';
import {draftOfLoop, loopPromptOf, planOfLoop, blankDraft} from '../makeLoop';
import {
  lookForDue,
  runLoopNow,
  setLoopSender,
  stopLoopWatch,
} from '../loopRunner';

const NOW = new Date(2026, 10, 13, 9, 30).getTime();
const DAY = EVERY_MS.day;

const focus = () => {
  const r = buildLoop({
    templateId: 'focus-timer',
    values: {task: 'report'},
    every: 'hour',
    maxRuns: 8,
    days: 1,
    now: NOW,
  });
  if (!r.ok) {
    throw new Error(r.error);
  }
  return r.loop;
};

beforeEach(async () => {
  await (AsyncStorage as any).clear();
  stopLoopWatch();
  mockBattery.state = undefined;
  mockStore.chatSessionStore.sessions = [];
  mockStore.chatSessionStore.activeSessionId = null;
  jest.restoreAllMocks();
});

describe('battery guard', () => {
  it('defaults to charging or above 20%, and reads odd values safely', () => {
    expect(cleanBattery(undefined)).toEqual({kind: 'above', percent: 20});
    expect(cleanBattery({kind: 'above', percent: 300})).toEqual({
      kind: 'above',
      percent: 95,
    });
    expect(cleanBattery({kind: 'charger', x: 1})).toEqual({kind: 'charger'});
    expect(cleanBattery({kind: 'rm -rf'})).toEqual({
      kind: 'above',
      percent: 20,
    });
    expect(focus().battery).toEqual({kind: 'above', percent: 20});
  });

  it('is met when charging, above the level, or with no reading (desktop)', () => {
    const above = {kind: 'above', percent: 20} as const;
    expect(batteryOk(above, undefined)).toBe(true);
    expect(batteryOk(above, {level: 0.5, charging: false})).toBe(true);
    expect(batteryOk(above, {level: 0.2, charging: false})).toBe(true);
    expect(batteryOk(above, {level: 0.15, charging: false})).toBe(false);
    expect(batteryOk(above, {level: 0.1, charging: true})).toBe(true);
    expect(batteryOk(above, {level: -1, charging: false})).toBe(true);
    expect(batteryOk({kind: 'charger'}, {level: 1, charging: false})).toBe(
      false,
    );
    expect(batteryOk({kind: 'charger'}, {level: 0.1, charging: true})).toBe(
      true,
    );
    expect(batteryOk({kind: 'charger'}, undefined)).toBe(true);
    expect(batteryOk({kind: 'any'}, {level: 0.01, charging: false})).toBe(true);
    expect(batteryText(undefined)).toBe(
      'Only when charging or battery above 20%',
    );
    expect(summary(focus())).toContain(
      'only when charging or battery above 20%',
    );
  });

  it('waits 30 minutes with one log line, however often it looks', () => {
    let l = waitForBattery(focus(), NOW);
    expect(l.nextAt).toBe(NOW + BATTERY_WAIT_MS);
    expect(l.log[0].what).toBe(WAITING_BATTERY);
    l = waitForBattery(l, NOW + BATTERY_WAIT_MS);
    expect(l.log.filter(e => e.what === WAITING_BATTERY)).toHaveLength(1);
    expect(l.log[0].at).toBe(NOW + BATTERY_WAIT_MS);
  });

  it('a due loop under its battery guard is not asked about; it waits', async () => {
    const r: any = await startLoop({
      templateId: 'focus-timer',
      values: {task: 'report'},
      every: 'hour',
      maxRuns: 2,
      days: 1,
      battery: {kind: 'charger'},
      now: NOW,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockBattery.state = {level: 0.9, charging: false};
    expect(await lookForDue(NOW)).toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
    let [saved] = await loadLoops();
    expect(saved.log[0].what).toBe(WAITING_BATTERY);
    expect(saved.nextAt).toBe(NOW + BATTERY_WAIT_MS);
    expect(saved.runs).toBe(0);

    // Its notification was tapped: says why it waits (no question).
    const later = NOW + BATTERY_WAIT_MS;
    expect(await lookForDue(later, r.loop.id)).toBeUndefined();
    expect(alert).toHaveBeenCalledTimes(1);
    expect((alert.mock.calls[0] as any)[2]).toBeUndefined();

    // On the charger: asked as usual.
    mockBattery.state = {level: 0.1, charging: true};
    [saved] = await loadLoops();
    expect((await lookForDue(saved.nextAt))?.id).toBe(r.loop.id);
    const buttons = (alert.mock.calls[1] as any)[2].map((b: any) => b.text);
    expect(buttons).toEqual(['Skip', 'Later', 'Run now']);
  });
});

describe('no-progress stop', () => {
  const reply = (steps: string[], body = 'Done.') =>
    `${body}\n\nNext steps:\n${steps.map(s => `- ${s}`).join('\n')}`;

  it('pauses after two runs in a row with the same next steps', () => {
    let l = afterReply(focus(), reply(['Write intro', 'Add charts']), NOW);
    expect(l.paused).toBe(false);
    l = afterReply(l, reply(['Write the summary']), NOW);
    expect(l.paused).toBe(false);
    l = afterReply(
      l,
      reply(['write the  SUMMARY'], 'Different words this time.'),
      NOW,
    );
    expect(l.paused).toBe(true);
    expect(l.pausedWhy).toBe(NO_PROGRESS_WHY);
    expect(l.log[0].what).toBe('Paused: no progress for 2 runs');
  });

  it('pauses on the very same reply, even without next steps', () => {
    let l = afterReply(focus(), 'No change.', NOW);
    l = afterReply(l, ' no   change. ', NOW);
    expect(l.paused).toBe(true);
  });

  it('does not count an empty (stopped) reply, or different replies', () => {
    let l = afterReply(focus(), 'No change.', NOW);
    l = afterReply(l, '', NOW);
    expect(l.paused).toBe(false);
    l = afterReply(l, 'Something new.', NOW);
    expect(l.paused).toBe(false);
    // The reply itself is not stored, only a fingerprint.
    expect(JSON.stringify(l)).not.toContain('Something new');
  });

  it('Resume clears the reason and starts the check afresh', () => {
    let l = afterReply(focus(), 'Same.', NOW);
    l = afterReply(l, 'Same.', NOW);
    l = togglePause(l, NOW);
    expect(l.paused).toBe(false);
    expect(l.pausedWhy).toBeUndefined();
    l = afterReply(l, 'Same.', NOW);
    expect(l.paused).toBe(false);
    l = togglePause(l, NOW);
    expect(l.paused).toBe(true);
    expect(l.pausedWhy).toBeUndefined();
  });

  it('finds the reply to the message the app sent (newest first)', () => {
    const user = 'u';
    const text = (m: any) => m.text;
    const msgs = [
      {author: {id: 'a'}, text: 'the reply'},
      {author: {id: 'a'}, text: 'note', metadata: {system: true}},
      {author: {id: user}, text: 'run 1'},
    ];
    expect(replyTo(msgs, 'run 1', user, text)).toBe('the reply');
    expect(replyTo(msgs, 'other', user, text)).toBeUndefined();
    expect(replyTo(msgs.slice(1), 'run 1', user, text)).toBeUndefined();
  });

  it('after a run reply completes, the runner pauses a loop that repeats itself', async () => {
    const r: any = await startLoop({
      templateId: 'focus-timer',
      values: {task: 'report'},
      every: 'hour',
      maxRuns: 5,
      days: 1,
      now: NOW,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const {user} = require('../../../utils/chat');
    setLoopSender(
      async text => {
        mockStore.chatSessionStore.activeSessionId = 'chat1';
        mockStore.chatSessionStore.sessions = [
          {
            id: 'chat1',
            messages: [
              {
                type: 'text',
                author: {id: 'bot'},
                text: 'Ok.\n\nNext steps:\n- Write the intro',
              },
              {type: 'text', author: user, text},
            ],
          },
        ];
      },
      () => {},
    );
    expect(await runLoopNow(r.loop.id, NOW)).toBeUndefined();
    let [saved] = await loadLoops();
    expect(saved.paused).toBe(false);
    expect(saved.progress?.steps).toBeTruthy();
    expect(await runLoopNow(r.loop.id, NOW + 3600_000)).toBeUndefined();
    [saved] = await loadLoops();
    expect(saved.paused).toBe(true);
    expect(saved.pausedWhy).toBe(NO_PROGRESS_WHY);
    expect((alert.mock.calls[0] as any)[0]).toContain('Loop paused');
  });
});

describe('edit a running loop', () => {
  const ran = (): Loop => ({
    ...focus(),
    runs: 3,
    nextAt: NOW + 3 * 3600_000,
    log: [
      {at: NOW + 2 * 3600_000, what: 'Run 3'},
      {at: NOW, what: 'Started'},
    ],
  });
  const base = (l: Loop) => ({
    title: l.title,
    prompt: l.prompt,
    every: l.every,
    at: l.at,
    maxRuns: l.maxRuns,
    days: 1,
    battery: l.battery,
  });

  it('keeps runs, chat and log; logs Edited; same schedule keeps next time', () => {
    const l = {...ran(), sessionId: 'chat1'};
    const r = editLoop(l, {...base(l), title: 'Report'}, NOW + 3600_000);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.loop.title).toBe('Report');
    expect(r.loop.runs).toBe(3);
    expect(r.loop.sessionId).toBe('chat1');
    expect(r.loop.nextAt).toBe(l.nextAt);
    expect(r.loop.log[0].what).toBe('Edited');
    expect(r.loop.log).toHaveLength(3);
  });

  it('a new schedule moves the next time', () => {
    const l = ran();
    const now = NOW + 3600_000;
    const r = editLoop(
      l,
      {...base(l), every: 'day', at: {hour: 7, minute: 15}, days: 5},
      now,
    );
    expect(r.ok && new Date(r.loop.nextAt).getHours()).toBe(7);
    expect(r.ok && r.loop.nextAt).toBeGreaterThan(now);
    const r2 = editLoop(l, {...base(l), every: '3hours'}, now);
    expect(r2.ok && r2.loop.nextAt).toBe(now + 3 * 3600_000);
    expect(editLoop(l, {...base(l), every: 'day'}, now)).toEqual({
      ok: false,
      error: 'Time as HH:MM, e.g. 07:30',
    });
  });

  it('stays within the hard limits: days from the start, runs not below done', () => {
    const l = ran();
    const r = editLoop(l, {...base(l), maxRuns: 999, days: 999}, NOW + 1000);
    expect(r.ok && r.loop.maxRuns).toBe(MAX_RUNS);
    expect(r.ok && r.loop.endAt).toBe(NOW + MAX_DAYS * DAY);
    const r2 = editLoop(l, {...base(l), maxRuns: 1}, NOW + 1000);
    expect(r2.ok && r2.loop.maxRuns).toBe(3);
    // An end already past is refused.
    expect(editLoop(l, {...base(l), days: 1}, NOW + 2 * DAY).ok).toBe(false);
    expect(editLoop(l, {...base(l), title: ' '}, NOW).ok).toBe(false);
    expect(editLoop(l, {...base(l), prompt: ''}, NOW).ok).toBe(false);
  });

  it('a new prompt forgets the no-progress fingerprint; a guard can change', () => {
    const l = afterReply(ran(), 'Same.', NOW);
    const r = editLoop(
      l,
      {...base(l), prompt: 'Something else', battery: {kind: 'charger'}},
      NOW,
    );
    expect(r.ok && r.loop.progress).toBeUndefined();
    expect(r.ok && r.loop.battery).toEqual({kind: 'charger'});
    const r2 = editLoop(l, base(l), NOW);
    expect(r2.ok && r2.loop.progress).toEqual(l.progress);
  });

  it('custom loops: the steps checklist is edited and saved; the alarm moves', async () => {
    const draft = {
      ...blankDraft('get fit'),
      prompt: 'Help me get fit.',
      steps: ['Walk', 'Stretch'],
    };
    const prompt = loopPromptOf(draft);
    const started: any = await startLoop({
      templateId: 'custom',
      values: {},
      custom: {
        title: 'Fit',
        prompt,
        plan: {goal: 'Help me get fit.', steps: ['Walk', 'Stretch']},
      },
      every: 'day',
      at: {hour: 7, minute: 0},
      maxRuns: 10,
      days: 10,
      now: NOW,
    });
    expect(draftOfLoop(started.loop, NOW).steps).toEqual(['Walk', 'Stretch']);
    expect(draftOfLoop(started.loop, NOW).days).toBe(10);
    const steps = ['Walk', 'Stretch', 'Run'];
    const edited = await saveLoopEdit(
      started.loop.id,
      {
        title: 'Fit',
        prompt: loopPromptOf({...draft, steps}),
        plan: {goal: 'Help me get fit.', steps},
        every: 'day',
        at: {hour: 8, minute: 0},
        maxRuns: 10,
        days: 10,
      },
      NOW + 1000,
    );
    expect(edited.ok).toBe(true);
    const [saved] = await loadLoops();
    expect(saved.plan?.steps).toEqual(steps);
    expect(saved.prompt).toContain('3. Run');
    expect(new Date(saved.nextAt).getHours()).toBe(8);
    expect(saved.log[0].what).toBe('Edited');
    expect((await saveLoopEdit('gone', {...base(saved), days: 3})).ok).toBe(
      false,
    );
  });

  it('reads the steps back from an older custom loop without a saved plan', () => {
    const prompt = loopPromptOf({
      ...blankDraft(''),
      prompt: 'Help me move.',
      steps: ['Pack', 'Book a van'],
    });
    const old = {...focus(), templateId: 'custom', prompt};
    expect(planOfLoop(old)).toEqual({
      goal: 'Help me move.',
      steps: ['Pack', 'Book a van'],
    });
    // A prompt it can't read back is edited as text.
    expect(planOfLoop({...old, prompt: `${prompt} extra`})).toBeUndefined();
    expect(planOfLoop(focus())).toBeUndefined();
    expect(draftOfLoop(focus(), NOW).prompt).toBe(focus().prompt);
  });
});

describe('dry run', () => {
  it('shows the first message exactly, the next 3 times, limits and uses', () => {
    const l = focus();
    const dry = dryRunOf(l, 'The model only.');
    expect(dry.message).toBe(runMessage(l));
    expect(dry.times).toEqual([NOW, NOW + 3600_000, NOW + 7200_000]);
    expect(dry.limits.join(' ')).toContain('At most 8 runs');
    expect(dry.limits.join(' ')).toContain('battery above 20%');
    expect(dry.limits.join(' ')).toContain('two runs in a row');
    expect(dry.uses).toContain('The model only.');
  });

  it('lists only runs within the limits', () => {
    const l = {...focus(), maxRuns: 2};
    expect(upcomingRuns(l, 3)).toHaveLength(2);
    const ending = {...focus(), endAt: NOW + 3600_000};
    expect(upcomingRuns(ending, 3)).toEqual([NOW, NOW + 3600_000]);
  });

  it('building the preview saves nothing', async () => {
    expect(buildLoop({...({} as any), templateId: 'nope'}).ok).toBe(false);
    focus();
    expect(await loadLoops()).toEqual([]);
  });
});
