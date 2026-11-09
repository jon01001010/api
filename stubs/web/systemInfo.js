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

/**
 * How much memory a model may use on a PC. A phone's limit is what is free
 * right now; a PC frees memory when asked (other apps move to the page
 * file), so the limit is all memory but room for Windows, never less than
 * what is free right now.
 */
const WINDOWS_ROOM = 3 * 1e9;
function modelMemoryLimit({totalMemory, availableMemory}) {
  return Math.max(availableMemory, totalMemory - WINDOWS_ROOM, 0);
}

module.exports = {systemInfo, modelMemoryLimit};
