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
