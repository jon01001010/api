/**
 * @react-native-documents/picker on the desktop: the native "choose a file"
 * dialog (src-tauri/src/transfer.rs). The chosen file is copied into the
 * app's own folder; the screens then put it in the workspace or attach it,
 * as on the phone. Choosing is the user's consent; the original is never
 * changed. In a plain browser there is no native side: it says so.
 */
const {isTauri, invoke} = require('./tauri');

const errorCodes = {OPERATION_CANCELED: 'OPERATION_CANCELED'};
const types = new Proxy({}, {get: (_t, key) => String(key)});

class PickError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const isErrorWithCode = e => !!(e && typeof e.code === 'string');

async function pick(options = {}) {
  if (!isTauri()) {
    throw new Error('Adding files needs the desktop app.');
  }
  const list = [].concat(options.type || []);
  const images = list.length > 0 && list.every(t => /image/i.test(String(t)));
  const file = await invoke('pick_import_file', {images});
  if (!file) {
    throw new PickError(errorCodes.OPERATION_CANCELED, 'Canceled');
  }
  const lower = file.name.toLowerCase();
  const type = /\.(png)$/.test(lower)
    ? 'image/png'
    : /\.(jpe?g)$/.test(lower)
      ? 'image/jpeg'
      : /\.(webp)$/.test(lower)
        ? 'image/webp'
        : /\.(gif)$/.test(lower)
          ? 'image/gif'
          : 'application/octet-stream';
  return [{uri: file.path, name: file.name, size: file.size, type}];
}

/** The pick is already a copy in the app's folder: hand it back as one. */
async function keepLocalCopy({files = []} = {}) {
  return files.map(f => ({
    status: 'success',
    sourceUri: f.uri,
    localUri: 'file://' + f.uri,
  }));
}

module.exports = {
  __esModule: true,
  pick,
  keepLocalCopy,
  types,
  errorCodes,
  isErrorWithCode,
  default: {pick, keepLocalCopy, types, errorCodes, isErrorWithCode},
};
