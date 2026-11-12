/**
 * react-native-image-picker on the desktop: "Gallery" is the native
 * "choose a picture" dialog (src-tauri/src/transfer.rs); the copy lands in
 * the app's own folder. No camera on the PC side.
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

async function launchCamera() {
  return {errorCode: 'camera_unavailable', errorMessage: 'No camera here.'};
}

module.exports = {
  __esModule: true,
  launchImageLibrary,
  launchCamera,
  default: {launchImageLibrary, launchCamera},
};
