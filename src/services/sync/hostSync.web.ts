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
import {describeLoopReport, type LoopReport} from './loopSync';
import {mirrorOnPc, readAllChats, SYNC_ROOM, writeChats} from './chatSync';
import {appUnlockedNow} from '../appLock/appLock';

import {
  applyItems,
  cleanItems,
  describeKeys,
  holdForAnswer,
  loadPeer,
  merge,
  movePeerOnce,
  readItems,
  rememberSync,
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

/**
 * The answer while DesktopAgent is locked (app PIN): nothing is merged,
 * written, asked or shown; the device tries again later (security review
 * 2, 2026-11-18).
 */
export const LOCKED_ANSWER =
  'DesktopAgent is locked; keeping in step waits until it is unlocked. Try again later.';

/** A device's public key as the link gives it (plain characters only). */
export function cleanDeviceKey(key: unknown): string | undefined {
  return typeof key === 'string' && /^[A-Za-z0-9_+/=:.-]{8,200}$/.test(key)
    ? key
    : undefined;
}

/** One sync from a paired device: merge, write here, answer (exported for tests). */
export async function answerSync(
  body: string,
  device: string,
  /** The device's public key (the link's id for it), when the link gives it. */
  deviceKey?: string,
): Promise<string> {
  if (!appUnlockedNow()) {
    return JSON.stringify({ok: false, error: LOCKED_ANSWER});
  }
  let remote: unknown;
  let chats: any;
  try {
    const parsed = JSON.parse(body);
    remote = parsed?.items;
    chats = parsed?.chats;
  } catch {
    return JSON.stringify({ok: false, error: 'Not readable'});
  }
  const from = device || 'a paired device';
  // Known by its public key (names can repeat or change; security review
  // 2, 2026-11-18); what was kept under its name moves over once. Without
  // a key from the link: by name, as before.
  const key = cleanDeviceKey(deviceKey);
  const peer = key ? `key:${key}` : `device:${from}`;
  if (key) {
    await movePeerOnce(`device:${from}`, peer);
  }
  const local = await readItems();
  const now = Date.now();
  const received = cleanItems(remote);
  const merged = merge(local, received, await loadPeer(peer));
  const report: {
    assistantsDeleted: number;
    assistantsHeld: number;
  } & LoopReport = {assistantsDeleted: 0, assistantsHeld: 0};
  // A new system prompt or "your memory" notes from a device: asked first
  // (review 2026-11-17); the device is answered at once with its own for
  // those (nothing decided yet: it keeps its own), and they are taken here
  // later, on yes.
  const wins = merged.items.filter(i => merged.takenHere.includes(i.key));
  const takeNow = await holdForAnswer(
    wins,
    from,
    async item => {
      const later = await applyItems([item], Date.now(), {from});
      if (later.length) {
        keptInStepNotice(
          `${describeKeys(later)} updated from ${from}. The earlier versions are kept in history.`,
        );
      }
    },
    peer,
  );
  const held = new Set(wins.filter(i => !takeNow.includes(i)).map(i => i.key));
  const agreed = merged.items.map(i =>
    held.has(i.key) ? (received.find(r => r.key === i.key) ?? i) : i,
  );
  const changed = await applyItems(
    agreed.filter(i => !held.has(i.key)),
    now,
    {from, report},
  );
  await rememberSync(peer, received, now);
  if (changed.length) {
    keptInStepNotice(
      `${describeKeys(changed)} updated from ${from}. The earlier versions are kept in history.`,
    );
  }
  if (report.assistantsDeleted) {
    keptInStepNotice(
      `${describeAssistantDeletes(report.assistantsDeleted, device || 'a paired device')}.`,
    );
  }
  // Loops arrive paused and not started: say where to start them.
  for (const line of describeLoopReport(report, device || 'a paired device')) {
    keptInStepNotice(`${line}.`);
  }
  // Chats, only if mirroring is allowed here too.
  let send: unknown[] = [];
  let tombstones: unknown[] = [];
  if (chats && (await hostMirrorAllowed())) {
    // Chats deleted on the device: removed here unless changed here since
    // (kept under Recently deleted); too many at once: asked first.
    const del = await applyTombstones(
      await readAllChats(),
      chats.tombstones,
      from,
    );
    const known = await knownTombstones();
    const room =
      SYNC_ROOM - JSON.stringify(agreed).length - JSON.stringify(known).length;
    const r = await mirrorOnPc(
      chats.sessions,
      chats.versions,
      Math.max(room, 0),
      // Marked as mirrored (not searched as typed here: pastChats.ts).
      {read: readAllChats, write: list => writeChats(list, {from})},
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
    items: agreed,
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
  listen<{
    id: number;
    device: string;
    body: string;
    key?: string;
    deviceKey?: string;
  }>('link-sync', async e => {
    const {id, device, body} = e.payload;
    let reply: string;
    try {
      reply = await answerSync(
        body,
        device,
        e.payload.key ?? e.payload.deviceKey,
      );
    } catch (err) {
      reply = JSON.stringify({ok: false, error: String(err)});
    }
    invoke('link_sync_reply', {id, body: reply}).catch(() => {});
  }).catch(() => {});
}
