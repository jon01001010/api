/**
 * @dr.pogodin/react-native-fs on Windows, kept in memory: its Windows code
 * is old-style and can't be built on react-native-windows 0.82. Files
 * (memory notes, the workspace, custom tools) work while the app is open and
 * are lost when it closes (TODO: the Windows storage module). Downloads say
 * "not available": Windows models come from the bundled server (step 2).
 */
const {NotAvailableError} = require('./_stub');

// Same space as the .exe's own folder (src-tauri/src/files.rs: /pocketagent).
const ROOT = '/pocketagent';
const files = new Map();
const dirs = new Set([ROOT]);

const clean = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
const parentOf = p => p.slice(0, p.lastIndexOf('/'));
const missing = p => {
  const e = new Error(`ENOENT: no such file or directory, '${p}'`);
  e.code = 'ENOENT';
  return e;
};
const addDirs = p => {
  for (let d = p; d && d.includes('/') && !dirs.has(d); d = parentOf(d)) {
    dirs.add(d);
  }
};
const entry = p => ({
  name: p.slice(p.lastIndexOf('/') + 1),
  path: p,
  size: files.has(p) ? files.get(p).length : 0,
  mtime: new Date(),
  ctime: new Date(),
  isFile: () => files.has(p),
  isDirectory: () => dirs.has(p),
});

const fs = {
  DocumentDirectoryPath: `${ROOT}/Documents`,
  CachesDirectoryPath: `${ROOT}/Caches`,
  LibraryDirectoryPath: `${ROOT}/Library`,
  ExternalDirectoryPath: `${ROOT}/External`,
  DownloadDirectoryPath: `${ROOT}/Downloads`,
  TemporaryDirectoryPath: `${ROOT}/Temp`,
  MainBundlePath: `${ROOT}/App`,

  exists: async p => files.has(clean(p)) || dirs.has(clean(p)),
  mkdir: async p => {
    addDirs(clean(p));
  },
  writeFile: async (p, content) => {
    const path = clean(p);
    addDirs(parentOf(path));
    files.set(path, String(content));
  },
  appendFile: async (p, content) => {
    const path = clean(p);
    addDirs(parentOf(path));
    files.set(path, (files.get(path) || '') + String(content));
  },
  readFile: async p => {
    const path = clean(p);
    if (!files.has(path)) {
      throw missing(path);
    }
    return files.get(path);
  },
  unlink: async p => {
    const path = clean(p);
    if (!files.has(path) && !dirs.has(path)) {
      throw missing(path);
    }
    files.delete(path);
    for (const key of [...files.keys()]) {
      if (key.startsWith(path + '/')) {
        files.delete(key);
      }
    }
    for (const d of [...dirs]) {
      if (d === path || d.startsWith(path + '/')) {
        dirs.delete(d);
      }
    }
  },
  copyFile: async (from, to) => {
    await fs.writeFile(to, await fs.readFile(from));
  },
  moveFile: async (from, to) => {
    await fs.copyFile(from, to);
    await fs.unlink(from);
  },
  stat: async p => {
    const path = clean(p);
    if (!files.has(path) && !dirs.has(path)) {
      throw missing(path);
    }
    return entry(path);
  },
  readDir: async p => {
    const path = clean(p);
    if (!dirs.has(path)) {
      throw missing(path);
    }
    const children = [...files.keys(), ...dirs].filter(
      c => parentOf(c) === path && c !== path,
    );
    return [...new Set(children)].map(entry);
  },
  hash: async () => {
    throw new NotAvailableError('File checksums');
  },
  downloadFile: () => ({
    jobId: -1,
    promise: Promise.reject(new NotAvailableError('Downloading files')),
  }),
  stopDownload: () => {},
};

module.exports = {__esModule: true, default: fs, ...fs};
