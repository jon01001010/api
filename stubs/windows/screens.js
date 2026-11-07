/**
 * react-native-screens on Windows: its Windows code is old-style. Navigation
 * works without it (screens off): every screen component is a plain View.
 */
const {makeStub} = require('./_stub');

module.exports = makeStub('react-native-screens', {
  mode: 'ui',
  components: 'view',
  overrides: {
    enableScreens: () => {},
    enableFreeze: () => {},
    screensEnabled: () => false,
    freezeEnabled: () => false,
    isSearchBarAvailableForCurrentPlatform: false,
    executeNativeBackPress: () => false,
    compatibilityFlags: {},
    featureFlags: {experiment: {}, stable: {}},
  },
});
