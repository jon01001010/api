const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const fs = require('fs');
const path = require('node:path');

//const localPackagePaths = ['localpath/code/llama.rn'];

const {windowsStubFor} = require('./stubs/windows/stubbedModules');
const {webStubFor} = require('./stubs/web/stubbedModules');

const rnwPath = fs.realpathSync(
  path.resolve(require.resolve('react-native-windows/package.json'), '..'),
);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */

const defaultConfig = getDefaultConfig(__dirname);
const {assetExts, sourceExts} = defaultConfig.resolver;

const config = {
  resolver: {
    //nodeModulesPaths: [...localPackagePaths], // update to resolver
    assetExts: assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
    // Windows build files are not app source (from the react-native-windows
    // template: stops run-windows from crashing or locking files).
    blockList: [
      new RegExp(
        `${path.resolve(__dirname, 'windows').replace(/[/\\]/g, '/')}.*`,
      ),
      new RegExp(`${rnwPath.replace(/[/\\]/g, '/')}/build/.*`),
      new RegExp(`${rnwPath.replace(/[/\\]/g, '/')}/target/.*`),
      /.*\.ProjectImports\.zip/,
    ],
    // Windows: native packages with no Windows version are swapped for stubs
    // (same functions, "not available on this device"). Android and iOS are
    // untouched. See stubs/windows/stubbedModules.js.
    // Web (the Windows app via Tauri): react-native-web stands in for
    // react-native, and packages with no web version are stubbed
    // (stubs/web/stubbedModules.js).
    platforms: [...(defaultConfig.resolver.platforms || []), 'windows', 'web'],
    resolveRequest: (context, moduleName, platform) => {
      const stub =
        platform === 'windows'
          ? windowsStubFor(moduleName)
          : platform === 'web'
            ? webStubFor(moduleName)
            : null;
      if (stub) {
        return {type: 'sourceFile', filePath: stub};
      }
      if (platform === 'web') {
        // Packages' web code (their "browser" entry and .web.js / plain .js
        // files), never their phone code (.native.js).
        const webContext = {
          ...context,
          mainFields: ['browser', 'module', 'main'],
          preferNativePlatform: false,
        };
        if (moduleName === 'react-native/Libraries/Image/AssetRegistry') {
          // Images: react-native-web's own registry.
          return webContext.resolveRequest(
            webContext,
            'react-native-web/dist/modules/AssetRegistry',
            platform,
          );
        }
        if (moduleName === 'react-native') {
          // react-native-web plus the phone-only APIs it lacks.
          return {
            type: 'sourceFile',
            filePath: path.join(__dirname, 'stubs', 'web', 'react-native.js'),
          };
        }
        return webContext.resolveRequest(webContext, moduleName, platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  transformer: {
    babelTransformerPath: require.resolve('./scripts/metro/transformer.cjs'),
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
    // Make sure decorators are properly transformed
    enableBabelRuntime: true,
  },
  //watchFolders: [...localPackagePaths],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
