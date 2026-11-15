/**
 * The device side of keeping in step (a phone, or another PC, paired with a
 * home PC): send this device's items, take the agreed ones back. Off until
 * the user switches it on for that PC (and the PC allows it too).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {syncRawWithPc} from '../homeLink/homeLink';
import {
  applyTombstones,
  askAboutHeld,
  forgetTombstones,
  keepEarlierVersions,
  knownTombstones,
} from './chatDeletes';
import {
  cleanChats,
  deletedBy,
  isNewer,
  readAllChats,
  SYNC_ROOM,
  versionOf,
  within,
  writeChats,
} from './chatSync';
import {
  applyItems,
  cleanItems,
  readItems,
  SYNC_KEYS,
  type SyncKey,
} from './promptSync';

const settingKey = (pc: string) => `@pocketagent/sync/with/${pc}`;
const mirrorKey = (pc: string) => `@pocketagent/sync/chats-with/${pc}`;
const sentKey = (pc: string) => `@pocketagent/sync/chats-sent/${pc}`;

/** Mirror chats with this PC (its own switch: chats are more private). */
export async function mirrorChatsOn(pc: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(mirrorKey(pc))) === 'on';
  } catch {
    return false;
  }
}

export async function setMirrorChats(pc: string, on: boolean): Promise<void> {
  await AsyncStorage.setItem(mirrorKey(pc), on ? 'on' : 'off');
}

/** These chats changed here outside a sync: send them again next time. */
async function forgetSent(pc: string, ids: string[]): Promise<void> {
  try {
    const sent = JSON.parse((await AsyncStorage.getItem(sentKey(pc))) || '{}');
    for (const id of ids) {
      delete sent[id];
    }
    await AsyncStorage.setItem(sentKey(pc), JSON.stringify(sent));
  } catch {
    // Next sync sends what changed since; at worst it comes later.
  }
}

export async function syncWithPcOn(pc: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(settingKey(pc))) === 'on';
  } catch {
    return false;
  }
}

export async function setSyncWithPc(pc: string, on: boolean): Promise<void> {
  await AsyncStorage.setItem(settingKey(pc), on ? 'on' : 'off');
}

export type SyncOutcome =
  | {
      ok: true;
      changedHere: SyncKey[];
      changedOnPc: SyncKey[];
      chatsSent?: number;
      chatsReceived?: number;
      /** Chats deleted on the PC, removed here (kept under Recently deleted). */
      chatsDeleted?: number;
      /** Deletions from the PC waiting for the user's answer (too many). */
      chatsHeld?: number;
      /** Assistants deleted on the PC, removed here (kept under Recently deleted). */
      assistantsDeleted?: number;
      /** Assistant deletions from the PC waiting for the user's answer. */
      assistantsHeld?: number;
    }
  | {ok: false; error: string};

export async function syncWithPc(pc: string): Promise<SyncOutcome> {
  try {
    const items = await readItems();
    // Chats (only if mirrored): versions of all, and those changed since
    // the last sync with this PC, within the room left.
    let chats:
      | {versions: unknown[]; sessions: unknown[]; tombstones: unknown[]}
      | undefined;
    let sentPrints: Record<string, string> = {};
    const mirror = await mirrorChatsOn(pc);
    if (mirror) {
      const local = await readAllChats();
      try {
        sentPrints = JSON.parse(
          (await AsyncStorage.getItem(sentKey(pc))) || '{}',
        );
      } catch {
        sentPrints = {};
      }
      const changed = [...local.values()].filter(
        c => sentPrints[c.session.id] !== versionOf(c).print,
      );
      // Chats deleted here travel too (tombstones: id and when).
      const tombstones = await knownTombstones();
      const room =
        SYNC_ROOM -
        JSON.stringify(items).length -
        JSON.stringify(tombstones).length;
      chats = {
        versions: [...local.values()].map(versionOf),
        sessions: within(changed, Math.max(room, 0)),
        tombstones,
      };
    }
    const answer = await syncRawWithPc(pc, JSON.stringify({items, chats}));
    if (!answer.ok) {
      return {ok: false, error: answer.error};
    }
    const agreed = cleanItems(answer.items);
    if (!agreed.length) {
      return {ok: false, error: "The PC's answer had nothing in it"};
    }
    const report = {assistantsDeleted: 0, assistantsHeld: 0};
    const changedHere = await applyItems(agreed, Date.now(), {
      from: 'the PC',
      report,
    });
    let chatsReceived = 0;
    let chatsDeleted = 0;
    let chatsHeld = 0;
    if (mirror && chats) {
      let local = await readAllChats();
      // Chats deleted on the PC: removed here unless changed here since
      // (kept under Recently deleted); too many at once: asked first.
      const del = await applyTombstones(
        local,
        (answer as any).chats?.tombstones,
        'the PC',
      );
      chatsDeleted = del.deleted.length;
      chatsHeld = del.held.length;
      if (chatsDeleted) {
        local = await readAllChats();
      }
      const hold = new Set(del.held.map(h => h.chat.session.id));
      const gone = new Map(
        (await knownTombstones()).map(t => [t.id, t.deletedAt] as const),
      );
      const newer = cleanChats((answer as any).chats?.sessions).filter(c => {
        const v = versionOf(c);
        if (hold.has(c.session.id) || deletedBy(v, gone)) {
          return false;
        }
        const here = local.get(c.session.id);
        return !here || isNewer(v, versionOf(here));
      });
      // A copy that drops messages here: the earlier version is kept.
      const incoming = await keepEarlierVersions(local, newer, 'the PC');
      await writeChats(incoming);
      chatsReceived = incoming.length;
      // A chat deleted here but changed on the PC since: it is back.
      await forgetTombstones(
        incoming.map(c => c.session.id).filter(id => gone.has(id)),
      );
      // Remember what the PC now has: what was sent, and what came. A chat
      // removed here is sent again if it is restored; one that outlived the
      // PC's deletion (changed here since) is sent again next time.
      for (const c of [...(chats.sessions as any[]), ...incoming]) {
        sentPrints[c.session.id] = versionOf(c).print;
      }
      for (const id of [...del.deleted, ...del.survived]) {
        delete sentPrints[id];
      }
      await AsyncStorage.setItem(sentKey(pc), JSON.stringify(sentPrints));
      if (incoming.length || chatsDeleted) {
        await require('../../store').chatSessionStore.loadSessionList();
      }
      if (del.held.length) {
        askAboutHeld(del.held, 'the PC', async r => {
          await forgetSent(pc, [...r.deleted, ...r.kept]);
          await require('../../store').chatSessionStore.loadSessionList();
        });
      }
    }
    const changedOnPc = (answer.takenByPc ?? []).filter((k): k is SyncKey =>
      (SYNC_KEYS as string[]).includes(k),
    );
    return {
      ok: true,
      changedHere,
      changedOnPc,
      chatsSent: chats?.sessions.length ?? 0,
      chatsReceived,
      ...(mirror ? {chatsDeleted, chatsHeld} : {}),
      ...(report.assistantsDeleted
        ? {assistantsDeleted: report.assistantsDeleted}
        : {}),
      ...(report.assistantsHeld ? {assistantsHeld: report.assistantsHeld} : {}),
    };
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}

let mirrorTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * After a reply: if the chat's model is a Home PC whose chats are mirrored,
 * sync with it a moment later (several replies in a row: one sync).
 */
export function mirrorAfterReply(): void {
  try {
    const {modelStore, serverStore} = require('../../store');
    const serverId = modelStore.activeModel?.serverId;
    const pc = serverStore.servers.find(
      (s: any) => s.id === serverId,
    )?.homeLinkPc;
    if (!pc) {
      return;
    }
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(async () => {
      if (await mirrorChatsOn(pc)) {
        await syncWithPc(pc);
      }
    }, 2000);
  } catch {
    // Mirroring is a courtesy; a chat never fails because of it.
  }
}
