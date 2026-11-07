/**
 * Home link, phone side: use the home PC's model (DesktopAgent) from
 * anywhere. The native module (android/.../homelink, library native/homelink)
 * does the work; this wraps it. Every call answers, never throws.
 *
 * Pairing reads the PC's QR code (`PA1:P:<pc key>:<one-time code>`); the PC
 * asks its user before pairing. Afterwards a local port on this phone
 * (127.0.0.1) leads to the PC's model server, used as an ordinary server.
 */
import {NativeModules} from 'react-native';

export const PAIRING_TAG = 'PA1:P:';

/** True for a desktop pairing code (the one QR scanner's `PA1:P:` tag). */
export function isPairingCode(text: string): boolean {
  return /^PA1:P:[0-9a-f]{64}:[0-9a-f]{32}$/.test(text.trim());
}

type Answer<T> = ({ok: true} & T) | {ok: false; error: string};

const native = () => NativeModules.HomeLink;

export const homeLinkInBuild = (): boolean => !!native();

async function ask<T>(
  method: 'pair' | 'status' | 'openTunnel' | 'closeTunnel',
  ...args: string[]
): Promise<Answer<T>> {
  const mod = native();
  if (!mod || typeof mod[method] !== 'function') {
    return {ok: false, error: 'The home link is not in this build'};
  }
  try {
    const text: string = await mod[method](...args);
    const answer = JSON.parse(text);
    if (answer && answer.ok === true) {
      return answer;
    }
    return {ok: false, error: String(answer?.error || 'refused')};
  } catch (e) {
    return {ok: false, error: String(e)};
  }
}

/** Pairs from the PC's QR code; the PC asks its user first. */
export const pairWithPc = (qr: string) => ask<{pc: string}>('pair', qr.trim());

export const pcStatus = (pc: string) =>
  ask<{running: boolean; apiKey: string | null}>('status', pc);

/** Opens (or returns) the local port that leads to the PC's model server. */
export const openTunnel = (pc: string) => ask<{port: number}>('openTunnel', pc);

export const closeTunnel = () => ask<{}>('closeTunnel');

/** The address the app uses for the PC's model server. */
export const tunnelUrl = (port: number) => `http://127.0.0.1:${port}`;
