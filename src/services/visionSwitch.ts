import {modelStore, uiStore} from '../store';
import {runInAction} from 'mobx';
import {ModelOrigin} from '../utils/types';

/**
 * What happened when a picture was about to be sent:
 * - `ready`: the loaded model can already see pictures.
 * - `switched`: switched to a vision model; the picture can be sent.
 * - `none`: no local or cloud model can see pictures.
 * - `cancelled`: the switch didn't happen (e.g. memory warning declined).
 * - `remote`: kept for callers; no longer returned (cloud models switch too).
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
  // A local vision model first; only when there is none, a cloud one.
  const target = modelStore.pickVisionTarget();
  if (!target) {
    return 'none';
  }
  // A local vision model with its projector but the Vision switch off: the
  // picture is a clear ask, so turn it on (as the card's switch would).
  const switchedOff =
    target.origin !== ModelOrigin.REMOTE &&
    !modelStore.getModelVisionPreference(target);
  if (switchedOff) {
    await modelStore.setModelVisionEnabled(target.id, true).catch(() => {});
  }
  if (target.id === modelStore.activeModelId) {
    if (!switchedOff) {
      return 'none';
    }
    // Already loaded without vision: turning it on may have reloaded it;
    // if not, load it again, now with vision.
    if (modelStore.activeModelCaps.visionActive) {
      return 'ready';
    }
    try {
      await modelStore.releaseContext();
      await modelStore.initContext(target);
    } catch {
      return 'cancelled';
    }
    return modelStore.activeModelCaps.visionActive ? 'ready' : 'cancelled';
  }
  const previousModelId = modelStore.activeModelId;
  try {
    await modelStore.selectModel(target);
  } catch {
    return 'cancelled';
  }
  if (
    modelStore.activeModelId !== target.id ||
    !modelStore.activeModelCaps.visionActive
  ) {
    return 'cancelled';
  }
  runInAction(() => {
    modelStore.lastVisionModelId = target.id;
  });
  uiStore.setVisionSwitchNotice({
    previousModelId,
    modelId: target.id,
    modelName: target.name,
  });
  pendingReturn = previousModelId
    ? {previousModelId, visionModelId: target.id}
    : null;
  return 'switched';
}

/** A model by id, local or cloud. */
const findModel = (id: string | undefined) =>
  id
    ? (modelStore.models.find(m => m.id === id) ??
      modelStore.remoteModels.find(m => m.id === id))
    : undefined;

/**
 * The model to go back to once the picture has been answered. Kept here,
 * not in the notice, because the notice can time out before the reply ends.
 */
let pendingReturn: {previousModelId: string; visionModelId: string} | null =
  null;

/**
 * After the reply to a picture: load the model that was active before the
 * switch. Does nothing if the user already changed model (or tapped Undo).
 */
export async function returnFromVision(): Promise<void> {
  const pending = pendingReturn;
  pendingReturn = null;
  if (!pending || modelStore.activeModelId !== pending.visionModelId) {
    return;
  }
  const previous = findModel(pending.previousModelId);
  if (!previous) {
    return;
  }
  uiStore.setVisionSwitchNotice(null);
  await modelStore.selectModel(previous);
}

/** Undo: load the model that was active before the switch. */
export async function undoVisionSwitch(): Promise<void> {
  pendingReturn = null;
  const notice = uiStore.visionSwitchNotice;
  uiStore.setVisionSwitchNotice(null);
  const previous = findModel(notice?.previousModelId);
  if (previous) {
    await modelStore.selectModel(previous);
  }
}
