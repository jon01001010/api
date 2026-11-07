/**
 * "react-native" on the web: react-native-web, plus answers for the React
 * Native APIs it doesn't have (all phone-only), so shared code loads:
 * - TurboModuleRegistry: the app's own native modules (src/specs) become
 *   "not available on this device" stubs; get() returns null.
 * - PermissionsAndroid / ToastAndroid / DevSettings: harmless no-ops.
 * - NativeModules: any module name gives a "not available" stub.
 */
const RNW = require('react-native-web');

// React Native's TextInput.State.currentlyFocusedInput() is called by the
// app's sheets and the bottom-sheet library; react-native-web has it under
// its older name, currentlyFocusedField(). Without this, opening a sheet
// with a text box crashed the whole window (seen on Windows, 2026-11-07).
if (
  RNW.TextInput &&
  RNW.TextInput.State &&
  typeof RNW.TextInput.State.currentlyFocusedInput !== 'function'
) {
  RNW.TextInput.State.currentlyFocusedInput = () =>
    RNW.TextInput.State.currentlyFocusedField
      ? RNW.TextInput.State.currentlyFocusedField()
      : null;
}
const {makeStub} = require('../windows/_stub');

// Modules whose job means nothing in a desktop window: they quietly succeed.
const QUIET = {
  // Keeping a phone screen on while a reply is generated.
  KeepAwakeModule: {activate: async () => {}, deactivate: async () => {}},
  // The PC's real memory and cores (src-tauri/src/system.rs), so model
  // memory checks are right. In a plain browser: unknown, fail as before.
  HardwareInfo: {
    getAvailableMemory: async () =>
      (await require('./systemInfo').systemInfo()).availableMemory,
    getCPUInfo: async () => ({
      cores: (await require('./systemInfo').systemInfo()).cpuCores,
    }),
    getGPUInfo: async () => ({
      renderer: 'PC',
      vendor: '',
      version: '',
      hasAdreno: false,
      hasMali: false,
      hasPowerVR: false,
      supportsOpenCL: false,
      gpuType: 'desktop',
    }),
  },
};

const stubs = {};
const nativeModule = name =>
  stubs[name] ||
  (stubs[name] = makeStub(`${name}`, {
    mode: 'native',
    overrides: QUIET[name] || {},
  }));

const TurboModuleRegistry = {
  get: () => null,
  getEnforcing: name => nativeModule(name),
};

const NativeModules = new Proxy(
  {},
  {
    get: (_t, key) => (typeof key === 'symbol' ? undefined : nativeModule(key)),
  },
);

const PermissionsAndroid = {
  PERMISSIONS: new Proxy({}, {get: (_t, key) => String(key)}),
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
  check: async () => false,
  request: async () => 'denied',
  requestMultiple: async () => ({}),
};

module.exports = {
  ...RNW,
  TurboModuleRegistry,
  NativeModules,
  PermissionsAndroid,
  ToastAndroid: {show: () => {}, SHORT: 0, LONG: 1},
  DevSettings: {addMenuItem: () => {}, reload: () => window.location.reload()},
  requireNativeComponent: () => RNW.View,
  codegenNativeComponent: () => RNW.View,
};
