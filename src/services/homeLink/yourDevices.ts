/**
 * "Your devices" (device-circle stage 1, docs/design/device-circle.md): one
 * list of every device this one is paired with, in either direction:
 * devices that use this PC (paired here, kept natively by link.rs) and PCs
 * this device uses (the Home PC servers). One row per key, so a PC paired
 * both ways is one row once both use one key.
 *
 * Only reads what is already here: no network, and nothing in this list
 * gives a right (each right is switched on, and asked, on the device that
 * gives it). Removing here also tells your other devices (stage 2: a
 * removal notice signed by this device, circle.ts), which remove it too.
 */
import type {LinkPhone} from '../desktop/homeLink';
import type {ServerConfig} from '../../utils/types';

export interface YourDevice {
  /** The device's key (its iroh public key). */
  key: string;
  name: string;
  /** It uses this device: paired here (this PC gave it its model). */
  usesThis: boolean;
  /** This device uses it: a Home PC. */
  thisUses: boolean;
  /** When paired (ms since 1970), the earliest known; missing for
   * pairings made before this was kept. */
  pairedAt?: number;
  /** What this device has given it, per pair (empty: nothing). */
  rights: string[];
  /** The paired record here (its rights), when it uses this device. */
  phone?: LinkPhone;
  /** The Home PC servers for it on this device. */
  serverIds: string[];
}

/** The first characters of a key, enough to tell devices apart. */
export function shortKey(key: string): string {
  return key.length > 10 ? `${key.slice(0, 10)}…` : key;
}

/** What this PC gave a device that uses it, in the order shown. */
export function rightsGiven(phone: LinkPhone): string[] {
  return [
    'Model',
    phone.mayAnswer ? 'Answer questions' : '',
    phone.mayPicture ? 'Pictures' : '',
    phone.mayRead ? 'Read (tools)' : '',
    phone.mayAct ? 'Act (tools)' : '',
    phone.mayCommand ? 'Run commands' : '',
  ].filter(Boolean);
}

const earliest = (a?: number, b?: number) =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b);

export function listYourDevices(
  phones: LinkPhone[],
  servers: ServerConfig[],
): YourDevice[] {
  const rows = new Map<string, YourDevice>();
  for (const phone of phones) {
    rows.set(phone.id, {
      key: phone.id,
      name: phone.name,
      usesThis: true,
      thisUses: false,
      // The PC keeps seconds.
      pairedAt: phone.pairedAt ? phone.pairedAt * 1000 : undefined,
      rights: rightsGiven(phone),
      phone,
      serverIds: [],
    });
  }
  for (const server of servers) {
    const key = server.homeLinkPc;
    if (!key) {
      continue;
    }
    const row = rows.get(key);
    if (row) {
      row.thisUses = true;
      row.serverIds.push(server.id);
      row.pairedAt = earliest(row.pairedAt, server.homeLinkPairedAt);
      continue;
    }
    rows.set(key, {
      key,
      name: server.name,
      usesThis: false,
      thisUses: true,
      pairedAt: server.homeLinkPairedAt,
      rights: [],
      serverIds: [server.id],
    });
  }
  return [...rows.values()];
}

/** How the two are paired, in words. */
export function describeDirection(device: YourDevice): string {
  if (device.usesThis && device.thisUses) {
    return 'Both ways: it uses this device, and this device uses it';
  }
  return device.usesThis ? 'Uses this device' : 'This device uses it';
}

export function describePaired(device: YourDevice): string {
  return device.pairedAt
    ? `Paired ${new Date(device.pairedAt).toLocaleDateString()}`
    : 'Paired before dates were kept';
}

/** What this device gave it, in words (rights are per pair). */
export function describeRights(device: YourDevice): string {
  if (device.rights.length === 0) {
    return 'Given nothing by this device (what this device may do there is set on that device)';
  }
  return `May use here: ${device.rights.join(', ')}`;
}

/** Said before removing: here at once, then on your other devices. */
export function removeQuestion(device: YourDevice): string {
  const parts = [
    device.usesThis
      ? `"${device.name}" can no longer use this device (cut off now, and kept from pairing again for an hour).`
      : '',
    device.thisUses
      ? `This device stops using "${device.name}" (its Home PC entry and models here are removed).`
      : '',
    'Your other devices are told too, the next time they talk to this one (a notice signed by this device): each removes it as well and says so. A device that never talks to this one again is not told: remove it there by hand.',
  ];
  return parts.filter(Boolean).join('\n\n');
}
