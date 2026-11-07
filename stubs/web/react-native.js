/**
 * "react-native" on the web: react-native-web, plus answers for the React
 * Native APIs it doesn't have (all phone-only), so shared code loads:
 * - TurboModuleRegistry: the app's own native modules (src/specs) become
 *   "not available on this device" stubs; get() returns null.
 * - PermissionsAndroid / ToastAndroid / DevSettings: harmless no-ops.
 * - NativeModules: any module name gives a "not available" stub.
 */
const RNW = require('react-native-web');
const {makeStub} = require('../windows/_stub');

const stubs = {};
const nativeModule = name =>
  stubs[name] || (stubs[name] = makeStub(`${name}`, {mode: 'native'}));

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
