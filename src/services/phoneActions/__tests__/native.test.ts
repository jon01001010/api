import {NativeModules, Platform} from 'react-native';

import {
  describeFailure,
  listInstalledApps,
  performPhoneAction,
  phoneActionsAvailable,
} from '../native';

describe('phone actions bridge', () => {
  const original = Platform.OS;
  afterEach(() => {
    (Platform as any).OS = original;
    delete (NativeModules as any).PhoneActions;
  });

  it('is unavailable without the native module (iOS, old APK)', async () => {
    (Platform as any).OS = 'ios';
    expect(phoneActionsAvailable()).toBe(false);
    expect(await performPhoneAction('show_timers')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(await listInstalledApps()).toEqual([]);
  });

  it('passes the action and its arguments to Android', async () => {
    (Platform as any).OS = 'android';
    const perform = jest.fn().mockResolvedValue({ok: true});
    (NativeModules as any).PhoneActions = {perform};
    expect(await performPhoneAction('set_timer', {seconds: 900})).toEqual({
      ok: true,
    });
    expect(perform).toHaveBeenCalledWith('set_timer', {seconds: 900});
  });

  it('turns a native error into a failure, not a crash', async () => {
    (Platform as any).OS = 'android';
    (NativeModules as any).PhoneActions = {
      perform: jest.fn().mockRejectedValue(new Error('boom')),
    };
    expect(await performPhoneAction('open_camera')).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('explains failures in plain words', () => {
    expect(describeFailure({ok: false, reason: 'no_app'}, 'set a timer')).toBe(
      'No app on this phone can set a timer.',
    );
    expect(describeFailure({ok: true}, 'x')).toBe('');
  });
});
