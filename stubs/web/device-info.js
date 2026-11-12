/**
 * react-native-device-info on the web build: inside the .exe, real memory
 * from the PC; otherwise the fixed values (stubs/windows/device-info.js).
 */
const fixed = require('../windows/device-info.js');
const {isTauri} = require('./tauri');
const {systemInfo} = require('./systemInfo');

const base = fixed.default;
const info = {
  ...base,
  getTotalMemory: async () =>
    isTauri() ? (await systemInfo()).totalMemory : base.getTotalMemory(),
  getUsedMemory: async () => {
    if (!isTauri()) {
      return base.getUsedMemory();
    }
    const s = await systemInfo();
    return s.totalMemory - s.availableMemory;
  },
  // The build's own version (scripts/build-info/write.js), same as the
  // phone built from the same commit; "dev" in local builds.
  getVersion: () => {
    const v = require('../../src/assets/build-info.json').version;
    return v && v !== 'dev' ? v : base.getVersion();
  },
  getBuildNumber: () => {
    const v = require('../../src/assets/build-info.json').version;
    return v && v !== 'dev'
      ? String(1000 + Number(v.split('.')[2]))
      : base.getBuildNumber();
  },
  getModel: () => 'PC',
  getDeviceName: async () => 'PC',
};

module.exports = {__esModule: true, default: info, ...info};
