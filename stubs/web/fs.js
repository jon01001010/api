/**
 * Files on the web build. Inside the .exe: real files through the native
 * side (the app's own folder needs no prompt; anywhere else asks first, on
 * the native side). In a plain browser: in memory (stubs/windows/memory-fs).
 */
const {isTauri, invoke} = require('./tauri');
const memory = require('../windows/memory-fs.js').default;

const toEntry = e => ({
  name: e.name,
  path: e.path,
  size: e.size,
  mtime: new Date(e.mtime_ms),
  ctime: new Date(e.mtime_ms),
  isFile: () => e.is_file,
  isDirectory: () => e.is_dir,
});
const enc = encoding =>
  encoding === 'base64' || (encoding && encoding.encoding === 'base64')
    ? 'base64'
    : 'utf8';

const native = {
  ...memory,
  exists: path => invoke('fs_exists', {path}),
  readFile: (path, encoding) =>
    invoke('fs_read', {path, encoding: enc(encoding)}),
  writeFile: (path, content, encoding) =>
    invoke('fs_write', {
      path,
      content: String(content),
      encoding: enc(encoding),
      append: false,
    }),
  appendFile: (path, content, encoding) =>
    invoke('fs_write', {
      path,
      content: String(content),
      encoding: enc(encoding),
      append: true,
    }),
  mkdir: path => invoke('fs_mkdir', {path}),
  readDir: async path => (await invoke('fs_list', {path})).map(toEntry),
  stat: async path => toEntry(await invoke('fs_stat', {path})),
  unlink: path => invoke('fs_remove', {path}),
  copyFile: (from, to) => invoke('fs_copy', {from, to}),
  moveFile: (from, to) => invoke('fs_move', {from, to}),
};

const fs = isTauri() ? native : memory;
module.exports = {__esModule: true, default: fs, ...fs};
