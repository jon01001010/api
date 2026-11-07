/** react-native-keyboard-controller has no Windows version; a desktop keyboard doesn't cover the screen. */
const RN = require('react-native');
const {makeStub, chain, passthrough} = require('./_stub');

module.exports = makeStub('react-native-keyboard-controller', {
  mode: 'ui',
  overrides: {
    KeyboardProvider: passthrough('KeyboardProvider'),
    KeyboardAwareScrollView: RN.ScrollView,
    KeyboardStickyView: RN.View,
    KeyboardAvoidingView: RN.View,
    KeyboardController: chain(),
    AndroidSoftInputModes: chain(),
    useReanimatedKeyboardAnimation: () => ({
      height: {value: 0},
      progress: {value: 0},
    }),
    useKeyboardAnimation: () => ({height: {value: 0}, progress: {value: 0}}),
    useKeyboardHandler: () => {},
  },
});
