/** Clipboard on Windows: its Windows code is old-style; copying does nothing yet (TODO). */
const {makeStub} = require('./_stub');

const Clipboard = {
  setString: () => {},
  getString: async () => '',
  hasString: async () => false,
};
module.exports = makeStub('@react-native-clipboard/clipboard', {
  mode: 'ui',
  overrides: {default: Clipboard, Clipboard, ...Clipboard},
});
