'use strict';

const upstream = require('react-native-svg-transformer/react-native');
const {compactPhonemize} = require('./compact-phonemize.cjs');

module.exports.transform = function (args) {
  const filename = args.filename.replace(/\\/g, '/');
  if (/(^|\/)node_modules\/phonemize\/dist\/en-g2p\.cjs$/.test(filename)) {
    return upstream.transform({...args, src: compactPhonemize(args.src)});
  }
  return upstream.transform(args);
};

// Include the compactor in Metro's cache key so edits cannot reuse old output.
module.exports.getCacheKey = function () {
  return require('node:crypto')
    .createHash('sha256')
    .update(require('node:fs').readFileSync(__filename))
    .update(
      require('node:fs').readFileSync(
        require.resolve('./compact-phonemize.cjs'),
      ),
    )
    .update(
      require('node:fs').readFileSync(
        require.resolve('react-native-svg-transformer/react-native'),
      ),
    )
    .digest('hex');
};
