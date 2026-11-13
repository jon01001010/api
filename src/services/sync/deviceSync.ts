/**
 * The device side of keeping in step (a phone, or another PC, paired with a
 * home PC): send this device's items, take the agreed ones back. Off until
 * the user switches it on for that PC (and the PC allows it too).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {syncRawWithPc} from '../homeLink/homeLink';
import {
  cleanChats,
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
    }
  | {ok: false; error: string};

export async function syncWithPc(pc: string): Promise<SyncOutcome> {
  try {
    const items = await readItems();
    // Chats (only if mirrored): versions of all, and those changed since
    // the last sync with this PC, within the room left.
    let chats: {versions: unknown[]; sessions: unknown[]} | undefined;
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
      const room = SYNC_ROOM - JSON.stringify(items).length;
      chats = {
        versions: [...local.values()].map(versionOf),
        sessions: within(changed, Math.max(room, 0)),
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
    const changedHere = await applyItems(agreed);
    let chatsReceived = 0;
    if (mirror && chats) {
      const local = await readAllChats();
      const incoming = cleanChats((answer as any).chats?.sessions).filter(c => {
        const here = local.get(c.session.id);
        return !here || isNewer(versionOf(c), versionOf(here));
      });
      await writeChats(incoming);
      chatsReceived = incoming.length;
      // Remember what the PC now has: what was sent, and what came.
      for (const c of [...(chats.sessions as any[]), ...incoming]) {
        sentPrints[c.session.id] = versionOf(c).print;
      }
      await AsyncStorage.setItem(sentKey(pc), JSON.stringify(sentPrints));
      if (incoming.length) {
        await require('../../store').chatSessionStore.loadSessionList();
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
