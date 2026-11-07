/**
 * react-native-gesture-handler has no Windows version: its views become the
 * plain React Native ones, gestures do nothing (mouse clicks and scrolling
 * still work through the normal views).
 */
const RN = require('react-native');
const {makeStub, chain, passthrough} = require('./_stub');

module.exports = makeStub('react-native-gesture-handler', {
  mode: 'ui',
  overrides: {
    GestureHandlerRootView: RN.View,
    gestureHandlerRootHOC: Component => Component,
    GestureDetector: passthrough('GestureDetector'),
    Gesture: chain(),
    ScrollView: RN.ScrollView,
    FlatList: RN.FlatList,
    Switch: RN.Switch,
    TextInput: RN.TextInput,
    Pressable: RN.Pressable,
    TouchableOpacity: RN.TouchableOpacity,
    TouchableHighlight: RN.TouchableHighlight,
    TouchableWithoutFeedback: RN.TouchableWithoutFeedback,
    RectButton: RN.TouchableOpacity,
    BaseButton: RN.TouchableOpacity,
    BorderlessButton: RN.TouchableOpacity,
    State: {
      UNDETERMINED: 0,
      FAILED: 1,
      BEGAN: 2,
      CANCELLED: 3,
      ACTIVE: 4,
      END: 5,
    },
    Directions: {RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8},
  },
});
