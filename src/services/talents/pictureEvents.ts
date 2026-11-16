/**
 * The PC's `image-progress` events (pictureEvents.web.ts in the desktop
 * app). The phone makes no pictures itself: nothing to listen to.
 */
import type {PictureProgress} from './pictureProgress';

export async function onPictureProgress(
  _handler: (progress: PictureProgress) => void,
): Promise<() => void> {
  return () => {};
}
