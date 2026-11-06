import {AppState} from 'react-native';

import {
  PhoneActionsEngine,
  PHONE_TOOL_NAMES,
  formatDuration,
  resetRecentPhoneActions,
} from '../PhoneActionsEngine';
import {requestFileApproval} from '../fileApprovalGate';
import {listInstalledApps, performPhoneAction} from '../../phoneActions/native';
import {matchApps, pickContact} from '../PhoneActionsEngine';
import {findContacts} from '../../phoneActions/native';

jest.mock('../fileApprovalGate', () => ({
  requestFileApproval: jest.fn(),
}));
jest.mock('../../phoneActions/native', () => ({
  performPhoneAction: jest.fn(),
  listInstalledApps: jest.fn(),
  findContacts: jest.fn().mockResolvedValue([]),
  describeFailure: jest.requireActual('../../phoneActions/native')
    .describeFailure,
}));

const approve = requestFileApproval as jest.Mock;
const perform = performPhoneAction as jest.Mock;
const run = (name: string, args: Record<string, unknown>) =>
  new PhoneActionsEngine(name).execute(args);

beforeEach(() => {
  jest.clearAllMocks();
  resetRecentPhoneActions();
  (AppState as any).currentState = 'active';
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
      expect(result.type).toBe('text');
      expect(result.summary).toMatch(
        /^Done: Timer set for 15 min \(Tea\)\. It runs in the Clock app\. This request is complete/,
      );
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
      expect(result.summary).toMatch(/said no/);
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
    expect(result.summary).toMatch(/^Done: Opened Spotify\./);
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
    await run('compose_message', {
      kind: 'text',
      to: '07700 900123',
      body: 'Hi',
    });
    expect(perform).toHaveBeenLastCalledWith('sms', {
      number: '07700 900123',
      body: 'Hi',
    });
    await run('compose_message', {
      kind: 'email',
      to: 'jon@pocket.dev',
      subject: 'Plans',
      body: 'See you',
    });
    expect(perform).toHaveBeenLastCalledWith('email', {
      to: 'jon@pocket.dev',
      subject: 'Plans',
      body: 'See you',
    });
    expect(approve).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filename:
          'Open an e-mail to jon@pocket.dev about "Plans"? You press send.',
      }),
      undefined,
    );
  });

  it('compose_message refuses bad numbers, addresses and kinds', async () => {
    for (const args of [
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

  it('search_in_app opens an app that takes no outside search, words copied', async () => {
    const Clipboard = require('@react-native-clipboard/clipboard');
    (listInstalledApps as jest.Mock).mockResolvedValue([
      {label: 'Files', package: 'com.google.android.documentsui'},
    ]);
    perform
      .mockResolvedValueOnce({ok: false, reason: 'no_app'})
      .mockResolvedValueOnce({ok: true});
    const result = await run('search_in_app', {app: 'files', query: 'neos'});
    expect(perform).toHaveBeenLastCalledWith('open_app', {
      package: 'com.google.android.documentsui',
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('neos');
    expect(result.summary).toMatch(/opened instead and "neos" was copied/);
    expect(approve).toHaveBeenCalledTimes(1);
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

describe('feedback loop', () => {
  it('a success tells the model the request is finished', async () => {
    const result = await run('set_alarm', {hour: 10, minute: 30});
    expect(result.summary).toMatch(/This request is complete/);
    expect(result.summary).toMatch(/call no other tool/);
  });

  it('the same action again within a minute is not repeated or asked', async () => {
    await run('set_alarm', {hour: 10, minute: 30});
    approve.mockClear();
    perform.mockClear();
    const again = await run('set_alarm', {hour: 10, minute: 30});
    expect(again.summary).toMatch(/Already done a moment ago/);
    expect(approve).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
    // A different time is a new request.
    await run('set_alarm', {hour: 11, minute: 0});
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it('with another app on screen it stops instead of reporting a refusal', async () => {
    (AppState as any).currentState = 'background';
    const result = await run('show_alarms', {});
    expect(result.summary).toMatch(/another app is on screen/);
    expect(result.summary).not.toMatch(/said no/);
    expect(approve).not.toHaveBeenCalled();
  });

  it('show_alarms and show_timers say set_* already shows them', () => {
    for (const name of ['show_alarms', 'show_timers']) {
      const d = new PhoneActionsEngine(name).toToolDefinition().function
        .description;
      expect(d).toMatch(/only when the user asks to see them/);
    }
  });
});

describe('messages to a person by name', () => {
  it('a name, not a number: Messages opens for the user to pick the contact', async () => {
    const result = await run('compose_message', {
      kind: 'text',
      name: 'Mack Frost',
      body: 'hello',
    });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        filename:
          'Open a text to Mack Frost (pick the contact)? You press send.',
        content: 'hello',
      }),
      undefined,
    );
    expect(perform).toHaveBeenCalledWith('sms', {body: 'hello'});
    expect(result.summary).toMatch(/picks the contact/);
  });

  it('refuses invented numbers and addresses', async () => {
    for (const to of [
      '+1234567890',
      '123-456-7890',
      '555-0101',
      '(212) 555-0199',
      '0000000',
      'mack@example.com',
    ]) {
      const kind = to.includes('@') ? 'email' : 'text';
      const result = await run('compose_message', {kind, to, body: 'hello'});
      expect(result.summary).toMatch(/looks made up/);
    }
    expect(perform).not.toHaveBeenCalled();
  });

  it("the how-to says to keep the user's words and never invent a number", () => {
    const d = new PhoneActionsEngine('compose_message').toToolDefinition()
      .function.description;
    expect(d).toMatch(/never make one up/);
    expect(d).toMatch(/unchanged/);
  });
});

describe('finding the contact for a name', () => {
  const CONTACTS = [
    {name: 'Mack Attack', number: '+44 7700 900123'},
    {name: 'Mack Attack', number: '+44 20 7946 0000'},
    {name: 'Mackenzie Ford', number: '07700 900456'},
  ];

  it('an exact name wins; several people are named for the user to choose', () => {
    expect(pickContact('mack attack', CONTACTS)).toEqual(CONTACTS[0]);
    expect(pickContact('mack', CONTACTS)).toMatch(
      /Several contacts match "mack": "Mack Attack", "Mackenzie Ford"/,
    );
    expect(pickContact('mack', CONTACTS)).not.toMatch(/7700/);
    expect(pickContact('Zed', [])).toBeUndefined();
  });

  it("text by name fills in the contact's number", async () => {
    (findContacts as jest.Mock).mockResolvedValueOnce(CONTACTS);
    await run('compose_message', {
      kind: 'text',
      name: 'Mack Attack',
      body: 'hello mack',
    });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        filename:
          'Open a text to Mack Attack (+44 7700 900123)? You press send.',
      }),
      undefined,
    );
    expect(perform).toHaveBeenCalledWith('sms', {
      number: '+44 7700 900123',
      body: 'hello mack',
    });
  });

  it('no match (or no permission): the user picks the contact in Messages', async () => {
    (findContacts as jest.Mock).mockResolvedValueOnce([]);
    await run('compose_message', {kind: 'text', name: 'Nobody', body: 'hi'});
    expect(perform).toHaveBeenCalledWith('sms', {body: 'hi'});
  });
});

describe('inside an approved shortcut', () => {
  it('runs without asking, even with another app on screen; Clock stays in the background', async () => {
    (AppState as any).currentState = 'background';
    const result = await new PhoneActionsEngine('set_alarm').execute(
      {hour: 7, minute: 0},
      {signal: new AbortController().signal, inApprovedShortcut: true},
    );
    expect(approve).not.toHaveBeenCalled();
    expect(perform).toHaveBeenCalledWith(
      'set_alarm',
      expect.objectContaining({hour: 7, skipUi: true}),
    );
    expect(result.summary).toMatch(/^Done/);
  });
});
