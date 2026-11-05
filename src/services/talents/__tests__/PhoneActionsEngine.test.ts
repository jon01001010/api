import {
  PhoneActionsEngine,
  PHONE_TOOL_NAMES,
  formatDuration,
} from '../PhoneActionsEngine';
import {requestFileApproval} from '../fileApprovalGate';
import {performPhoneAction} from '../../phoneActions/native';

jest.mock('../fileApprovalGate', () => ({
  requestFileApproval: jest.fn(),
}));
jest.mock('../../phoneActions/native', () => ({
  performPhoneAction: jest.fn(),
  describeFailure: jest.requireActual('../../phoneActions/native')
    .describeFailure,
}));

const approve = requestFileApproval as jest.Mock;
const perform = performPhoneAction as jest.Mock;
const run = (name: string, args: Record<string, unknown>) =>
  new PhoneActionsEngine(name).execute(args);

beforeEach(() => {
  jest.clearAllMocks();
  approve.mockResolvedValue(true);
  perform.mockResolvedValue({ok: true});
});

describe('phone action tools', () => {
  it('registers the timer and alarm tools, each with a how-to', () => {
    for (const name of [
      'set_timer',
      'show_timers',
      'set_alarm',
      'show_alarms',
    ]) {
      expect(PHONE_TOOL_NAMES).toContain(name);
      const def = new PhoneActionsEngine(name).toToolDefinition();
      expect(def.function.name).toBe(name);
      expect(def.function.description).toMatch(/How:/);
    }
  });

  it('formats durations for people', () => {
    expect(formatDuration(900)).toBe('15 min');
    expect(formatDuration(5400)).toBe('1 h 30 min');
    expect(formatDuration(45)).toBe('45 s');
  });

  describe('set_timer', () => {
    it('asks first, then sets it with whole seconds', async () => {
      const result = await run('set_timer', {minutes: 15, label: 'Tea'});
      expect(approve).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'phone_action',
          filename: 'Set a 15 min timer named "Tea"?',
        }),
        undefined,
      );
      expect(perform).toHaveBeenCalledWith('set_timer', {
        seconds: 900,
        label: 'Tea',
        skipUi: false,
      });
      expect(result).toEqual({
        type: 'text',
        summary: 'Timer set for 15 min (Tea). It runs in the Clock app.',
      });
    });

    it('accepts numbers sent as text, and minutes plus seconds', async () => {
      await run('set_timer', {minutes: '1', seconds: '30'});
      expect(perform).toHaveBeenCalledWith(
        'set_timer',
        expect.objectContaining({seconds: 90}),
      );
    });

    it('refuses a timer outside 1 s – 24 h without asking', async () => {
      for (const args of [{}, {minutes: 0}, {minutes: 24 * 60 + 1}]) {
        const result = await run('set_timer', args);
        expect(result.type).toBe('error');
      }
      expect(approve).not.toHaveBeenCalled();
      expect(perform).not.toHaveBeenCalled();
    });

    it('does nothing when the user denies it', async () => {
      approve.mockResolvedValue(false);
      const result = await run('set_timer', {minutes: 5});
      expect(perform).not.toHaveBeenCalled();
      expect(result.summary).toMatch(/did not approve/);
    });

    it('says so when no app on the phone can do it', async () => {
      perform.mockResolvedValue({ok: false, reason: 'no_app'});
      const result = await run('set_timer', {minutes: 5});
      expect(result).toEqual(
        expect.objectContaining({
          type: 'error',
          summary: 'set_timer: No app on this phone can set a timer.',
        }),
      );
    });
  });

  describe('set_alarm', () => {
    it('sets a 24-hour time with repeat days as Android day numbers', async () => {
      const result = await run('set_alarm', {
        hour: 7,
        minute: 30,
        label: 'Work',
        days: ['Mon', 'tuesday', 'fri', 'nope'],
      });
      expect(approve).toHaveBeenCalledWith(
        expect.objectContaining({
          filename:
            'Set an alarm for 07:30 named "Work", repeating mon, tue, fri?',
        }),
        undefined,
      );
      expect(perform).toHaveBeenCalledWith('set_alarm', {
        hour: 7,
        minutes: 30,
        label: 'Work',
        days: [2, 3, 6],
      });
      expect(result.type).toBe('text');
    });

    it('refuses an impossible time', async () => {
      for (const args of [{}, {hour: 24}, {hour: 7, minute: 60}, {hour: -1}]) {
        expect((await run('set_alarm', args)).type).toBe('error');
      }
      expect(perform).not.toHaveBeenCalled();
    });
  });

  it('show_timers and show_alarms ask, then open the Clock app', async () => {
    await run('show_timers', {});
    await run('show_alarms', {});
    expect(approve).toHaveBeenCalledTimes(2);
    expect(perform).toHaveBeenNthCalledWith(1, 'show_timers', {});
    expect(perform).toHaveBeenNthCalledWith(2, 'show_alarms', {});
  });
});
