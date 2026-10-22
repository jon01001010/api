/**
 * Persistence boundary for approved PocketAgent custom tools.
 *
 * Storage is not an authorization decision: callers must validate and approve
 * tools before registering them for an individual Pal.
 */
export interface StringKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface CustomToolStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export const CUSTOM_TOOL_STORAGE_KEY = 'pocketagent.custom_tools.v1';

export function createCustomToolStorage(
  store: StringKeyValueStore,
): CustomToolStorage {
  return {
    read: () => store.getItem(CUSTOM_TOOL_STORAGE_KEY),
    write: value => store.setItem(CUSTOM_TOOL_STORAGE_KEY, value),
  };
}
