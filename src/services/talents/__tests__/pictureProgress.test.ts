/**
 * The line shown while the PC makes a picture (image-progress events from
 * src-tauri/src/image_gen.rs).
 */
import {CHAT_ON_CARD_HINT, pictureProgressText} from '../pictureProgress';

const at = (p: object) =>
  pictureProgressText({id: 'x', step: 0, steps: 20, seconds: null, ...p});

it('says what the picture maker is doing, step by step', () => {
  expect(at({phase: 'loading'})).toBe('Loading the model…');
  expect(at({phase: 'sampling'})).toBe('Making the picture…');
  expect(at({phase: 'sampling', step: 7})).toBe(
    'Making the picture… step 7 of 20',
  );
  expect(at({phase: 'sampling', step: 7, seconds: 39})).toBe(
    'Making the picture… step 7 of 20, about 40 s left',
  );
  expect(at({phase: 'sampling', step: 2, seconds: 2})).toBe(
    'Making the picture… step 2 of 20, about 2 s left',
  );
  expect(at({phase: 'sampling', step: 1, seconds: 150})).toBe(
    'Making the picture… step 1 of 20, about 3 min left',
  );
  expect(at({phase: 'sampling', step: 20, seconds: 0})).toBe(
    'Making the picture… step 20 of 20',
  );
  expect(at({phase: 'decoding', step: 20})).toBe('Finishing…');
  expect(at({phase: 'saving', step: 20})).toBe('Finishing…');
});

it('hints once, until the first step, that the chat model shares the card', () => {
  expect(at({phase: 'loading', chatOnCard: true})).toBe(
    `Loading the model… ${CHAT_ON_CARD_HINT}`,
  );
  expect(at({phase: 'sampling', chatOnCard: true})).toBe(
    `Making the picture… ${CHAT_ON_CARD_HINT}`,
  );
  expect(at({phase: 'sampling', step: 1, chatOnCard: true})).toBe(
    'Making the picture… step 1 of 20',
  );
  expect(at({phase: 'loading', chatOnCard: false})).toBe('Loading the model…');
  expect(CHAT_ON_CARD_HINT).toMatch(/Unloading it makes pictures faster/);
});

it('ignores anything malformed', () => {
  expect(at({phase: 'something'})).toBeNull();
  expect(pictureProgressText({} as any)).toBeNull();
  expect(pictureProgressText(null as any)).toBeNull();
  expect(at({phase: 'sampling', step: 30, steps: 20})).toBe(
    'Making the picture…',
  );
  expect(at({phase: 'sampling', step: 3, seconds: 'soon'})).toBe(
    'Making the picture… step 3 of 20',
  );
});
