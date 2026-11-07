/**
 * react-native-device-info on Windows: its Windows code is old-style. Fixed,
 * honest values until a Windows module reads the real ones (TODO). Local
 * models don't run on Windows yet, so the memory figures gate nothing.
 */
const {makeStub} = require('./_stub');

const GB = 1024 ** 3;
const version = require('../../package.json').version;

const info = {
  getVersion: () => version,
  getBuildNumber: () => '1',
  getModel: () => 'Windows PC',
  getBrand: () => 'Windows',
  getDeviceId: () => 'windows',
  getSystemName: () => 'Windows',
  getSystemVersion: () => '',
  getDevice: async () => 'windows',
  getDeviceName: async () => 'Windows PC',
  isEmulator: async () => false,
  supportedAbis: async () => ['x64'],
  getTotalMemory: async () => 8 * GB,
  getUsedMemory: async () => 0,
  getFreeDiskStorage: async () => 50 * GB,
};

module.exports = makeStub('react-native-device-info', {
  mode: 'ui',
  overrides: {default: info, ...info},
});
