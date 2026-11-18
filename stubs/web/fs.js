/**
 * Files on the web build. Inside the .exe: real files through the native
 * side, in the app's own folder only (anywhere else is refused there). In a plain browser: in memory (stubs/windows/memory-fs).
 */
const {isTauri, invoke, Channel} = require('./tauri');

let nextDownload = 1;

/**
 * RNFS.downloadFile through the native side (src-tauri/src/download.rs):
 * streamed to disk, with begin / progress callbacks like on the phone. Desktop
 * extra: `sha256` (expected; a mismatch deletes the file) in, the file's
 * `sha256` out.
 */
function downloadFile(options) {
  const jobId = nextDownload++;
  const promise = new Promise((resolve, reject) => {
    const channel = new Channel(event => {
      if (event.type === 'begin') {
        options.begin &&
          options.begin({
            jobId,
            statusCode: event.statusCode,
            contentLength: event.contentLength,
            headers: {},
          });
      } else if (event.type === 'progress') {
        options.progress &&
          options.progress({
            jobId,
            bytesWritten: event.bytesWritten,
            contentLength: event.contentLength,
          });
      } else if (event.type === 'done') {
        resolve({
          jobId,
          statusCode: event.statusCode,
          bytesWritten: event.bytesWritten,
          // Worked out on the native side while the file streamed.
          sha256: event.sha256,
        });
      } else if (event.type === 'error') {
        reject(new Error(event.message));
      }
    });
    invoke('fs_download', {
      id: jobId,
      url: options.fromUrl,
      path: options.toFile,
      headers: Object.entries(options.headers || {}).map(([k, v]) => [
        k,
        String(v),
      ]),
      // Optional: a file with another SHA-256 is deleted, never kept.
      sha256: options.sha256 || null,
      onEvent: channel,
    }).catch(error => reject(new Error(String(error))));
  });
  return {jobId, promise};
}

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
  // SHA-256 only, of the app's own files (its downloaded models), worked out
  // on the native side in pieces; anything else is refused there.
  hash: (path, algorithm) =>
    String(algorithm).toLowerCase() === 'sha256'
      ? invoke('fs_hash', {path, algorithm: 'sha256'})
      : Promise.reject(new Error(`Only sha256 is supported, not ${algorithm}`)),
  downloadFile,
  stopDownload: jobId => {
    invoke('fs_download_cancel', {id: jobId}).catch(() => {});
  },
};

const fs = isTauri() ? native : memory;
module.exports = {__esModule: true, default: fs, ...fs};
