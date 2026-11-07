/** A PC has no vibration motor: haptic taps quietly do nothing. */
const HapticFeedbackTypes = new Proxy(
  {},
  {get: (_t, key) => (typeof key === 'string' ? key : undefined)},
);
const trigger = () => {};
module.exports = {
  trigger,
  HapticFeedbackTypes,
  default: {trigger},
  __esModule: true,
};
