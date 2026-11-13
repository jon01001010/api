/**
 * The device side of keeping in step (a phone, or another PC, paired with a
 * home PC): send this device's items, take the agreed ones back. Off until
 * the user switches it on for that PC (and the PC allows it too).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {syncRawWithPc} from '../homeLink/homeLink';
import {
  applyItems,
  cleanItems,
  readItems,
  SYNC_KEYS,
  type SyncKey,
} from './promptSync';

const settingKey = (pc: string) => `@pocketagent/sync/with/${pc}`;

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
  | {ok: true; changedHere: SyncKey[]; changedOnPc: SyncKey[]}
  | {ok: false; error: string};

export async function syncWithPc(pc: string): Promise<SyncOutcome> {
  try {
    const items = await readItems();
    const answer = await syncRawWithPc(pc, JSON.stringify({items}));
    if (!answer.ok) {
      return {ok: false, error: answer.error};
    }
    const agreed = cleanItems(answer.items);
    if (!agreed.length) {
      return {ok: false, error: "The PC's answer had nothing in it"};
    }
    const changedHere = await applyItems(agreed);
    const changedOnPc = (answer.takenByPc ?? []).filter((k): k is SyncKey =>
      (SYNC_KEYS as string[]).includes(k),
    );
    return {ok: true, changedHere, changedOnPc};
  } catch (e) {
    return {ok: false, error: e instanceof Error ? e.message : String(e)};
  }
}
