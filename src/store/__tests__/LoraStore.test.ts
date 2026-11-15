import {
  clampScale,
  isPlainAdapterName,
  loraLabel,
  LoraAdapter,
  LoraStore,
} from '../LoraStore';

const adapter = (over: Partial<LoraAdapter> = {}): LoraAdapter => ({
  id: 'a1',
  name: 'my-style',
  fileName: 'my-style.gguf',
  size: 35_000_000,
  addedAt: '2026-11-15T08:00:00.000Z',
  modelId: 'qwen',
  ...over,
});

describe('LoraStore', () => {
  let store: LoraStore;
  beforeEach(() => {
    store = new LoraStore();
  });

  it('remembers one adapter per model with its strength; Off forgets it', () => {
    store.add(adapter());
    expect(store.activeFor('qwen')).toBeUndefined();
    expect(store.setChoice('qwen', 'a1', 0.8)).toBe(true);
    const active = store.activeFor('qwen')!;
    expect(active.adapter.name).toBe('my-style');
    expect(active.scale).toBe(0.8);
    expect(active.path).toMatch(/\/models\/lora\/my-style\.gguf$/);
    expect(loraLabel(active)).toBe('+ my-style (0.8)');
    // Changing the adapter keeps the strength.
    store.add(adapter({id: 'a2', name: 'v2', fileName: 'v2.gguf'}));
    store.setChoice('qwen', 'a2');
    expect(store.activeFor('qwen')!.scale).toBe(0.8);
    store.setChoice('qwen', null);
    expect(store.activeFor('qwen')).toBeUndefined();
    expect(store.choices).toEqual({});
  });

  it('keeps the choice in its persisted fields', () => {
    store.add(adapter());
    store.setChoice('qwen', 'a1', 0.5);
    // What mobx-persist-store saves: adapters, choices, pcModels.
    const saved = JSON.parse(
      JSON.stringify({adapters: store.adapters, choices: store.choices}),
    );
    const again = new LoraStore();
    again.adapters = saved.adapters;
    again.choices = saved.choices;
    expect(again.activeFor('qwen')!.scale).toBe(0.5);
  });

  it("never uses another model's adapter", () => {
    store.add(adapter());
    expect(store.setChoice('llama', 'a1')).toBe(false);
    expect(store.activeFor('llama')).toBeUndefined();
    // A tampered choice pointing at another model's adapter is ignored.
    store.choices.llama = {adapterId: 'a1', scale: 1};
    expect(store.activeFor('llama')).toBeUndefined();
  });

  it('dated versions: newest first; removing one turns its choice off', () => {
    store.add(
      adapter({id: 'old', fileName: 'old.gguf', addedAt: '2026-11-01'}),
    );
    store.add(
      adapter({id: 'new', fileName: 'new.gguf', addedAt: '2026-11-15'}),
    );
    expect(store.adaptersFor('qwen').map(a => a.id)).toEqual(['new', 'old']);
    store.setChoice('qwen', 'new');
    store.forget('new');
    expect(store.activeFor('qwen')).toBeUndefined();
    // Rollback: the older one is still there.
    store.setChoice('qwen', 'old');
    expect(store.activeFor('qwen')!.adapter.id).toBe('old');
  });

  it('strength stays between 0 and 1', () => {
    expect(clampScale(2)).toBe(1);
    expect(clampScale(-1)).toBe(0);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale('0.5')).toBe(1);
    expect(clampScale(0.333)).toBe(0.33);
  });

  it('only plain .gguf file names inside the adapters folder', () => {
    expect(isPlainAdapterName('my-style.gguf')).toBe(true);
    for (const bad of [
      '../x.gguf',
      'a/b.gguf',
      'a\\b.gguf',
      'C:x.gguf',
      'a,b.gguf',
      '.gguf',
      '.hidden.gguf',
      'x.bin',
    ]) {
      expect(isPlainAdapterName(bad)).toBe(false);
    }
    expect(() => store.add(adapter({fileName: '../evil.gguf'}))).toThrow();
  });

  it("desktop: a This PC model file follows its model's adapter", () => {
    store.add(adapter());
    store.setChoice('qwen', 'a1', 0.6);
    store.rememberPcModel('/pocketagent/Documents/models/q.gguf', 'qwen');
    expect(
      store.activeForPcModel('/pocketagent/Documents/models/q.gguf')!.scale,
    ).toBe(0.6);
    expect(store.activeForPcModel('/elsewhere.gguf')).toBeUndefined();
  });
});
