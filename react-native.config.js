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
  },
  assets: ['./src/assets/fonts'],
};
