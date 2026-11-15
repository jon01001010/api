/**
 * Puts a phone model's context in step with its chosen LoRA adapter, without
 * reloading the model (llama.rn's applyLoraAdapters / removeLoraAdapters).
 * No store imports, so ModelStore can use it.
 */

export interface LoraContext {
  applyLoraAdapters(
    list: Array<{path: string; scaled?: number}>,
  ): Promise<void>;
  removeLoraAdapters(): Promise<void>;
  getLoadedLoraAdapters(): Promise<Array<{path: string; scaled?: number}>>;
  clearCache?(clearData?: boolean): Promise<void>;
}

const plain = (path: string) => path.replace(/^file:\/\//, '');

/**
 * Wanted: the adapter file and strength, or undefined for the plain model.
 * Returns true when something changed. If the adapter can't be applied (made
 * for another model, broken file), the plain model is restored and the error
 * is thrown so the screen can say so.
 */
export async function syncLoraOnContext(
  ctx: LoraContext,
  wanted?: {path: string; scale: number},
): Promise<boolean> {
  let loaded: Array<{path: string; scaled?: number}> = [];
  try {
    loaded = (await ctx.getLoadedLoraAdapters()) ?? [];
  } catch {
    loaded = [];
  }
  const same = wanted
    ? loaded.length === 1 &&
      plain(loaded[0].path) === plain(wanted.path) &&
      Math.abs((loaded[0].scaled ?? 1) - wanted.scale) < 0.001
    : loaded.length === 0;
  if (same) {
    return false;
  }
  if (loaded.length > 0) {
    await ctx.removeLoraAdapters();
  }
  try {
    if (wanted) {
      await ctx.applyLoraAdapters([
        {path: plain(wanted.path), scaled: wanted.scale},
      ]);
    }
  } catch (error) {
    await ctx.removeLoraAdapters().catch(() => {});
    throw error;
  } finally {
    // What the model had read so far was read with the other weights.
    await ctx.clearCache?.(false).catch(() => {});
  }
  return true;
}
