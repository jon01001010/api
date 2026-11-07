/** react-native-worklets has no Windows version: "worklets" just run as normal functions. */
const {makeStub} = require('./_stub');

const run = fn => fn;
module.exports = makeStub('react-native-worklets', {
  mode: 'ui',
  overrides: {
    runOnJS: run,
    runOnUI: run,
    runOnUIAsync:
      fn =>
      (...args) =>
        Promise.resolve(fn(...args)),
    scheduleOnRN: (fn, ...args) => fn(...args),
    scheduleOnUI: (fn, ...args) => fn(...args),
    executeOnUIRuntimeSync: run,
    isWorkletFunction: () => false,
    makeShareable: value => value,
    createSerializable: value => value,
  },
});
