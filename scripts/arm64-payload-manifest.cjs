const fs = require('node:fs');
function arm64Manifest(manifest) {
  const abis = manifest.abis.filter(item => item.abi === 'arm64-v8a');
  if (abis.length !== 1) throw new Error('Expected exactly one ARM64 payload specification');
  return {...manifest, abis};
}
module.exports = {arm64Manifest};
if (require.main === module) {
  fs.writeFileSync(process.argv[2], JSON.stringify(arm64Manifest(require('./android-payload-manifest.json'))));
}
