import {modelStore, uiStore} from '../store';
import {ModelOrigin} from '../utils/types';

/**
 * What happened when a picture was about to be sent:
 * - `ready`: the loaded model can already see pictures.
 * - `switched`: switched to a vision model; the picture can be sent.
 * - `none`: no downloaded model can see pictures.
 * - `cancelled`: the switch didn't happen (e.g. memory warning declined).
 * - `remote`: the loaded model runs on a server; left as before.
 */
export type VisionSwitchResult =
  | 'ready'
  | 'switched'
  | 'none'
  | 'cancelled'
  | 'remote';

/**
 * Called before a message with pictures is sent. If the loaded model is
 * text-only, switch to a downloaded vision model so the picture is seen.
 * Uses the normal model loader, so its memory check still asks first.
 * On success it shows a notice with Undo (load the previous model again).
 */
export async function ensureVisionForPictures(): Promise<VisionSwitchResult> {
  if (modelStore.activeModelCaps.visionActive) {
    return 'ready';
  }
  if (modelStore.activeModel?.origin === ModelOrigin.REMOTE) {
    return 'remote';
  }
  const target = modelStore.pickVisionModel();
  if (!target) {
    return 'none';
  }
  const previousModelId = modelStore.activeModelId;
  try {
    await modelStore.initContext(target);
  } catch {
    return 'cancelled';
  }
  if (
    modelStore.activeModelId !== target.id ||
    !modelStore.activeModelCaps.visionActive
  ) {
    return 'cancelled';
  }
  uiStore.setVisionSwitchNotice({
    previousModelId,
    modelId: target.id,
    modelName: target.name,
  });
  return 'switched';
}

/** Undo: load the model that was active before the switch. */
export async function undoVisionSwitch(): Promise<void> {
  const notice = uiStore.visionSwitchNotice;
  uiStore.setVisionSwitchNotice(null);
  const previous = notice?.previousModelId
    ? modelStore.models.find(m => m.id === notice.previousModelId)
    : undefined;
  if (previous) {
    await modelStore.selectModel(previous);
  }
}
