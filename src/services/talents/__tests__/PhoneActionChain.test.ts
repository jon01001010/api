import {AppState} from 'react-native';

import {
  CHAIN_TOOL_NAME,
  MAX_CHAIN_STEPS,
  PhoneActionChainEngine,
  withChainOnlyIfUsable,
} from '../PhoneActionChain';
import {resetRecentPhoneActions} from '../PhoneActionsEngine';
import {requestFileApproval} from '../fileApprovalGate';
import {listInstalledApps, performPhoneAction} from '../../phoneActions/native';
import {readGlobalTools} from '../../../utils/globalToolSettings';
import {checkCustomTool} from '../customTools';

jest.mock('../fileApprovalGate', () => ({
  requestFileApproval: jest.fn(),
}));
jest.mock('../../phoneActions/native', () => ({
  performPhoneAction: jest.fn(),
  listInstalledApps: jest.fn(),
  findContacts: jest.fn().mockResolvedValue([]),
  actionAsksItself: () => false,
  describeFailure: jest.requireActual('../../phoneActions/native')
    .describeFailure,
}));
jest.mock('../../../utils/globalToolSettings', () => ({
  readGlobalTools: jest.fn(),
}));

const approve = requestFileApproval as jest.Mock;
const perform = performPhoneAction as jest.Mock;
const switches = readGlobalTools as jest.Mock;

const ON = [
  CHAIN_TOOL_NAME,
  'navigate_to',
  'play_music',
  'set_timer',
  'open_app',
];
const HOME_THEN_MUSIC = [
  {action: 'navigate_to', args: {destination: 'Home'}},
  {action: 'play_music', args: {query: 'Road trip'}},
];

const run = (steps: unknown, signal?: AbortSignal) =>
  new PhoneActionChainEngine().execute({steps}, signal ? {signal} : undefined);
/** The questions asked, in order. */
const questions = () => approve.mock.calls.map(c => c[0].filename);

beforeEach(() => {
  jest.clearAllMocks();
  resetRecentPhoneActions();
  (AppState as any).currentState = 'active';
  approve.mockResolvedValue(true);
  perform.mockResolvedValue({ok: true});
  switches.mockResolvedValue(ON);
});

describe('phone_actions_chain', () => {
  it('shows the whole list first, then asks before every step', async () => {
    const result = await run(HOME_THEN_MUSIC);
    expect(questions()).toEqual([
      'Do these 2 steps? Each one asks again before it runs.',
      'Step 1 of 2: Open maps for "Home"?',
      'Step 2 of 2: Play "Road trip" in your music app?',
    ]);
    expect(approve.mock.calls[0][0].content).toBe(
      '1. Open maps for "Home"\n2. Play "Road trip" in your music app',
    );
    expect(perform.mock.calls).toEqual([
      ['navigate', {destination: 'Home'}],
      ['play_music', {query: 'Road trip'}],
    ]);
    expect(result.type).toBe('text');
    expect(result.summary).toMatch(/^All 2 steps done:/);
    expect(result.summary).toMatch(/This request is complete/);
    // Each step's own "stop here" is left out; the chain says it once.
    expect(result.summary.match(/This request is complete/g)).toHaveLength(1);
  });

  it('a no to the list does nothing at all', async () => {
    approve.mockResolvedValueOnce(false);
    const result = await run(HOME_THEN_MUSIC);
    expect(questions()).toHaveLength(1);
    expect(perform).not.toHaveBeenCalled();
    expect(result.summary).toMatch(/said no to these steps\. Nothing was done/);
  });

  it('Cancel on a step stops it and every step after it', async () => {
    approve
      .mockResolvedValueOnce(true) // the list
      .mockResolvedValueOnce(true) // step 1
      .mockResolvedValueOnce(false); // step 2
    const result = await run([
      ...HOME_THEN_MUSIC,
      {action: 'set_timer', args: {minutes: 5}},
    ]);
    expect(questions()).toHaveLength(3);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(result.summary).toMatch(/^Stopped at step 2 of 3 \(play_music\)/);
    expect(result.summary).toMatch(/Done before that:\n1\. Done: Opened maps/);
    expect(result.summary).toMatch(/Not done: 2\. play_music, 3\. set_timer/);
    expect(result.summary).toMatch(/Do not do the remaining steps/);
  });

  it('a refused first step stops the chain; nothing is done', async () => {
    approve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await run(HOME_THEN_MUSIC);
    expect(perform).not.toHaveBeenCalled();
    expect(questions()).toHaveLength(2);
    expect(result.summary).toMatch(/Stopped at step 1 of 2/);
    expect(result.summary).toMatch(/Nothing was done/);
  });

  it('a failed step stops the rest', async () => {
    perform.mockResolvedValueOnce({ok: false, reason: 'no_app'});
    const result = await run(HOME_THEN_MUSIC);
    expect(result.type).toBe('error');
    expect(perform).toHaveBeenCalledTimes(1);
    expect(questions()).toHaveLength(2);
    expect(result.summary).toMatch(/Not done: 1\. navigate_to, 2\. play_music/);
  });

  it('Stop during a step cancels the rest', async () => {
    const controller = new AbortController();
    approve.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
      controller.abort();
      return true;
    });
    const result = await run(HOME_THEN_MUSIC, controller.signal);
    expect(perform).not.toHaveBeenCalled();
    expect(result.summary).toMatch(/Stopped at step 1 of 2/);
  });

  it('waits for the user to come back before asking the next step', async () => {
    jest.useFakeTimers();
    try {
      let onChange: ((s: string) => void) | undefined;
      const remove = jest.fn();
      const listen = jest
        .spyOn(AppState, 'addEventListener')
        .mockImplementation((_type, fn) => {
          onChange = fn as (s: string) => void;
          return {remove} as any;
        });
      // Step 1 opens maps: PocketAgent leaves the screen.
      perform.mockImplementationOnce(async () => {
        (AppState as any).currentState = 'background';
        return {ok: true};
      });
      const done = run(HOME_THEN_MUSIC);
      for (let i = 0; i < 20 && !onChange; i++) {
        await Promise.resolve();
      }
      expect(onChange).toBeDefined();
      expect(questions()).toHaveLength(2); // step 2 not asked yet
      (AppState as any).currentState = 'active';
      onChange!('active');
      const result = await done;
      expect(questions()[2]).toMatch(/^Step 2 of 2/);
      expect(result.summary).toMatch(/^All 2 steps done/);
      expect(remove).toHaveBeenCalled();
      listen.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops if the user does not come back', async () => {
    jest.useFakeTimers();
    try {
      perform.mockImplementationOnce(async () => {
        (AppState as any).currentState = 'background';
        return {ok: true};
      });
      const done = run(HOME_THEN_MUSIC);
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
      jest.advanceTimersByTime(11 * 60_000);
      const result = await done;
      expect(questions()).toHaveLength(2);
      expect(perform).toHaveBeenCalledTimes(1);
      expect(result.summary).toMatch(/did not come back to PocketAgent/);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('checks every step before asking anything', () => {
    const refused = async (steps: unknown, why: RegExp) => {
      const result = await run(steps);
      expect(result.type).toBe('error');
      expect(result.summary).toMatch(why);
      expect(result.summary).toMatch(/Nothing was done/);
      expect(approve).not.toHaveBeenCalled();
      expect(perform).not.toHaveBeenCalled();
    };

    it('at least 2 and at most 5 steps', async () => {
      await refused(undefined, /2 to 5 phone actions/);
      await refused([HOME_THEN_MUSIC[0]], /For a single action/);
      const six = Array.from({length: MAX_CHAIN_STEPS + 1}, (_, i) => ({
        action: 'set_timer',
        args: {minutes: i + 1},
      }));
      await refused(six, /At most 5 steps/);
    });

    it('each step is checked by its own tool', async () => {
      await refused(
        [HOME_THEN_MUSIC[0], {action: 'set_timer', args: {minutes: 0}}],
        /Step 2 \(set_timer\): The timer must be between/,
      );
      await refused(
        [{action: 'play_music', args: {}}, HOME_THEN_MUSIC[0]],
        /Step 1 \(play_music\): Give the `query`/,
      );
    });

    it('refuses an unknown action and any tool that is not a phone action', async () => {
      await refused(
        [HOME_THEN_MUSIC[0], {action: 'send_money', args: {}}],
        /Step 2: "send_money" is not a phone action/,
      );
      await refused(
        [HOME_THEN_MUSIC[0], {action: 'file_create', args: {}}],
        /not a phone action/,
      );
      await refused(
        [HOME_THEN_MUSIC[0], {action: CHAIN_TOOL_NAME, args: {}}],
        /not a phone action/,
      );
    });

    it('refuses a phone action that is switched off', async () => {
      switches.mockResolvedValue([CHAIN_TOOL_NAME, 'navigate_to']);
      await refused(HOME_THEN_MUSIC, /play_music is switched off/);
      // Unreadable switches mean none.
      switches.mockRejectedValue(new Error('broken'));
      await refused(HOME_THEN_MUSIC, /switched off/);
    });

    it('an app that matches several names is asked about first', async () => {
      (listInstalledApps as jest.Mock).mockResolvedValue([
        {label: 'Music', package: 'a.music'},
        {label: 'Music Pro', package: 'b.music'},
      ]);
      await refused(
        [{action: 'open_app', args: {name: 'Mus'}}, HOME_THEN_MUSIC[0]],
        /Step 1 \(open_app\): Several apps match/,
      );
    });
  });

  it('is offered only next to a phone action that is switched on', () => {
    expect(withChainOnlyIfUsable([CHAIN_TOOL_NAME, 'calculate'])).toEqual([
      'calculate',
    ]);
    expect(withChainOnlyIfUsable([CHAIN_TOOL_NAME, 'play_music'])).toEqual([
      CHAIN_TOOL_NAME,
      'play_music',
    ]);
    expect(withChainOnlyIfUsable(['play_music'])).toEqual(['play_music']);
  });

  it('cannot be a step of a shortcut', () => {
    expect(
      checkCustomTool(
        {
          kind: 'shortcut',
          name: 'two_things',
          description: 'x',
          steps: [{tool: CHAIN_TOOL_NAME, args: {}}],
        },
        {builtIns: [CHAIN_TOOL_NAME], existing: []},
      ),
    ).toMatch(/not a built-in tool a shortcut can use/);
  });

  it('describes itself with a how-to and at most 5 phone action steps', () => {
    const def = new PhoneActionChainEngine().toToolDefinition();
    expect(def.function.name).toBe(CHAIN_TOOL_NAME);
    expect(def.function.description).toMatch(/How:/);
    expect(def.function.parameters.properties.steps.maxItems).toBe(5);
    expect(
      def.function.parameters.properties.steps.items.properties.action.enum,
    ).not.toContain(CHAIN_TOOL_NAME);
  });
});
