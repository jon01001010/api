module.exports = {
  project: {
    ios: {},
    android: {},
  },
  dependencies: {
    // PocketAgent has no Firebase project. Prevent native App Check from
    // crashing React Native startup before the offline UI can load.
    // Optional upstream benchmark/feedback submissions remain unavailable.
    '@react-native-firebase/app': {
      platforms: {android: null},
    },
    '@react-native-firebase/app-check': {
      platforms: {android: null},
    },
    '@invertase/react-native-apple-authentication': {
      platforms: {android: null},
    },
    // Windows: these packages only have old-style Windows code, which
    // react-native-windows 0.82 (new architecture only) can't build; linking
    // them also pulled react-native-windows in from source and broke the
    // link. They are not linked on Windows and are stubbed in JavaScript
    // instead (stubs/windows/stubbedModules.js). Android is unchanged.
    ...Object.fromEntries(
      [
        '@react-native-async-storage/async-storage',
        '@dr.pogodin/react-native-fs',
        '@nozbe/watermelondb',
        '@react-native-clipboard/clipboard',
        '@react-native-community/slider',
        '@react-native-picker/picker',
        'react-native-config',
        'react-native-device-info',
        'react-native-linear-gradient',
        'react-native-screens',
        'react-native-share',
      ].map(name => [name, {platforms: {windows: null}}]),
    ),
  },
  assets: ['./src/assets/fonts'],
};
