/**
 * Home link between replies (phone). While a reply comes in, the chat's
 * background notification keeps the app running; between replies Android
 * may pause the app, and the link to the PC can go quiet or drop. So:
 *
 * - when the app comes back to the screen, the link to the PC of the loaded
 *   Home PC model is checked and reopened quietly;
 * - before the next request, if the app was away since the last check, or
 *   the check is older than 2 minutes, the link is checked first, instead
 *   of the request failing. "Reconnecting to your PC…" shows while that
 *   takes more than a moment.
 *
 * A check is ServerStore.prepareHomeLink (tunnel, the PC's status and the
 * model's current password); it never starts a model on the PC.
 */
import {AppState} from 'react-native';

import {serverStore} from '../../store/ServerStore';
import {uiStore} from '../../store/UIStore';
import {LOCKED, unlockHomePc} from './homePcLock';

export const RECHECK_AFTER_MS = 2 * 60 * 1000;
/** Quick checks show nothing; slower ones show RECONNECTING. */
export const SHOW_AFTER_MS = 800;
export const RECONNECTING = 'Reconnecting to your PC…';

type Result = {ok: boolean; error?: string};

/**
 * Whether the link should be checked before the next request: never
 * checked, the app was away (paused) since the last check, or it was
 * checked more than RECHECK_AFTER_MS ago.
 */
export function linkNeedsCheck(
  lastOkAt: number,
  awaySince: number | null,
  now: number,
): boolean {
  if (!lastOkAt) {
    return true;
  }
  if (awaySince !== null && awaySince >= lastOkAt) {
    return true;
  }
  return now - lastOkAt > RECHECK_AFTER_MS;
}

const lastOk = new Map<string, number>();
const inFlight = new Map<string, Promise<Result>>();
let awaySince: number | null = null;
/** Goes up with every good check (a new password may have come with it). */
let generation = 0;
/** The loaded Home PC model's server, checked when the app comes back. */
let watched: {serverId: string; isCurrent: () => boolean} | null = null;
let listening = false;

function listen() {
  if (listening) {
    return;
  }
  listening = true;
  AppState.addEventListener('change', state => {
    if (state !== 'active') {
      awaySince = Date.now();
      return;
    }
    if (watched && watched.isCurrent()) {
      keepHomeLink(watched.serverId).catch(() => {});
    }
  });
}

/**
 * Checks the link to this Home PC server and reopens it if needed; does
 * nothing when it was checked lately (see linkNeedsCheck) or the server is
 * not a Home PC. Tries twice: a link that went quiet is closed after the
 * first try, so the second opens a new one. Never throws.
 */
export function keepHomeLink(
  serverId: string,
  {force = false}: {force?: boolean} = {},
): Promise<Result> {
  const server = serverStore.servers.find(s => s.id === serverId);
  if (!server?.homeLinkPc) {
    return Promise.resolve({ok: true});
  }
  if (
    !force &&
    !linkNeedsCheck(lastOk.get(serverId) ?? 0, awaySince, Date.now())
  ) {
    return Promise.resolve({ok: true});
  }
  const running = inFlight.get(serverId);
  if (running) {
    return running;
  }
  const run = (async (): Promise<Result> => {
    const timer = setTimeout(
      () =>
        uiStore.setChatWarning({
          code: 'network',
          message: RECONNECTING,
          context: 'chat',
          recoverable: true,
          severity: 'warning',
        }),
      SHOW_AFTER_MS,
    );
    try {
      let result: Result = {ok: false};
      for (let attempt = 0; attempt < 2 && !result.ok; attempt++) {
        try {
          result = await serverStore.prepareHomeLink(serverId);
        } catch (e) {
          result = {ok: false, error: String(e)};
        }
      }
      if (result.ok) {
        lastOk.set(serverId, Date.now());
        generation++;
      }
      return result;
    } finally {
      clearTimeout(timer);
      if (uiStore.chatWarning?.message === RECONNECTING) {
        uiStore.clearChatWarning();
      }
      inFlight.delete(serverId);
    }
  })();
  inFlight.set(serverId, run);
  return run;
}

/**
 * For a loaded Home PC model: the check the chat runs before each request
 * (RemoteEngineOptions.ensureReady). `endpoint` is the engine's own
 * address and password; a good check that brought a new password (the PC
 * restarted its model) updates it there. `linkOk`: Load's own check went
 * well just now. A failed check stops the request with its reason.
 */
export function homeLinkReady(
  serverId: string,
  endpoint: {apiKey?: string},
  linkOk: boolean,
  isCurrent: () => boolean,
): (signal: AbortSignal) => Promise<void> {
  watched = {serverId, isCurrent};
  listen();
  if (linkOk) {
    lastOk.set(serverId, Date.now());
  }
  let seen = generation;
  return async signal => {
    // The PC's PIN, if set on this device and locked: asked first.
    const pc = serverStore.servers.find(s => s.id === serverId)?.homeLinkPc;
    if (pc) {
      const open = await untilAborted(unlockHomePc(pc), signal);
      if (open === undefined) {
        return; // Stopped.
      }
      if (!open) {
        throw new Error(LOCKED);
      }
    }
    const result = await untilAborted(keepHomeLink(serverId), signal);
    if (!result) {
      return; // Stopped: the engine says so itself.
    }
    if (!result.ok) {
      throw new Error(
        `Can't reach your PC: ${result.error || 'no answer'}. Is DesktopAgent open with the link on?`,
      );
    }
    if (seen !== generation) {
      seen = generation;
      endpoint.apiKey =
        (await serverStore.getApiKey(serverId)) ?? endpoint.apiKey;
    }
  };
}

/** The promise's value, or undefined as soon as Stop is pressed. */
function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T | undefined> {
  if (signal.aborted) {
    return Promise.resolve(undefined);
  }
  return new Promise(resolve => {
    const stop = () => resolve(undefined);
    signal.addEventListener('abort', stop, {once: true} as any);
    promise.then(value => {
      signal.removeEventListener('abort', stop);
      resolve(value);
    });
  });
}

/** Tests only. */
export function resetHomeLinkKeeper(): void {
  lastOk.clear();
  inFlight.clear();
  awaySince = null;
  generation = 0;
  watched = null;
}
