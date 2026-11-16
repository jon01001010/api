/**
 * The picture maker's `image-progress` events (src-tauri/src/image_gen.rs):
 * a phase word and step numbers, sent a few times a second while a
 * picture is made on this PC.
 */
import {listen} from '@tauri-apps/api/event';

import type {PictureProgress} from './pictureProgress';

export async function onPictureProgress(
  handler: (progress: PictureProgress) => void,
): Promise<() => void> {
  try {
    return await listen<PictureProgress>('image-progress', e =>
      handler(e.payload),
    );
  } catch {
    return () => {};
  }
}
