/** Linear gradients on Windows: a plain view filled with the first colour (TODO: real gradient). */
const React = require('react');
const RN = require('react-native');

function LinearGradient({colors, style, children, ...rest}) {
  return React.createElement(
    RN.View,
    {...rest, style: [{backgroundColor: colors && colors[0]}, style]},
    children,
  );
}
module.exports = {__esModule: true, default: LinearGradient, LinearGradient};
