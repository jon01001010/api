/** A desktop window has no notch or system bars: every inset is 0. */
const React = require('react');
const RN = require('react-native');
const {makeStub, passthrough} = require('./_stub');

const insets = {top: 0, right: 0, bottom: 0, left: 0};
const frame = () => {
  const {width, height} = RN.Dimensions.get('window');
  return {x: 0, y: 0, width, height};
};
const SafeAreaInsetsContext = React.createContext(insets);
const SafeAreaFrameContext = React.createContext(frame());

module.exports = makeStub('react-native-safe-area-context', {
  mode: 'ui',
  overrides: {
    SafeAreaProvider: passthrough('SafeAreaProvider'),
    SafeAreaView: RN.View,
    SafeAreaInsetsContext,
    SafeAreaFrameContext,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame(),
    initialWindowMetrics: {frame: frame(), insets},
    withSafeAreaInsets: Component => props =>
      React.createElement(Component, {...props, insets}),
  },
});
