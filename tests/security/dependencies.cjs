const assert = require('node:assert/strict');
const braces = require('braces');
const {sprintf} = require('sprintf-js');
assert.throws(() => braces('{'.repeat(4000)+'x'+'}'.repeat(4000)), /nesting limit/);
assert.deepEqual(braces('{a,b}', {expand:true}), ['a','b']);
assert.doesNotThrow(() => sprintf('%.1000000f', 1.5));
assert.doesNotThrow(() => sprintf('%.0g', 1.5));
assert.equal(sprintf('%.2f', 1.5), '1.50');
assert.equal(sprintf('%.0f', 1.5), '2');
console.log('6 dependency mitigation checks passed');
const imageModule = require('image-size');
const imageSize = imageModule.__esModule ? imageModule.default : imageModule;
assert.equal(typeof imageSize, 'function');
const dimensions = imageSize(require('node:fs').readFileSync('android/app/src/main/res/mipmap-mdpi/ic_launcher.png'));
assert(dimensions.width > 0 && dimensions.height > 0);
assert.deepEqual({...require('query-string').parse('x=hello%20world')}, {x:'hello world'});
console.log('3 upgraded dependency compatibility checks passed');
// Exercise Metro's real filename path, not just image-size's byte API.
const path = require('node:path');
require('../../node_modules/metro/src/Assets').getAssetData(
  path.resolve('android/app/src/main/res/mipmap-mdpi/ic_launcher.png'),
  'ic_launcher.png', [], 'android', '/assets',
).then(asset => {
  assert.equal(asset.width, 48);
  assert.equal(asset.height, 48);
  console.log('1 Metro image asset compatibility check passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
