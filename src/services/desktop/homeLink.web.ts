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
/** Letting a device answer is asked in a native dialog on this PC. */
export const linkDeviceMayAnswer = (
  id: string,
  allowed: boolean,
): Promise<void> => invoke('link_device_may_answer', {id, allowed});
/** The PC's switch for pictures (kept natively; each device asked too). */
export const linkPicturesAllow = (allowed: boolean): Promise<void> =>
  invoke('link_pictures_allow', {allowed});
/** Letting a device make pictures is asked in a native dialog on this PC. */
export const linkDeviceMayPicture = (
  id: string,
  allowed: boolean,
): Promise<void> => invoke('link_device_may_picture', {id, allowed});
/** The PC's switch for device tools (kept natively; each device asked too). */
export const linkToolsAllow = (allowed: boolean): Promise<void> =>
  invoke('link_tools_allow', {allowed});
/** Letting a device use this PC's tools is asked in a native dialog here. */
export const linkDeviceMayRead = (
  id: string,
  allowed: boolean,
): Promise<void> => invoke('link_device_may_read', {id, allowed});
/** Letting a device ask this PC to act is asked in a native dialog here. */
export const linkDeviceMayAct = (id: string, allowed: boolean): Promise<void> =>
  invoke('link_device_may_act', {id, allowed});
