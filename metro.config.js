const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const fs = require('fs');
const path = require('node:path');

//const localPackagePaths = ['localpath/code/llama.rn'];

const {windowsStubFor} = require('./stubs/windows/stubbedModules');

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
    resolveRequest: (context, moduleName, platform) => {
      const stub = platform === 'windows' ? windowsStubFor(moduleName) : null;
      if (stub) {
        return {type: 'sourceFile', filePath: stub};
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
