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
/** Room llama.cpp leaves free on each graphics card when fitting (--fit). */
const CARD_ROOM = 1024 * 1024 * 1024;

function memoryLimit({totalMemory, availableMemory}) {
  return Math.max(availableMemory, totalMemory - WINDOWS_ROOM, 0);
}

/**
 * Graphics card memory a model can use: cards with their own memory only (a
 * card built into the processor uses the PC's memory, already counted).
 */
function cardMemory({gpus = []}) {
  return gpus
    .filter(g => !g.shared)
    .reduce((sum, g) => sum + Math.max(g.freeMemory - CARD_ROOM, 0), 0);
}

/**
 * How much a model may use on this PC: memory (above) plus the graphics
 * card's own memory, since llama.cpp splits a model between the two.
 */
function modelMemoryLimit(info) {
  return memoryLimit(info) + cardMemory(info);
}

/** Where a model of `bytes` runs on this PC. */
function pcFit(bytes, info) {
  const card = cardMemory(info);
  if (card > 0 && bytes <= card) {
    return 'card';
  }
  if (bytes <= card + memoryLimit(info)) {
    return card > 0 ? 'partly' : 'memory';
  }
  return 'too-big';
}

module.exports = {systemInfo, modelMemoryLimit, cardMemory, pcFit};
