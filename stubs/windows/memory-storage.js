/**
 * AsyncStorage on Windows, kept in memory: its Windows code is old-style and
 * can't be built on react-native-windows 0.82. Settings work while the app is
 * open and are lost when it closes (TODO: the Windows storage module).
 */
const store = new Map();
const get = async key => (store.has(key) ? store.get(key) : null);
const set = async (key, value) => {
  store.set(key, String(value));
};
const merge = async (key, value) => {
  const current = store.has(key) ? JSON.parse(store.get(key)) : {};
  store.set(key, JSON.stringify({...current, ...JSON.parse(value)}));
};

const AsyncStorage = {
  getItem: get,
  setItem: set,
  mergeItem: merge,
  removeItem: async key => {
    store.delete(key);
  },
  clear: async () => {
    store.clear();
  },
  getAllKeys: async () => [...store.keys()],
  multiGet: async keys => Promise.all(keys.map(async k => [k, await get(k)])),
  multiSet: async pairs => {
    for (const [k, v] of pairs) {
      await set(k, v);
    }
  },
  multiMerge: async pairs => {
    for (const [k, v] of pairs) {
      await merge(k, v);
    }
  },
  multiRemove: async keys => {
    keys.forEach(k => store.delete(k));
  },
  flushGetRequests: () => {},
};

module.exports = {
  __esModule: true,
  default: AsyncStorage,
  ...AsyncStorage,
  useAsyncStorage: key => ({
    getItem: () => get(key),
    setItem: value => set(key, value),
    mergeItem: value => merge(key, value),
    removeItem: () => AsyncStorage.removeItem(key),
  }),
};
