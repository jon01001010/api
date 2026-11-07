/**
 * The PC's memory and cores from the desktop app's native side. Outside the
 * .exe (a plain browser) there is none: callers fall back as before.
 */
const {isTauri, invoke} = require('./tauri');
const {NotAvailableError} = require('../windows/_stub');

async function systemInfo() {
  if (!isTauri()) {
    throw new NotAvailableError('Reading memory');
  }
  return invoke('system_info');
}

module.exports = {systemInfo};
