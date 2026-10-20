'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {compactPhonemize} = require('./metro/compact-phonemize.cjs');
const filename = require.resolve('phonemize/en-g2p');
const source = fs.readFileSync(filename, 'utf8');
const compact = compactPhonemize(source);
function load(src) {
  const exports = {};
  // Execute only this pinned, installed dependency for equivalence testing.
  vm.runInNewContext(
    src + ';exports.__data={dict,dictionary$1};',
    {
      exports,
      require: createRequire(filename),
    },
    {timeout: 10000},
  );
  return exports;
}
const original = load(source);
const optimized = load(compact);
for (const key of ['dict', 'dictionary$1']) {
  const a = original.__data[key];
  const b = optimized.__data[key];
  assert.ok(
    JSON.stringify(a) === JSON.stringify(b),
    `${key} data and order must match`,
  );
  assert.equal(Object.isFrozen(a), Object.isFrozen(b));
  assert.equal(
    Object.getPrototypeOf(a) === null,
    Object.getPrototypeOf(b) === null,
  );
}
assert.equal(optimized.__data.dictionary$1.default, optimized.__data.dict);
const a = new original.G2PModel();
const b = new optimized.G2PModel();
for (const word of ['hello', 'world', 'phone', 'security', 'unlistedwordxyz']) {
  assert.equal(b.predict(word), a.predict(word));
}
assert.throws(() => compactPhonemize(source + ' '), /dictionary changed/);
console.log(
  `PASS: ${Object.keys(original.__data.dict).length} dictionary entries, namespace identity/freeze/prototype, five predictions, changed-input rejection`,
);
const wrapper = {exports: {}};
let compacted = 0;
vm.runInNewContext(
  fs.readFileSync(require.resolve('./metro/transformer.cjs'), 'utf8'),
  {
    module: wrapper,
    require(name) {
      if (name === 'react-native-svg-transformer/react-native') {
        return {transform: args => args};
      }
      if (name === './compact-phonemize.cjs') {
        return {
          compactPhonemize: () => {
            compacted++;
            return 'compact';
          },
        };
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  },
);
for (const candidateFilename of [
  'node_modules/phonemize/dist/en-g2p.cjs',
  '/project/node_modules/phonemize/dist/en-g2p.cjs',
  'C:\\project\\node_modules\\phonemize\\dist\\en-g2p.cjs',
]) {
  assert.equal(
    wrapper.exports.transform({filename: candidateFilename, src: 'original'})
      .src,
    'compact',
  );
}
const unrelated = {filename: 'src/App.tsx', src: 'original'};
assert.equal(wrapper.exports.transform(unrelated), unrelated);
assert.equal(compacted, 3);
console.log(
  'PASS: relative, absolute and Windows paths; unrelated files unchanged',
);
