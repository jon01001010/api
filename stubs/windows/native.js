/** Native features with no Windows version: every call says "not available". */
const {makeStub} = require('./_stub');

module.exports = makeStub('This feature', {mode: 'native'});
