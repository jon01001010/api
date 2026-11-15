/**
 * Home link, desktop side (src/services/desktop/homeLink.web.ts): lets a
 * paired phone use the model running on the PC from anywhere. On the phone
 * this file does nothing; the phone side is the PocketAgent app itself.
 */
export interface LinkPhone {
  id: string;
  name: string;
  /** May answer this PC's "Allow?" questions (missing: no). */
  mayAnswer?: boolean;
  /** May ask this PC for pictures (missing: no). */
  mayPicture?: boolean;
  /** May use this PC's read-only tools (missing: no). */
  mayRead?: boolean;
}

export interface LinkEvent {
  n: number;
  at: number;
  kind: string;
  name?: string;
}

export interface LinkStatus {
  on: boolean;
  /** "Let paired devices make pictures on this PC" (missing: off). */
  picturesAllowed?: boolean;
  /** "Let paired devices use this PC's tools" (missing: off). */
  toolsAllowed?: boolean;
  pcId: string | null;
  phones: LinkPhone[];
  /** Pairing history: codes made, phones paired / removed. */
  events?: LinkEvent[];
}

export interface LinkPairing {
  qr: string;
  qrImage: string;
  expiresInSecs: number;
}

export const homeLinkAvailable = (): boolean => false;

export async function linkStatus(): Promise<LinkStatus> {
  return {on: false, pcId: null, phones: [], events: []};
}

export async function linkPair(): Promise<LinkPairing> {
  throw new Error('Only in the desktop app.');
}

export async function linkOn(): Promise<void> {}
export async function linkOff(): Promise<void> {}
export async function linkForget(_id: string): Promise<void> {}
export async function linkDeviceMayAnswer(
  _id: string,
  _allowed: boolean,
): Promise<void> {}
export async function linkPicturesAllow(_allowed: boolean): Promise<void> {}
export async function linkDeviceMayPicture(
  _id: string,
  _allowed: boolean,
): Promise<void> {}
export async function linkToolsAllow(_allowed: boolean): Promise<void> {}
export async function linkDeviceMayRead(
  _id: string,
  _allowed: boolean,
): Promise<void> {}
