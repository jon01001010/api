/**
 * Device circle, stage 2: signed removal notices
 * (docs/design/device-circle.md). The native side does the work (the phone:
 * native/homelink circle.rs through HomeLinkModule; the PC: link.rs
 * link_circle): it signs a notice with this device's own key, keeps it
 * until the other devices have it (they get it with the next status round
 * trip), and checks every notice it receives (signed by a device this one
 * trusts, new, in time, not about this device).
 *
 * A notice can only remove: these calls never add a device or switch a
 * right on. A removal received from another device is applied without
 * asking and the user is told (owner's decision 9a).
 */
import {Alert, NativeModules} from 'react-native';

import type {ServerConfig} from '../../utils/types';
import {pcStatus} from './homeLink';
import {shortKey} from './yourDevices';

/** A removal applied here (from another device's notice). */
export interface CircleNews {
  removed: string;
  by: string;
  at: number;
  removedName?: string;
  byName?: string;
  /** This device told the user already (the PC's own notification). */
  told?: boolean;
}

type CircleAnswer =
  | {ok: true; news?: CircleNews[]}
  | {ok: false; error: string};

/** The Home PCs this device uses (the only PCs whose notices it takes). */
export function homePcKeys(servers: ServerConfig[]): string[] {
  return [
    ...new Set(servers.map(s => s.homeLinkPc).filter((k): k is string => !!k)),
  ];
}

async function circle(request: object): Promise<CircleAnswer> {
  const mod = NativeModules.HomeLink;
  if (!mod || typeof mod.circle !== 'function') {
    return {ok: false, error: 'The home link is not in this build'};
  }
  try {
    const answer = JSON.parse(await mod.circle(JSON.stringify(request)));
    if (answer && answer.ok === true) {
      return {
        ok: true,
        news: Array.isArray(answer.news) ? answer.news : undefined,
      };
    }
    return {ok: false, error: String(answer?.error || 'refused')};
  } catch (e) {
    return {ok: false, error: String(e)};
  }
}

/**
 * The user removed `key` here ("Remove here"): a notice signed by this
 * device waits to be passed on to its other devices. `servers`: this
 * device's servers after the removal. No network.
 */
export const tellRemoval = (key: string, servers: ServerConfig[]) =>
  circle({
    op: 'remove',
    key,
    homePcs: homePcKeys(servers).filter(k => k !== key),
  });

interface Store {
  servers: ServerConfig[];
  removeServer(id: string): void;
}

/** What the user is told about a removal applied here. */
export function describeNews(news: CircleNews, servers: ServerConfig[]) {
  const nameOf = (key: string) => servers.find(s => s.homeLinkPc === key)?.name;
  const by = news.byName || nameOf(news.by) || 'Another of your devices';
  const removed =
    news.removedName ||
    nameOf(news.removed) ||
    `a device (${shortKey(news.removed)})`;
  return `“${by}” removed “${removed}” from your devices; removed here too.`;
}

/**
 * Removals applied here since last asked (each once): the Home PC entries
 * for a removed key go, as "Remove here" removes them, and the user is told
 * (unless this device told them already). Never asks: it only removes.
 */
export async function takeCircleNews(store: Store): Promise<CircleNews[]> {
  const answer = await circle({op: 'news', homePcs: homePcKeys(store.servers)});
  if (!answer.ok || !answer.news?.length) {
    return [];
  }
  const lines: string[] = [];
  for (const news of answer.news) {
    const servers = [...store.servers];
    const gone = servers.filter(s => s.homeLinkPc === news.removed);
    gone.forEach(s => store.removeServer(s.id));
    if (gone.length > 0 && !news.told) {
      lines.push(describeNews(news, servers));
    }
  }
  if (lines.length > 0) {
    Alert.alert('Removed on another of your devices', lines.join('\n\n'));
  }
  return answer.news;
}

/**
 * After "Remove here": hands the notice to the Home PCs this device uses
 * now, with their usual status round trip (each behind its PIN, if set),
 * instead of waiting for the next one. Best effort and quiet.
 */
export async function passRemovalsOn(store: Store): Promise<void> {
  for (const pc of homePcKeys(store.servers)) {
    await pcStatus(pc);
  }
  await takeCircleNews(store);
}
