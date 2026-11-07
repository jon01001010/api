/** Masked view has no Windows version: the content shows without the mask. */
const {makeStub, passthrough} = require('./_stub');

const MaskedView = passthrough('MaskedView');
module.exports = makeStub('@react-native-masked-view/masked-view', {
  mode: 'ui',
  overrides: {default: MaskedView, MaskedView},
});
