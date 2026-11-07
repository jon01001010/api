/**
 * react-native-get-random-values has no Windows version. The app only uses
 * random values for record IDs (uuid), nothing secret: the local API token
 * comes from Java SecureRandom on Android. NOT for secrets: before desktop
 * pairing keys exist on Windows, this needs a real secure source (TODO).
 */
if (typeof global.crypto !== 'object' || global.crypto === null) {
  global.crypto = {};
}
if (typeof global.crypto.getRandomValues !== 'function') {
  global.crypto.getRandomValues = array => {
    const range = 2 ** ((array.BYTES_PER_ELEMENT || 1) * 8);
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * range);
    }
    return array;
  };
}
module.exports = {};
