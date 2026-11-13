/**
 * The PC side of keeping in step (desktop app). The link passes a paired
 * device's items here (src-tauri/src/link.rs, "link-sync"); this merges
 * them with the PC's own (newer edit wins, the other kept in history),
 * writes the agreed ones here and answers with them. Only while the user
 * allows it on this PC (off by default).
 */
import {Alert} from 'react-native';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';

import {mirrorOnPc, SYNC_ROOM} from './chatSync';

import {
  applyItems,
  cleanItems,
  describeKeys,
  merge,
  readItems,
} from './promptSync';

const SETTING = 'pa-link-sync';
const MIRROR_SETTING = 'pa-link-mirror';

/** Mirror chats with paired devices (its own switch; off by default). */
export async function hostMirrorAllowed(): Promise<boolean> {
  try {
    return globalThis.localStorage?.getItem(MIRROR_SETTING) === 'on';
  } catch {
    return false;
  }
}

export async function setHostMirrorAllowed(allowed: boolean): Promise<void> {
  globalThis.localStorage?.setItem(MIRROR_SETTING, allowed ? 'on' : 'off');
}

const isDesktop = () => !!(globalThis as any).__TAURI_INTERNALS__;

export async function hostSyncAllowed(): Promise<boolean> {
  try {
    return globalThis.localStorage?.getItem(SETTING) === 'on';
  } catch {
    return false;
  }
}

export async function setHostSyncAllowed(allowed: boolean): Promise<void> {
  globalThis.localStorage?.setItem(SETTING, allowed ? 'on' : 'off');
  await invoke('link_sync_allow', {allowed});
}

/** One sync from a paired device: merge, write here, answer (exported for tests). */
export async function answerSync(
  body: string,
  device: string,
): Promise<string> {
  let remote: unknown;
  let chats: any;
  try {
    const parsed = JSON.parse(body);
    remote = parsed?.items;
    chats = parsed?.chats;
  } catch {
    return JSON.stringify({ok: false, error: 'Not readable'});
  }
  const local = await readItems();
  const merged = merge(local, cleanItems(remote));
  const changed = await applyItems(merged.items);
  if (changed.length) {
    Alert.alert(
      'Kept in step',
      `${describeKeys(changed)} updated from ${device || 'a paired device'}. The earlier versions are kept in history.`,
    );
  }
  // Chats, only if mirroring is allowed here too.
  let send: unknown[] = [];
  if (chats && (await hostMirrorAllowed())) {
    const room = SYNC_ROOM - JSON.stringify(merged.items).length;
    const r = await mirrorOnPc(
      chats.sessions,
      chats.versions,
      Math.max(room, 0),
    );
    send = r.send;
    if (r.taken) {
      await require('../../store').chatSessionStore.loadSessionList();
    }
  }
  return JSON.stringify({
    ok: true,
    items: merged.items,
    takenByPc: changed,
    chats: {sessions: send},
  });
}

let started = false;

/** At start: tell the link the user's choice, and answer syncs. */
export function startHostSync(): void {
  if (started || !isDesktop()) {
    return;
  }
  started = true;
  hostSyncAllowed().then(allowed =>
    invoke('link_sync_allow', {allowed}).catch(() => {}),
  );
  listen<{id: number; device: string; body: string}>('link-sync', async e => {
    const {id, device, body} = e.payload;
    let reply: string;
    try {
      reply = await answerSync(body, device);
    } catch (err) {
      reply = JSON.stringify({ok: false, error: String(err)});
    }
    invoke('link_sync_reply', {id, body: reply}).catch(() => {});
  }).catch(() => {});
}
