/**
 * Windows build: native packages with no Windows version are swapped for
 * stubs here (rule in TODO.md: "anything not needed on a platform is
 * stubbed, not removed"). Used by metro.config.js only when bundling for
 * Windows, so Android is untouched.
 *
 * Two kinds of stub (see _stub.js):
 * - "native": a feature that needs phone hardware or a Google/Apple
 *   service. Every call fails with "not available on this device"; the UI
 *   hides the feature.
 * - "ui": plumbing the screens need to render (animations, gestures, safe
 *   areas, keyboard). Works inertly: animations jump to their end, gestures
 *   do nothing, layouts still render.
 *
 * Packages linked for real on Windows (new-architecture Windows code): the
 * web view and SVG. They are NOT here. WatermelonDB uses its own JavaScript
 * database on Windows (src/database/adapter.windows.ts).
 */
const path = require('node:path');

const STUBS = {
  // Local models and voice: replaced in step 2 by bundled llama.cpp /
  // whisper.cpp servers on 127.0.0.1 (the app's remote engine talks to them).
  'llama.rn': 'local-model.js',
  'whisper.rn': 'voice-input.js',
  '@fugood/react-native-audio-pcm-stream': 'native.js',
  '@pocketpalai/react-native-speech': 'native.js',
  'onnxruntime-react-native': 'native.js',
  'react-native-nitro-modules': 'native.js',
  // Phone hardware.
  'react-native-vision-camera': 'native.js',
  'react-native-worklets-core': 'native.js',
  'react-native-image-picker': 'native.js',
  'react-native-share': 'native.js',
  'react-native-haptic-feedback': 'haptics.js',
  '@react-native-documents/picker': 'native.js',
  // Secrets: Windows needs Credential Manager (TODO); until then saving an
  // API key says "not available" rather than storing it unprotected.
  'react-native-keychain': 'native.js',
  // Google / Apple / store services: not used on Windows (no Google, no Apple).
  '@react-native-firebase/app': 'native.js',
  '@react-native-firebase/app-check': 'native.js',
  '@react-native-google-signin/google-signin': 'native.js',
  '@invertase/react-native-apple-authentication': 'native.js',
  'react-native-iap': 'native.js',
  // Old-style Windows code that react-native-windows 0.82 can't build (not
  // linked on Windows: react-native.config.js). Storage and the database
  // work in memory for now.
  '@react-native-async-storage/async-storage': 'memory-storage.js',
  '@dr.pogodin/react-native-fs': 'memory-fs.js',
  '@react-native-clipboard/clipboard': 'clipboard.js',
  '@react-native-community/slider': 'form-controls.js',
  '@react-native-picker/picker': 'form-controls.js',
  'react-native-config': 'config.js',
  'react-native-device-info': 'device-info.js',
  'react-native-linear-gradient': 'linear-gradient.js',
  'react-native-screens': 'screens.js',
  // UI plumbing with no Windows version.
  'react-native-reanimated': 'reanimated.js',
  'react-native-worklets': 'worklets.js',
  'react-native-gesture-handler': 'gesture-handler.js',
  'react-native-safe-area-context': 'safe-area-context.js',
  'react-native-keyboard-controller': 'keyboard-controller.js',
  '@react-native-masked-view/masked-view': 'masked-view.js',
  'react-native-get-random-values': 'get-random-values.js',
};

/** The stub file for a module name (or a path inside it), else null. */
function windowsStubFor(moduleName) {
  for (const name of Object.keys(STUBS)) {
    if (moduleName === name || moduleName.startsWith(name + '/')) {
      return path.join(__dirname, STUBS[name]);
    }
  }
  return null;
}

module.exports = {STUBS, windowsStubFor};
