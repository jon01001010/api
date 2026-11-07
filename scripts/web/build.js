#!/usr/bin/env node
/**
 * Builds the web version (the Windows app via Tauri) into web/dist:
 * index.html + bundle.js + assets. Uses Metro with platform "web", so the
 * same stubs/resolver rules as the other platforms apply (metro.config.js).
 *   node scripts/web/build.js [--release]
 */
const {execFileSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'web', 'dist');
const release = process.argv.includes('--release');

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
execFileSync(
  // Node runs React Native's CLI directly: no npx (on Windows that is
  // npx.cmd, which Node can't start this way).
  process.execPath,
  [
    require.resolve('react-native/cli.js'),
    'bundle',
    '--platform',
    'web',
    '--dev',
    String(!release),
    '--minify',
    String(release),
    '--entry-file',
    'web/start.js',
    '--bundle-output',
    path.join(out, 'bundle.js'),
    '--assets-dest',
    out,
  ],
  {cwd: root, stdio: 'inherit'},
);
// Fonts: the app's own (named by file, e.g. 'Inter-Regular') and the icon
// fonts it uses, loaded by @font-face rules added to the page.
const fontDir = path.join(out, 'fonts');
fs.mkdirSync(fontDir, {recursive: true});
const fonts = [
  ...fs
    .readdirSync(path.join(root, 'src', 'assets', 'fonts'))
    .filter(f => f.endsWith('.ttf'))
    .map(f => path.join(root, 'src', 'assets', 'fonts', f)),
  ...['MaterialCommunityIcons.ttf', 'MaterialIcons.ttf'].map(f =>
    path.join(root, 'node_modules', 'react-native-vector-icons', 'Fonts', f),
  ),
];
const faces = fonts
  .map(file => {
    const name = path.basename(file, '.ttf');
    fs.copyFileSync(file, path.join(fontDir, name + '.ttf'));
    return `@font-face { font-family: '${name}'; src: url('fonts/${name}.ttf') format('truetype'); }`;
  })
  .join('\n      ');
const html = fs
  .readFileSync(path.join(root, 'web', 'index.html'), 'utf8')
  .replace('/* FONTS */', faces);
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('Web build written to', path.relative(root, out));
