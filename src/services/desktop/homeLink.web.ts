/**
 * Home link (desktop app): a paired phone uses the model running on this PC
 * from anywhere. The native side does the work (src-tauri/src/link.rs):
 * end-to-end encrypted, off until switched on, pairing asks in a native
 * dialog, and phones reach only the model server.
 */
import {invoke} from '@tauri-apps/api/core';

import type {LinkPairing, LinkStatus} from './homeLink';

export type {LinkPairing, LinkPhone, LinkStatus} from './homeLink';

export const homeLinkAvailable = (): boolean =>
  !!(globalThis as any).__TAURI_INTERNALS__;

export const linkStatus = (): Promise<LinkStatus> => invoke('link_status');
export const linkPair = (): Promise<LinkPairing> => invoke('link_pair');
export const linkOn = (): Promise<void> => invoke('link_on');
export const linkOff = (): Promise<void> => invoke('link_off');
export const linkForget = (id: string): Promise<void> =>
  invoke('link_forget', {id});
