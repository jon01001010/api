import {
  BANNED_MODEL_NAMES,
  IMAGE_MODEL_SETS,
  downloadQuestion,
  setBytes,
} from '../imageModels';
import {isOwnPicture} from '../../talents/ImageTalentUI';

it('FLUX.2 klein 4B is the default; SD 1.5 is the small option', () => {
  expect(IMAGE_MODEL_SETS.map(s => s.id)).toEqual(['flux2-klein-4b', 'sd15']);
  expect(IMAGE_MODEL_SETS[0].licence).toBe('Apache-2.0');
});

it('never lists non-commercial models', () => {
  const text = JSON.stringify(IMAGE_MODEL_SETS).toLowerCase();
  for (const banned of BANNED_MODEL_NAMES) {
    expect([banned, text.includes(`/${banned}`)]).toEqual([banned, false]);
  }
});

it('every file is a plain name from https', () => {
  for (const set of IMAGE_MODEL_SETS) {
    for (const f of set.files) {
      expect(f.url.startsWith('https://')).toBe(true);
      expect(f.name).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(f.name).not.toContain('..');
    }
  }
});

it('shows size and licence (and use rules) before downloading', () => {
  const sd = IMAGE_MODEL_SETS.find(s => s.id === 'sd15')!;
  const q = downloadQuestion(sd);
  expect(q).toContain('about 2.1 GB');
  expect(q).toContain('OpenRAIL-M');
  expect(q).toContain('Use rules:');
  expect(q).toContain('minors');
  const flux = downloadQuestion(IMAGE_MODEL_SETS[0]);
  expect(flux).toContain(
    `about ${(setBytes(IMAGE_MODEL_SETS[0]) / 1e9).toFixed(1)} GB in 3 files`,
  );
  expect(flux).not.toContain('Use rules:');
});

it('the chat shows only pictures from the app’s own images folder', () => {
  expect(
    isOwnPicture(
      '/pocketagent/Documents/PocketAgentFiles/images/picture-20261115-101530-ab12.png',
    ),
  ).toBe(true);
  for (const bad of [
    '/pocketagent/Documents/secret.png',
    'C:/Users/u/x.png',
    '/pocketagent/Documents/PocketAgentFiles/images/../../x.png',
    '/pocketagent/Documents/PocketAgentFiles/images/picture-a.png.exe',
  ]) {
    expect([bad, isOwnPicture(bad)]).toEqual([bad, false]);
  }
});

describe('fitForCard', () => {
  const {fitForCard, IMAGE_MODEL_SETS} = require('../imageModels');
  const flux = IMAGE_MODEL_SETS.find((s: any) => s.id === 'flux2-klein-4b');
  const sd15 = IMAGE_MODEL_SETS.find((s: any) => s.id === 'sd15');
  const gtx745 = [{totalMemory: 4e9, shared: false}];
  it('says what suits a 4 GB card', () => {
    expect(fitForCard(sd15, gtx745)).toBe('fits');
    expect(fitForCard(flux, gtx745)).toBe('too-big');
  });
  it('is unknown without a dedicated card', () => {
    expect(fitForCard(sd15, undefined)).toBe('unknown');
    expect(fitForCard(sd15, [{totalMemory: 8e9, shared: true}])).toBe(
      'unknown',
    );
  });
});
