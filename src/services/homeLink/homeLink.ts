/**
 * Home link, phone side: use the home PC's model (DesktopAgent) from
 * anywhere. The native module (android/.../homelink, library native/homelink)
 * does the work; this wraps it. Every call answers, never throws.
 *
 * Pairing reads the PC's QR code (`PA1:P:<pc key>:<one-time code>`); the PC
 * asks its user before pairing. Afterwards a local port on this phone
 * (127.0.0.1) leads to the PC's model server, used as an ordinary server.
 */
import {Alert, NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

/** A line of the PC's pairing history (see src-tauri/src/link.rs). */
export interface PairingEvent {
  n: number;
  at: number;
  kind: 'code' | 'paired' | 'removed' | string;
  name?: string;
}

export const pcStatus = (pc: string) =>
  ask<{running: boolean; apiKey: string | null; events?: PairingEvent[]}>(
    'status',
    pc,
  );

const seenKey = (pc: string) => `homeLink.lastEvent.${pc}`;

export function describeEvent(e: PairingEvent): string {
  const when = new Date(e.at * 1000).toLocaleString();
  if (e.kind === 'code') {
    return `${when}: a pairing code was made`;
  }
  if (e.kind === 'paired') {
    return `${when}: phone \u201c${e.name || 'a phone'}\u201d was paired`;
  }
  if (e.kind === 'removed') {
    return `${when}: phone \u201c${e.name || 'a phone'}\u201d was removed`;
  }
  return `${when}: ${e.kind}`;
}

/**
 * The PC's pairing history lines this phone has not shown yet, and marks
 * them shown. `markOnly` (right after this phone paired) shows nothing.
 */
export async function newPairingEvents(
  pc: string,
  events: PairingEvent[] | undefined,
  markOnly = false,
): Promise<PairingEvent[]> {
  const list = Array.isArray(events) ? events : [];
  let seen = 0;
  try {
    seen = Number(await AsyncStorage.getItem(seenKey(pc))) || 0;
  } catch {}
  const fresh = list.filter(e => typeof e.n === 'number' && e.n > seen);
  const top = Math.max(seen, ...list.map(e => e.n || 0));
  if (top > seen) {
    try {
      await AsyncStorage.setItem(seenKey(pc), String(top));
    } catch {}
  }
  return markOnly ? [] : fresh;
}

/**
 * Tells the user about pairing activity on the PC since last time: a code
 * made while away from home, a phone added or removed.
 */
export async function noticePairingActivity(
  pc: string,
  events: PairingEvent[] | undefined,
): Promise<void> {
  const fresh = await newPairingEvents(pc, events);
  if (fresh.length === 0) {
    return;
  }
  Alert.alert(
    'Pairing activity on your PC',
    `${fresh.map(describeEvent).join('\n')}\n\nIf this wasn't you, on your PC go to Settings \u2192 Use this PC's model from your phone, remove phones you don't know, and switch the link off.`,
  );
}

/** Opens (or returns) the local port that leads to the PC's model server. */
export const openTunnel = (pc: string) => ask<{port: number}>('openTunnel', pc);

export const closeTunnel = () => ask<{}>('closeTunnel');

/** The address the app uses for the PC's model server. */
export const tunnelUrl = (port: number) => `http://127.0.0.1:${port}`;
