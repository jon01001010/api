import {syncLoraOnContext} from '../syncLora';

const context = (loaded: Array<{path: string; scaled?: number}> = []) => {
  const ctx = {
    loaded,
    applyLoraAdapters: jest.fn(async (list: any[]) => {
      ctx.loaded = list;
    }),
    removeLoraAdapters: jest.fn(async () => {
      ctx.loaded = [];
    }),
    getLoadedLoraAdapters: jest.fn(async () => ctx.loaded),
    clearCache: jest.fn(async () => {}),
  };
  return ctx;
};

const LORA = '/data/files/models/lora/my-style.gguf';

it('applies the chosen adapter without reloading, and clears what was read', async () => {
  const ctx = context();
  expect(await syncLoraOnContext(ctx, {path: LORA, scale: 0.8})).toBe(true);
  expect(ctx.applyLoraAdapters).toHaveBeenCalledWith([
    {path: LORA, scaled: 0.8},
  ]);
  expect(ctx.removeLoraAdapters).not.toHaveBeenCalled();
  expect(ctx.clearCache).toHaveBeenCalledWith(false);
});

it('does nothing when the context already has it', async () => {
  const ctx = context([{path: `file://${LORA}`, scaled: 0.8}]);
  expect(await syncLoraOnContext(ctx, {path: LORA, scale: 0.8})).toBe(false);
  expect(ctx.applyLoraAdapters).not.toHaveBeenCalled();
  expect(ctx.clearCache).not.toHaveBeenCalled();
  expect(await syncLoraOnContext(context(), undefined)).toBe(false);
});

it('Off removes the adapter: back to the plain model at once', async () => {
  const ctx = context([{path: LORA, scaled: 1}]);
  expect(await syncLoraOnContext(ctx, undefined)).toBe(true);
  expect(ctx.removeLoraAdapters).toHaveBeenCalled();
  expect(ctx.applyLoraAdapters).not.toHaveBeenCalled();
  expect(ctx.loaded).toEqual([]);
});

it('switching versions or strength replaces the old adapter', async () => {
  const ctx = context([{path: LORA, scaled: 1}]);
  await syncLoraOnContext(ctx, {path: LORA, scale: 0.4});
  expect(ctx.removeLoraAdapters).toHaveBeenCalledTimes(1);
  expect(ctx.loaded).toEqual([{path: LORA, scaled: 0.4}]);
});

it('an adapter that does not fit leaves the plain model and says why', async () => {
  const ctx = context();
  ctx.applyLoraAdapters.mockRejectedValueOnce(new Error('does not match'));
  await expect(syncLoraOnContext(ctx, {path: LORA, scale: 1})).rejects.toThrow(
    'does not match',
  );
  expect(ctx.removeLoraAdapters).toHaveBeenCalled();
  expect(ctx.loaded).toEqual([]);
  expect(ctx.clearCache).toHaveBeenCalled();
});
