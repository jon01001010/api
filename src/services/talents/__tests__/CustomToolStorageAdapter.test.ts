import {
  createCustomToolStorage,
  CUSTOM_TOOL_STORAGE_KEY,
} from '../CustomToolStorageAdapter';

describe('custom tool storage adapter', () => {
  it('uses a dedicated namespace and round-trips serialized data', async () => {
    const values = new Map<string, string>();
    const store = createCustomToolStorage({
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => { values.set(key, value); },
    });
    expect(await store.read()).toBeNull();
    await store.write('{"version":1,"tools":[]}');
    expect(values.get(CUSTOM_TOOL_STORAGE_KEY)).toBe('{"version":1,"tools":[]}');
    expect(await store.read()).toBe('{"version":1,"tools":[]}');
  });

  it('propagates failed writes without claiming persistence', async () => {
    const store = createCustomToolStorage({
      getItem: async () => null,
      setItem: async () => { throw new Error('storage unavailable'); },
    });
    await expect(store.write('{}')).rejects.toThrow('storage unavailable');
  });
});
