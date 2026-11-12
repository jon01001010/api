/**
 * react-native-image-picker on the desktop: "Gallery" is the native
 * "choose a picture" dialog (src-tauri/src/transfer.rs); the copy lands in
 * the app's own folder; "Camera" takes a screenshot.
 */
const {isTauri, invoke} = require('./tauri');

async function launchImageLibrary() {
  if (!isTauri()) {
    return {errorCode: 'others', errorMessage: 'Needs the desktop app.'};
  }
  const file = await invoke('pick_import_file', {images: true});
  if (!file) {
    return {didCancel: true};
  }
  return {
    assets: [
      {
        uri: 'file://' + file.path,
        fileName: file.name,
        fileSize: file.size,
      },
    ],
  };
}

/**
 * "Camera" on the PC: a screenshot (src-tauri/src/pc_extra.rs). The native
 * side asks first and hides DesktopAgent while it is taken; the picture is
 * attached so the user sees it before sending. Windows only for now.
 */
async function launchCamera() {
  if (!isTauri()) {
    return {errorCode: 'camera_unavailable', errorMessage: 'No camera here.'};
  }
  try {
    const path = await invoke('take_screenshot');
    if (!path) {
      return {didCancel: true};
    }
    return {
      assets: [
        {
          uri: 'file://' + path,
          fileName: path.split('/').pop(),
          type: 'image/png',
        },
      ],
    };
  } catch (e) {
    return {errorCode: 'camera_unavailable', errorMessage: String(e)};
  }
}

module.exports = {
  __esModule: true,
  launchImageLibrary,
  launchCamera,
  default: {launchImageLibrary, launchCamera},
};
