import {
  describeDirection,
  describePaired,
  describeRights,
  listYourDevices,
  removeQuestion,
  rightsGiven,
  shortKey,
} from '../yourDevices';
import type {ServerConfig} from '../../../utils/types';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const server = (id: string, pc?: string, pairedAt?: number): ServerConfig => ({
  id,
  name: 'Home PC',
  url: 'http://127.0.0.1:1',
  ...(pc && {homeLinkPc: pc}),
  ...(pairedAt && {homeLinkPairedAt: pairedAt}),
});

describe('Your devices: one list, either way', () => {
  it('lists devices that use this one and PCs this one uses, one row per key', () => {
    const rows = listYourDevices(
      [
        {id: A, name: 'Pixel', pairedAt: 1_763_200_000},
        {id: B, name: 'Laptop', mayAnswer: true, pairedAt: 1_763_300_000},
      ],
      [server('s1', B, 1_763_100_000_000), server('s2', C), server('plain')],
    );
    expect(rows.map(r => [r.key, r.usesThis, r.thisUses])).toEqual([
      [A, true, false],
      [B, true, true],
      [C, false, true],
    ]);
    // Paired both ways (one key per PC): one row, its name from this PC's
    // list, the earliest pairing date, its server kept for removing.
    const laptop = rows[1];
    expect(laptop.name).toBe('Laptop');
    expect(laptop.pairedAt).toBe(1_763_100_000_000);
    expect(laptop.serverIds).toEqual(['s1']);
    expect(describeDirection(laptop)).toMatch(/^Both ways/);
    expect(describeDirection(rows[0])).toBe('Uses this device');
    expect(describeDirection(rows[2])).toBe('This device uses it');
    // The PC keeps seconds; shown as a date.
    expect(rows[0].pairedAt).toBe(1_763_200_000_000);
    expect(describePaired(rows[2])).toBe('Paired before dates were kept');
  });

  it('shows only the rights this device gave, per pair; off unless given', () => {
    expect(rightsGiven({id: A, name: 'Pixel'})).toEqual(['Model']);
    expect(
      rightsGiven({
        id: A,
        name: 'Pixel',
        mayAnswer: true,
        mayPicture: true,
        mayRead: true,
        mayAct: true,
        mayCommand: true,
      }),
    ).toEqual([
      'Model',
      'Answer questions',
      'Pictures',
      'Read (tools)',
      'Act (tools)',
      'Run commands',
    ]);
    const [pixel, desktop] = listYourDevices(
      [{id: A, name: 'Pixel', mayRead: true}],
      [server('s', C)],
    );
    expect(describeRights(pixel)).toBe('May use here: Model, Read (tools)');
    // A PC this device only uses was given nothing here.
    expect(desktop.rights).toEqual([]);
    expect(describeRights(desktop)).toMatch(/^Given nothing by this device/);
  });

  it('says removing here tells the other devices too', () => {
    const [both] = listYourDevices([{id: B, name: 'Laptop'}], [server('s', B)]);
    const q = removeQuestion(both);
    expect(q).toContain('can no longer use this device');
    expect(q).toContain('stops using "Laptop"');
    expect(q).toContain('Your other devices are told too');
    expect(q).not.toContain('Removed on this device only');
    const [usedOnly] = listYourDevices([], [server('s', C)]);
    expect(removeQuestion(usedOnly)).not.toContain('can no longer use');
  });

  it('shortens keys', () => {
    expect(shortKey(A)).toBe('aaaaaaaaaa…');
    expect(shortKey('abc')).toBe('abc');
  });
});
