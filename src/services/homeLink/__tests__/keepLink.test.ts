import {AppState} from 'react-native';

import {serverStore} from '../../../store/ServerStore';
import {uiStore} from '../../../store/UIStore';
import {
  homeLinkReady,
  keepHomeLink,
  linkNeedsCheck,
  RECHECK_AFTER_MS,
  RECONNECTING,
  resetHomeLinkKeeper,
} from '../keepLink';

const PC = 'd'.repeat(64);

let appStateListener: ((state: string) => void) | undefined;
jest.spyOn(AppState, 'addEventListener').mockImplementation(((
  _type: string,
  listener: (state: string) => void,
) => {
  appStateListener = listener;
  return {remove: () => {}};
}) as any);

const signal = () => new AbortController().signal;

let homeId: string;
let prepare: jest.SpyInstance;

beforeEach(() => {
  resetHomeLinkKeeper();
  uiStore.clearChatWarning();
  homeId = serverStore.addServer({
    name: 'Home PC',
    url: 'http://127.0.0.1:1',
    homeLinkPc: PC,
  });
  prepare = jest
    .spyOn(serverStore, 'prepareHomeLink')
    .mockResolvedValue({ok: true});
  jest.spyOn(serverStore, 'getApiKey').mockResolvedValue('fresh-key');
});

afterEach(() => {
  jest.useRealTimers();
  prepare.mockRestore();
});

describe('when the link to the PC is checked', () => {
  it('never checked, away since the last check, or 2 minutes old', () => {
    expect(linkNeedsCheck(0, null, 1000)).toBe(true);
    expect(linkNeedsCheck(1000, null, 2000)).toBe(false);
    // Paused after the last check: check before the next request.
    expect(linkNeedsCheck(1000, 1500, 2000)).toBe(true);
    // Paused before it: already checked since.
    expect(linkNeedsCheck(1000, 500, 2000)).toBe(false);
    expect(linkNeedsCheck(1000, null, 1000 + RECHECK_AFTER_MS + 1)).toBe(true);
  });
});

describe('keeping the home link between replies', () => {
  it('checks once, then not again until needed; other servers never', async () => {
    await expect(keepHomeLink(homeId)).resolves.toEqual({ok: true});
    await keepHomeLink(homeId);
    expect(prepare).toHaveBeenCalledTimes(1);
    const cloud = serverStore.addServer({name: 'Cloud', url: 'https://x.y'});
    await keepHomeLink(cloud);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('one check at a time', async () => {
    const a = keepHomeLink(homeId);
    const b = keepHomeLink(homeId);
    await Promise.all([a, b]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('tries a second time (a link that went quiet is reopened)', async () => {
    prepare
      .mockResolvedValueOnce({ok: false, error: 'The PC did not answer'})
      .mockResolvedValueOnce({ok: true});
    await expect(keepHomeLink(homeId)).resolves.toEqual({ok: true});
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('shows "Reconnecting to your PC…" only while a check is slow', async () => {
    jest.useFakeTimers();
    let finish: (r: {ok: boolean}) => void = () => {};
    prepare.mockImplementationOnce(
      () => new Promise(resolve => (finish = resolve)),
    );
    const check = keepHomeLink(homeId);
    expect(uiStore.chatWarning).toBeNull();
    jest.advanceTimersByTime(1000);
    expect(uiStore.chatWarning?.message).toBe(RECONNECTING);
    finish({ok: true});
    await check;
    expect(uiStore.chatWarning).toBeNull();
  });

  it('leaves other warnings alone', async () => {
    uiStore.setChatWarning({
      code: 'unknown',
      message: 'Something else',
      context: 'chat',
      recoverable: true,
    });
    await keepHomeLink(homeId);
    expect(uiStore.chatWarning?.message).toBe('Something else');
  });

  it('coming back to the screen reopens the link quietly, before the next request', async () => {
    homeLinkReady(homeId, {apiKey: 'k'}, true, () => true);
    expect(prepare).not.toHaveBeenCalled();
    appStateListener!('background');
    appStateListener!('active');
    await Promise.resolve();
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('not for a model that is no longer loaded', async () => {
    homeLinkReady(homeId, {apiKey: 'k'}, true, () => false);
    appStateListener!('background');
    appStateListener!('active');
    await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('before each request to a Home PC model', () => {
  it('right after Load: no extra check', async () => {
    const ready = homeLinkReady(homeId, {apiKey: 'k'}, true, () => true);
    await ready(signal());
    expect(prepare).not.toHaveBeenCalled();
  });

  it('after the app was away: checks first and takes a new password', async () => {
    const endpoint = {apiKey: 'old-key'};
    const ready = homeLinkReady(homeId, endpoint, true, () => true);
    appStateListener!('background');
    await ready(signal());
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(endpoint.apiKey).toBe('fresh-key');
  });

  it('the PC out of reach: the request stops with the reason', async () => {
    prepare.mockResolvedValue({
      ok: false,
      error: 'Could not reach the PC (is the home link on?)',
    });
    const ready = homeLinkReady(homeId, {apiKey: 'k'}, false, () => true);
    await expect(ready(signal())).rejects.toThrow(
      "Can't reach your PC: Could not reach the PC (is the home link on?)",
    );
  });

  it('Stop does not wait for a slow check', async () => {
    prepare.mockImplementation(() => new Promise(() => {}));
    const ready = homeLinkReady(homeId, {apiKey: 'k'}, false, () => true);
    const controller = new AbortController();
    const waiting = ready(controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBeUndefined();
  });
});
