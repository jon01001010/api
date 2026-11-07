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
  getModel: () => 'PC',
  getDeviceName: async () => 'PC',
};

module.exports = {__esModule: true, default: info, ...info};
