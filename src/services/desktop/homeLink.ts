/**
 * Home link, desktop side (src/services/desktop/homeLink.web.ts): lets a
 * paired phone use the model running on the PC from anywhere. On the phone
 * this file does nothing; the phone side is the PocketAgent app itself.
 */
export interface LinkPhone {
  id: string;
  name: string;
}

export interface LinkStatus {
  on: boolean;
  pcId: string | null;
  phones: LinkPhone[];
}

export interface LinkPairing {
  qr: string;
  qrImage: string;
  expiresInSecs: number;
}

export const homeLinkAvailable = (): boolean => false;

export async function linkStatus(): Promise<LinkStatus> {
  return {on: false, pcId: null, phones: []};
}

export async function linkPair(): Promise<LinkPairing> {
  throw new Error('Only in the desktop app.');
}

export async function linkOn(): Promise<void> {}
export async function linkOff(): Promise<void> {}
export async function linkForget(_id: string): Promise<void> {}
