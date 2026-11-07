/**
 * llama.rn has no Windows version. Until step 2 (a bundled llama.cpp server
 * on 127.0.0.1 used through the app's remote engine), loading a local model
 * says "not available"; the lookups Settings and About make on open return
 * empty, harmless values so those screens still work.
 */
const {makeStub, NotAvailableError} = require('./_stub');

class LlamaContext {
  constructor() {
    throw new NotAvailableError('Running a model on this device');
  }
}

module.exports = makeStub('llama.rn', {
  mode: 'native',
  overrides: {
    LlamaContext,
    BuildInfo: {number: 'windows', commit: 'stub'},
    getBackendDevicesInfo: async () => [],
    addNativeLogListener: () => ({remove() {}}),
    toggleNativeLog: async () => {},
    initLlama: async () => {
      throw new NotAvailableError('Running a model on this device');
    },
    loadLlamaModelInfo: async () => {
      throw new NotAvailableError('Reading model details on this device');
    },
  },
});
