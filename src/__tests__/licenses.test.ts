/**
 * The open-source licences screen (App Info) must list what the apps
 * actually ship. If this fails after adding or updating a library, run:
 *
 *   node scripts/licenses/generate.js
 *
 * and commit src/assets/licenses/third-party.json with the change.
 */
import {
  shippedHere,
  sourceLink,
  textsFor,
} from '../screens/AboutScreen/LicensesModal';

const {INPUTS, fingerprint} = require('../../scripts/licenses/generate');
const data = require('../assets/licenses/third-party.json');

describe('open-source licences', () => {
  it('is up to date with the dependency lists', () => {
    const stale = INPUTS.filter(
      (file: string) => data.inputs[file] !== fingerprint(file),
    );
    expect(stale).toEqual([]);
  });

  it('every library has its licence text', () => {
    const without = data.packages.filter(
      (p: any) => textsFor(data, p).length === 0,
    );
    expect(without.map((p: any) => `${p.n}@${p.v}`)).toEqual([]);
    expect(
      data.packages
        .filter((p: any) => /unknown/i.test(p.l))
        .map((p: any) => p.n),
    ).toEqual([]);
  });

  it('credits PocketPal AI, llama.cpp and the fonts', () => {
    const pocketpal = data.packages.find((p: any) => p.n === 'PocketPal AI');
    expect(pocketpal.c).toContain('Copyright (c) 2024 Asghar Ghorbani');
    const names = data.packages.map((p: any) => p.n);
    for (const name of [
      'llama.cpp (model runner)',
      'Inter',
      'Fraunces',
      'JetBrains Mono',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('credits the llama.cpp the desktop builds download (its licence moves with each update)', () => {
    const fs = require('fs');
    const path = require('path');
    const llama = data.packages.find(
      (p: any) => p.n === 'llama.cpp (model runner)',
    );
    const dir = path.join(__dirname, '..', '..', '.github', 'workflows');
    const pins = fs
      .readdirSync(dir)
      .map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .map((text: string) => /^\s*LLAMA_TAG:\s*(\S+)/m.exec(text)?.[1])
      .filter(Boolean);
    expect(pins.length).toBeGreaterThan(0);
    // Update scripts/licenses/generate.js (and the licence text in
    // src/assets/licenses/native/) when the pinned llama.cpp changes.
    expect([...new Set(pins)]).toEqual([llama.v]);
  });

  it('shows the phone what the phone ships, the desktop what the desktop ships', () => {
    const phone = shippedHere(data.packages, 'android');
    const desktop = shippedHere(data.packages, 'web');
    expect(phone.some((p: any) => p.s === 'desktop')).toBe(false);
    expect(phone.some((p: any) => p.s === 'phone-native')).toBe(true);
    expect(desktop.some((p: any) => p.s === 'phone-native')).toBe(false);
    expect(desktop.some((p: any) => p.n === 'tauri')).toBe(true);
    expect(desktop.some((p: any) => p.n === 'iroh')).toBe(true);
  });

  it('links each library to its source', () => {
    const tauri = data.packages.find((p: any) => p.n === 'tauri');
    expect(sourceLink(tauri)).toBe(`https://crates.io/crates/tauri/${tauri.v}`);
    const react = data.packages.find(
      (p: any) => p.n === 'react' && p.s === 'app',
    );
    expect(sourceLink(react)).toBe(
      `https://www.npmjs.com/package/react/v/${react.v}`,
    );
  });
});
