/** whisper.rn has no Windows version (voice comes later via whisper.cpp). */
const {makeStub, NotAvailableError} = require('./_stub');

module.exports = makeStub('whisper.rn', {
  mode: 'native',
  overrides: {
    initWhisper: async () => {
      throw new NotAvailableError('Voice input');
    },
  },
});
