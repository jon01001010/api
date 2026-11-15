/**
 * Android: Google services that PocketAgent doesn't use (no Google) are
 * unlinked from the Android build in react-native.config.js, and their
 * JavaScript is swapped for these stubs by metro.config.js, so nothing
 * reaches for a native module that isn't there. The app code that would use
 * them stays ("stubbed, not removed"). SECURITY.md rule 7.
 */
const path = require('node:path');

const STUBS = {
  // Google Sign-In (PalsHub accounts; never configured in PocketAgent).
  '@react-native-google-signin/google-signin': path.join(
    __dirname,
    'google-signin.js',
  ),
  // Google Play billing (NO_PURCHASES in src/config/freeBuild.ts).
  'react-native-iap': path.join(__dirname, 'iap.js'),
};

/** The stub file for a module name (or a path inside it), else null. */
function androidStubFor(moduleName) {
  for (const name of Object.keys(STUBS)) {
    if (moduleName === name || moduleName.startsWith(name + '/')) {
      return STUBS[name];
    }
  }
  return null;
}

module.exports = {STUBS, androidStubFor};
