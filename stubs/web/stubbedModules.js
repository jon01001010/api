/**
 * Web build (the Windows app via Tauri, see TODO.md): native packages with
 * no web version are swapped for stubs, same rule as Windows ("stubbed, not
 * removed"). Used by metro.config.js only when bundling for the web, so
 * Android is untouched. Most stubs are shared with the Windows build.
 *
 * Packages that support the web themselves are NOT here: animations
 * (reanimated), gestures, safe areas, screens, SVG, app storage, slider,
 * picker, navigation, React Native Paper. The chat database uses WatermelonDB's
 * JavaScript mode saved in the browser storage (src/database/adapter.web.ts).
 */
const path = require('node:path');

const W = file => path.join(__dirname, '..', 'windows', file);
const STUBS = {
  // Local models and voice: Tauri will run llama-server / whisper as sidecars.
  'llama.rn': W('local-model.js'),
  'whisper.rn': W('voice-input.js'),
  '@fugood/react-native-audio-pcm-stream': W('native.js'),
  '@pocketpalai/react-native-speech': W('native.js'),
  'onnxruntime-react-native': W('native.js'),
  'react-native-nitro-modules': W('native.js'),
  // Phone hardware.
  'react-native-vision-camera': W('native.js'),
  'react-native-worklets-core': W('native.js'),
  // Inside the .exe: native file dialogs (stubs/web/image-picker.js,
  // share.js = "Save a copy as…", documents-picker.js).
  'react-native-image-picker': path.join(__dirname, 'image-picker.js'),
  'react-native-share': path.join(__dirname, 'share.js'),
  'react-native-haptic-feedback': W('haptics.js'),
  '@react-native-documents/picker': path.join(__dirname, 'documents-picker.js'),
  // Inside the .exe: Windows Credential Manager (stubs/web/keychain.js).
  'react-native-keychain': path.join(__dirname, 'keychain.js'),
  // Google / Apple / store services: not used (no Google, no Apple).
  '@react-native-firebase/app': W('native.js'),
  '@react-native-firebase/app-check': W('native.js'),
  '@react-native-google-signin/google-signin': W('native.js'),
  '@invertase/react-native-apple-authentication': W('native.js'),
  'react-native-iap': W('native.js'),
  // No web version: in memory or plain stand-ins until Tauri plugins.
  // Inside the .exe: real files via the native side; in a browser: memory.
  '@dr.pogodin/react-native-fs': path.join(__dirname, 'fs.js'),
  // Inside the .exe: the PC's real memory (stubs/web/device-info.js).
  'react-native-device-info': path.join(__dirname, 'device-info.js'),
  'react-native-config': W('config.js'),
  'react-native-linear-gradient': W('linear-gradient.js'),
  'react-native-keyboard-controller': W('keyboard-controller.js'),
  '@react-native-masked-view/masked-view': W('masked-view.js'),
  '@react-native-clipboard/clipboard': path.join(__dirname, 'clipboard.js'),
  // The HTML preview: a sandboxed frame served by the native side from its
  // own address, no network (stubs/web/webview.js, SECURITY.md rule 3).
  'react-native-webview': path.join(__dirname, 'webview.js'),
  // Browsers have crypto.getRandomValues already.
  'react-native-get-random-values': path.join(__dirname, 'nothing.js'),
};

/** The stub file for a module name (or a path inside it), else null. */
function webStubFor(moduleName) {
  for (const name of Object.keys(STUBS)) {
    if (moduleName === name || moduleName.startsWith(name + '/')) {
      return STUBS[name];
    }
  }
  return null;
}

module.exports = {STUBS, webStubFor};
