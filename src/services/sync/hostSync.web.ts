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

import {
  applyTombstones,
  askAboutHeld,
  describeDeletes,
  forgetTombstones,
  keepEarlierVersions,
  knownTombstones,
} from './chatDeletes';
import {describeAssistantDeletes} from './assistantDeletes';
import {mirrorOnPc, readAllChats, SYNC_ROOM, writeChats} from './chatSync';

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

const ANSWERS_SETTING = 'pa-link-answers';

/** Paired devices may answer this PC's "Allow?" questions (off by default). */
export async function hostAnswersAllowed(): Promise<boolean> {
  try {
    return globalThis.localStorage?.getItem(ANSWERS_SETTING) === 'on';
  } catch {
    return false;
  }
}

export async function setHostAnswersAllowed(allowed: boolean): Promise<void> {
  globalThis.localStorage?.setItem(ANSWERS_SETTING, allowed ? 'on' : 'off');
  await invoke('link_answers_allow', {allowed});
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

let noticeOpen = false;
/** Notices that came while one was open (the newest few, and how many). */
let waiting: string[] = [];
let waitingCount = 0;
const WAITING_SHOWN = 3;

/**
 * "Kept in step" on this PC: at most one shown at a time. Notices that come
 * while one is open wait, and are shown together (the newest few, and how
 * many more) once it is closed, so many syncs can't pile up dialogs.
 */
export function keptInStepNotice(message: string): void {
  if (noticeOpen) {
    waitingCount++;
    waiting = [...waiting.filter(m => m !== message), message].slice(
      -WAITING_SHOWN,
    );
    return;
  }
  noticeOpen = true;
  const closed = () => {
    if (!noticeOpen) {
      return;
    }
    noticeOpen = false;
    if (waitingCount) {
      const more = waitingCount - waiting.length;
      const text =
        waiting.join('\n\n') +
        (more > 0 ? `\n\n(and ${more} more like these)` : '');
      waiting = [];
      waitingCount = 0;
      keptInStepNotice(text);
    }
  };
  Alert.alert('Kept in step', message, [{text: 'OK', onPress: closed}], {
    cancelable: true,
    onDismiss: closed,
  });
}

/** For tests. */
export function resetKeptInStepNotice(): void {
  noticeOpen = false;
  waiting = [];
  waitingCount = 0;
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
  const report = {assistantsDeleted: 0, assistantsHeld: 0};
  const changed = await applyItems(merged.items, Date.now(), {
    from: device || 'a paired device',
    report,
  });
  if (changed.length) {
    keptInStepNotice(
      `${describeKeys(changed)} updated from ${device || 'a paired device'}. The earlier versions are kept in history.`,
    );
  }
  if (report.assistantsDeleted) {
    keptInStepNotice(
      `${describeAssistantDeletes(report.assistantsDeleted, device || 'a paired device')}.`,
    );
  }
  // Chats, only if mirroring is allowed here too.
  let send: unknown[] = [];
  let tombstones: unknown[] = [];
  if (chats && (await hostMirrorAllowed())) {
    const from = device || 'a paired device';
    // Chats deleted on the device: removed here unless changed here since
    // (kept under Recently deleted); too many at once: asked first.
    const del = await applyTombstones(
      await readAllChats(),
      chats.tombstones,
      from,
    );
    const known = await knownTombstones();
    const room =
      SYNC_ROOM -
      JSON.stringify(merged.items).length -
      JSON.stringify(known).length;
    const r = await mirrorOnPc(
      chats.sessions,
      chats.versions,
      Math.max(room, 0),
      {read: readAllChats, write: writeChats},
      {
        tombstones: known,
        hold: new Set(del.held.map(h => h.chat.session.id)),
        // A copy that drops messages here: the earlier version is kept.
        keep: (here, list) => keepEarlierVersions(here, list, from),
      },
    );
    await forgetTombstones(r.revived);
    send = r.send;
    tombstones = await knownTombstones();
    if (r.taken || del.deleted.length) {
      await require('../../store').chatSessionStore.loadSessionList();
    }
    if (del.deleted.length) {
      keptInStepNotice(`${describeDeletes(del.deleted.length, from)}.`);
    }
    if (del.held.length) {
      askAboutHeld(del.held, from, async () => {
        await require('../../store').chatSessionStore.loadSessionList();
      });
    }
  }
  return JSON.stringify({
    ok: true,
    items: merged.items,
    takenByPc: changed,
    chats: {sessions: send, tombstones},
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
  hostAnswersAllowed().then(allowed =>
    invoke('link_answers_allow', {allowed}).catch(() => {}),
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
