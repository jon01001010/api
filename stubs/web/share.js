/**
 * react-native-share on the desktop: there is no share sheet, so a file is
 * saved where the user picks (native "Save a copy" dialog,
 * src-tauri/src/transfer.rs); plain text is copied to the clipboard.
 */
const {isTauri, invoke} = require('./tauri');

const toPath = url => String(url).replace(/^file:\/\//, '');

async function open(options = {}) {
  const url = options.url || (options.urls && options.urls[0]);
  if (url && isTauri()) {
    const saved = await invoke('save_copy', {
      path: toPath(url),
      name: options.filename || null,
    });
    if (!saved && options.failOnCancel !== false) {
      throw new Error('User did not share');
    }
    return {success: !!saved, message: saved || ''};
  }
  if (options.message) {
    require('./clipboard').default.setString(String(options.message));
    return {success: true, message: 'copied'};
  }
  throw new Error('Saving files needs the desktop app.');
}

const Share = {open, shareSingle: open, Social: {}};
module.exports = {__esModule: true, default: Share, ...Share};
