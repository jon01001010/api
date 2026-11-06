import {
  PhoneActionsEngine,
  PHONE_TOOL_NAMES,
  formatDuration,
} from '../PhoneActionsEngine';
import {requestFileApproval} from '../fileApprovalGate';
import {listInstalledApps, performPhoneAction} from '../../phoneActions/native';
import {matchApps} from '../PhoneActionsEngine';

jest.mock('../fileApprovalGate', () => ({
  requestFileApproval: jest.fn(),
}));
jest.mock('../../phoneActions/native', () => ({
  performPhoneAction: jest.fn(),
  listInstalledApps: jest.fn(),
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

  it('gives no real places or songs as examples (small models copy them)', () => {
    const all = PHONE_TOOL_NAMES.map(
      n => new PhoneActionsEngine(n).toToolDefinition().function.description,
    ).join(' ');
    expect(all).not.toMatch(/Eiffel|Spotify|Bohemian|Leeds|Taylor Swift|Tea"/);
    // "Open maps" is open_app, not a trip somewhere.
    const nav = new PhoneActionsEngine('navigate_to').toToolDefinition();
    expect(nav.function.description).toMatch(/use open_app/);
    // ...while "open maps to <place>" is a trip.
    expect(nav.function.description).toMatch(/open maps to <place>/);
    const open = new PhoneActionsEngine('open_app').toToolDefinition();
    expect(open.function.description).toMatch(/use navigate_to/);
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

describe('open_app', () => {
  const APPS = [
    {label: 'Maps', package: 'com.google.android.apps.maps'},
    {label: 'Maps Go', package: 'com.google.android.apps.mapslite'},
    {label: 'Spotify', package: 'com.spotify.music'},
    {label: 'Google Messages', package: 'com.google.android.apps.messaging'},
    {label: 'Messenger', package: 'com.facebook.orca'},
  ];
  beforeEach(() => {
    (listInstalledApps as jest.Mock).mockResolvedValue(APPS);
  });

  it('matches names ignoring case and spaces; an exact name stands alone', () => {
    expect(matchApps('maps', APPS).map(a => a.label)).toEqual(['Maps']);
    expect(matchApps('SPOT ify', APPS).map(a => a.label)).toEqual(['Spotify']);
    expect(matchApps('mess', APPS).map(a => a.label)).toEqual([
      'Messenger',
      'Google Messages',
    ]);
    expect(matchApps('orca', APPS).map(a => a.label)).toEqual(['Messenger']);
    expect(matchApps('', APPS)).toEqual([]);
  });

  it('asks, then opens the one matching app', async () => {
    const result = await run('open_app', {name: 'spotify'});
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({filename: 'Open Spotify?'}),
      undefined,
    );
    expect(perform).toHaveBeenCalledWith('open_app', {
      package: 'com.spotify.music',
    });
    expect(result).toEqual({type: 'text', summary: 'Opened Spotify.'});
  });

  it('lists the choices when several match, without asking or opening', async () => {
    const result = await run('open_app', {name: 'mess'});
    expect(result.type).toBe('error');
    expect(result.summary).toMatch(/"Messenger", "Google Messages"/);
    expect(result.summary).toMatch(/Ask the user which one/);
    expect(approve).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
  });

  it('says so when no app has that name', async () => {
    const result = await run('open_app', {name: 'Banana'});
    expect(result.summary).toMatch(/No installed app is called "Banana"/);
    expect(perform).not.toHaveBeenCalled();
  });
});

describe('maps, music, camera and settings', () => {
  it('navigate_to opens maps for the place', async () => {
    await run('navigate_to', {destination: '  Eiffel Tower '});
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({filename: 'Open maps for "Eiffel Tower"?'}),
      undefined,
    );
    expect(perform).toHaveBeenCalledWith('navigate', {
      destination: 'Eiffel Tower',
    });
    expect((await run('navigate_to', {})).type).toBe('error');
  });

  it('play_music searches the music app', async () => {
    await run('play_music', {query: 'Bohemian Rhapsody'});
    expect(perform).toHaveBeenCalledWith('play_music', {
      query: 'Bohemian Rhapsody',
    });
  });

  it('open_camera opens the camera', async () => {
    await run('open_camera', {});
    expect(perform).toHaveBeenCalledWith('open_camera', {});
  });

  it('open_settings opens only known pages, and changes nothing itself', async () => {
    const result = await run('open_settings', {page: 'Wi-Fi'});
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({filename: 'Open Wi-Fi settings?'}),
      undefined,
    );
    expect(perform).toHaveBeenCalledWith('open_settings', {page: 'wifi'});
    expect(result.summary).toMatch(/Nothing was changed/);
    perform.mockClear();
    expect((await run('open_settings', {page: 'developer'})).type).toBe(
      'error',
    );
    expect(perform).not.toHaveBeenCalled();
  });
});

describe('reminders and messages', () => {
  it('add_reminder fills the calendar with a local time', async () => {
    const result = await run('add_reminder', {
      title: 'Dentist',
      when: '2026-11-06T09:30',
      notes: 'Bring card',
    });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'Add "Dentist" on 2026-11-06 at 09:30 to your calendar?',
        content: 'Bring card',
      }),
      undefined,
    );
    expect(perform).toHaveBeenCalledWith('add_reminder', {
      title: 'Dentist',
      startMs: new Date(2026, 10, 6, 9, 30).getTime(),
      notes: 'Bring card',
    });
    expect(result.summary).toMatch(/presses save/);
  });

  it('add_reminder refuses an impossible date', async () => {
    for (const when of ['tomorrow', '2026-02-30T09:00', '2026-13-01T09:00']) {
      expect((await run('add_reminder', {title: 'x', when})).type).toBe(
        'error',
      );
    }
    expect(perform).not.toHaveBeenCalled();
  });

  it('compose_message only opens filled-in screens', async () => {
    await run('compose_message', {kind: 'call', to: '+44 20 7946 0958'});
    expect(perform).toHaveBeenLastCalledWith('dial', {
      number: '+44 20 7946 0958',
    });
    await run('compose_message', {kind: 'text', to: '555-0101', body: 'Hi'});
    expect(perform).toHaveBeenLastCalledWith('sms', {
      number: '555-0101',
      body: 'Hi',
    });
    await run('compose_message', {
      kind: 'email',
      to: 'jon@example.com',
      subject: 'Plans',
      body: 'See you',
    });
    expect(perform).toHaveBeenLastCalledWith('email', {
      to: 'jon@example.com',
      subject: 'Plans',
      body: 'See you',
    });
    expect(approve).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filename:
          'Open an e-mail to jon@example.com about "Plans"? You press send.',
      }),
      undefined,
    );
  });

  it('compose_message refuses bad numbers, addresses and kinds', async () => {
    for (const args of [
      {kind: 'call'},
      {kind: 'call', to: 'mum'},
      {kind: 'email', to: 'not-an-address'},
      {kind: 'fax', to: '123'},
    ]) {
      expect((await run('compose_message', args)).type).toBe('error');
    }
    expect(perform).not.toHaveBeenCalled();
  });
});

describe('text into apps', () => {
  const APPS = [
    {label: 'Claude', package: 'com.anthropic.claude'},
    {label: 'YouTube', package: 'com.google.android.youtube'},
  ];
  beforeEach(() => {
    (listInstalledApps as jest.Mock).mockResolvedValue(APPS);
  });

  it('share_text opens the named app with the text filled in', async () => {
    const result = await run('share_text', {
      app: 'claude',
      text: 'What time is it?',
    });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'Open Claude with this text filled in? You press send.',
        content: 'What time is it?',
      }),
      undefined,
    );
    expect(perform).toHaveBeenCalledWith('share_text', {
      text: 'What time is it?',
      package: 'com.anthropic.claude',
    });
    expect(result.summary).toMatch(/presses send/);
  });

  it('share_text with no app opens the share menu', async () => {
    await run('share_text', {text: 'note'});
    expect(perform).toHaveBeenCalledWith('share_text', {text: 'note'});
  });

  it('share_text says plainly when the app cannot take shared text', async () => {
    perform.mockResolvedValue({ok: false, reason: 'no_app'});
    const result = await run('share_text', {app: 'YouTube', text: 'hi'});
    expect(result.summary).toMatch(/may not accept shared text/);
  });

  it('search_in_app searches an app, or the web without one', async () => {
    await run('search_in_app', {app: 'youtube', query: 'lofi'});
    expect(perform).toHaveBeenLastCalledWith('search', {
      query: 'lofi',
      package: 'com.google.android.youtube',
    });
    await run('search_in_app', {query: 'weather'});
    expect(perform).toHaveBeenLastCalledWith('search', {query: 'weather'});
    expect((await run('search_in_app', {})).type).toBe('error');
  });
});
