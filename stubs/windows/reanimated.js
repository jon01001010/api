/**
 * react-native-reanimated has no Windows version. This stand-in keeps the
 * screens and libraries that use it (bottom sheets, side menu) working
 * without animation: values jump straight to where an animation would end
 * and the component re-renders. Only the parts used are real; anything else
 * is an inert no-op (see _stub.js).
 */
const React = require('react');
const RN = require('react-native');
const {makeStub, chain} = require('./_stub');

function sharedValue(initial, onChange) {
  let v = initial;
  return {
    get value() {
      return v;
    },
    set value(next) {
      if (next !== v) {
        v = next;
        onChange && onChange();
      }
    },
    get() {
      return v;
    },
    set(next) {
      this.value = typeof next === 'function' ? next(v) : next;
    },
    modify(fn) {
      this.value = fn(v);
    },
    addListener() {},
    removeListener() {},
  };
}

function useSharedValue(initial) {
  const [, rerender] = React.useReducer(x => x + 1, 0);
  const ref = React.useRef(null);
  if (!ref.current) {
    ref.current = sharedValue(initial, rerender);
  }
  return ref.current;
}

const finish = (to, callback) => {
  if (typeof callback === 'function') {
    setTimeout(() => callback(true), 0);
  }
  return to;
};

function interpolate(x, input, output, extrapolation) {
  const clamp =
    extrapolation === 'clamp' ||
    (extrapolation && extrapolation.extrapolateLeft === 'clamp');
  let i = 1;
  while (i < input.length - 1 && x > input[i]) {
    i++;
  }
  const [a, b] = [input[i - 1], input[i]];
  const [c, d] = [output[i - 1], output[i]];
  if (clamp) {
    if (x <= input[0]) {
      return output[0];
    }
    if (x >= input[input.length - 1]) {
      return output[output.length - 1];
    }
  }
  return b === a ? c : c + ((x - a) / (b - a)) * (d - c);
}

function interpolateColor(x, input, output) {
  let best = 0;
  input.forEach((point, i) => {
    if (Math.abs(point - x) < Math.abs(input[best] - x)) {
      best = i;
    }
  });
  return output[best];
}

const Extrapolation = {CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity'};

const Animated = {
  View: RN.View,
  Text: RN.Text,
  Image: RN.Image,
  ScrollView: RN.ScrollView,
  FlatList: RN.FlatList,
  createAnimatedComponent: Component => Component,
};

module.exports = makeStub('react-native-reanimated', {
  mode: 'ui',
  hookValue: chain(),
  overrides: {
    default: Animated,
    ...Animated,
    useSharedValue,
    makeMutable: initial => sharedValue(initial),
    isSharedValue: v => !!(v && typeof v === 'object' && 'value' in v),
    useDerivedValue: fn => ({value: fn(), get: fn}),
    useAnimatedStyle: fn => {
      try {
        return fn() || {};
      } catch (e) {
        return {};
      }
    },
    useAnimatedProps: fn => {
      try {
        return fn() || {};
      } catch (e) {
        return {};
      }
    },
    useAnimatedReaction: (prepare, react) => {
      const current = prepare();
      const previous = React.useRef(null);
      React.useEffect(() => {
        if (current !== previous.current) {
          react(current, previous.current);
          previous.current = current;
        }
      });
    },
    useAnimatedScrollHandler: handlers => event => {
      const fn =
        typeof handlers === 'function'
          ? handlers
          : handlers && handlers.onScroll;
      if (fn) {
        fn(event.nativeEvent);
      }
    },
    useAnimatedRef: () => React.useRef(null),
    useReducedMotion: () => true,
    // Same as useCallback; no worklets on Windows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useWorkletCallback: (fn, deps) => React.useCallback(fn, deps || []),
    withTiming: (to, _config, callback) => finish(to, callback),
    withSpring: (to, _config, callback) => finish(to, callback),
    withDecay: (_config, callback) => finish(0, callback),
    withDelay: (_ms, value) => value,
    withSequence: (...values) => values[values.length - 1],
    withRepeat: value => value,
    cancelAnimation: () => {},
    runOnJS: fn => fn,
    runOnUI: fn => fn,
    measure: () => null,
    scrollTo: () => {},
    interpolate,
    interpolateColor,
    Extrapolation,
    Extrapolate: Extrapolation,
    Easing: RN.Easing,
  },
});
