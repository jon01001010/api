#!/usr/bin/env node
/**
 * Open-source licences shipped in the app (Settings → App Info → Open-source
 * licences). Collects every library the apps ship with, each library's own
 * licence file and copyright lines, and writes them to
 * src/assets/licenses/third-party.json.
 *
 *   node scripts/licenses/generate.js
 *
 * Covers: the app's JavaScript libraries (phone and desktop), the desktop's
 * native side (src-tauri, Windows + Linux), the phone's home link library
 * (native/homelink, Android), llama.cpp, and the fonts.
 *
 * Kept up to date: the file records fingerprints of the dependency lists
 * (package.json, yarn.lock, Cargo files). A test fails when they change and
 * this was not run again (src/__tests__/licenses.test.ts).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'src', 'assets', 'licenses', 'third-party.json');

/** The files whose change means the list must be made again. */
const INPUTS = [
  'package.json',
  'yarn.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'native/homelink/Cargo.toml',
  'native/homelink/Cargo.lock',
];

const fingerprint = file =>
  crypto
    .createHash('sha256')
    .update(
      fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'),
    )
    .digest('hex');

const LICENSE_FILE =
  /^(licen[cs]e|copying|notice|unlicense|copyright)([-._].*)?$/i;

function licenseFiles(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(n => LICENSE_FILE.test(n))
    .filter(n => {
      try {
        const st = fs.statSync(path.join(dir, n));
        return st.isFile() && st.size < 200 * 1024;
      } catch {
        return false;
      }
    })
    .sort()
    .map(n => fs.readFileSync(path.join(dir, n), 'utf8'));
}

const COPYRIGHT = /^\s*(copyright\b|\(c\)|©)/i;

/** Splits a licence text into its copyright lines and the rest. */
function split(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const copyright = [];
  const body = [];
  for (const line of lines) {
    if (COPYRIGHT.test(line) && line.trim().length < 300) {
      copyright.push(line.trim());
    } else {
      body.push(line.replace(/\s+$/, ''));
    }
  }
  const text2 = body
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {copyright, body: text2};
}

const texts = new Map(); // body -> id
function textId(body) {
  if (!body) {
    return null;
  }
  if (!texts.has(body)) {
    texts.set(body, `t${texts.size + 1}`);
  }
  return texts.get(body);
}

/** "(MIT OR Apache-2.0)", "MIT/Apache-2.0" → "MIT OR Apache-2.0". */
function normalize(license) {
  return String(license || 'unknown')
    .replace(/^\((.*)\)$/, '$1')
    .replace(/\s*\/\s*/g, ' OR ')
    .trim();
}

/** Licences with no file of their own anywhere, by package name. */
const KNOWN = {
  // SQLite is in the public domain; this is its own notice.
  '@nozbe/sqlite': {
    l: 'Public domain (SQLite)',
    text: `The author disclaims copyright to this source code. In place of a legal notice, here is a blessing:

    May you do good and not evil.
    May you find forgiveness for yourself and forgive others.
    May you share freely, never taking more than you give.

https://sqlite.org/copyright.html`,
  },
};

function entry(section, name, version, license, files, extra = {}) {
  if (KNOWN[name] && files.length === 0) {
    license = KNOWN[name].l;
    files = [KNOWN[name].text];
  }
  license = normalize(license);
  const copyright = [];
  const bodies = [];
  for (const file of files) {
    const {copyright: c, body} = split(file);
    copyright.push(...c);
    const id = textId(body);
    if (id && !bodies.includes(id)) {
      bodies.push(id);
    }
  }
  return {
    s: section,
    n: name,
    v: version || '',
    l: license || 'unknown',
    c: [...new Set(copyright)],
    t: bodies,
    ...extra,
  };
}

// ---------------------------------------------------------------- JavaScript

function jsLicense(pj) {
  if (typeof pj.license === 'string') {
    return pj.license;
  }
  if (pj.license && pj.license.type) {
    return pj.license.type;
  }
  if (Array.isArray(pj.licenses)) {
    return pj.licenses.map(l => l.type || l).join(' OR ');
  }
  return 'unknown';
}

function javascript() {
  const seen = new Map();
  const visit = (name, from) => {
    let dir;
    try {
      dir = path.dirname(
        require.resolve(`${name}/package.json`, {paths: [from]}),
      );
    } catch {
      return;
    }
    if (seen.has(dir)) {
      return;
    }
    const pj = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    );
    seen.set(dir, null);
    seen.set(
      dir,
      entry('app', pj.name, pj.version, jsLicense(pj), licenseFiles(dir), {
        a: typeof pj.author === 'string' ? pj.author : pj.author?.name,
      }),
    );
    for (const dep of Object.keys({
      ...pj.dependencies,
      ...pj.optionalDependencies,
    })) {
      visit(dep, dir);
    }
  };
  const pj = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  for (const dep of Object.keys(pj.dependencies)) {
    visit(dep, root);
  }
  // The same name and version can be installed in several folders: once.
  const unique = new Map();
  for (const e of seen.values()) {
    unique.set(`${e.n}@${e.v}`, unique.get(`${e.n}@${e.v}`) || e);
  }
  return [...unique.values()];
}

// ---------------------------------------------------------------------- Rust

function rust(section, manifest, platforms, features) {
  const found = new Map();
  for (const platform of platforms) {
    const args = [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--manifest-path',
      path.join(root, manifest),
      '--filter-platform',
      platform,
    ];
    if (features) {
      args.push('--features', features);
    }
    const meta = JSON.parse(
      execFileSync('cargo', args, {
        maxBuffer: 256 * 1024 * 1024,
        encoding: 'utf8',
      }),
    );
    const byId = new Map(meta.packages.map(p => [p.id, p]));
    const nodes = new Map(meta.resolve.nodes.map(n => [n.id, n]));
    // Follow normal dependencies from the app (build-only tools are not shipped).
    const stack = [meta.resolve.root];
    const reach = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (reach.has(id)) {
        continue;
      }
      reach.add(id);
      for (const dep of nodes.get(id)?.deps || []) {
        if (dep.dep_kinds.some(k => k.kind === null)) {
          stack.push(dep.pkg);
        }
      }
    }
    reach.delete(meta.resolve.root);
    for (const id of reach) {
      const p = byId.get(id);
      const key = `${p.name}@${p.version}`;
      if (!found.has(key)) {
        found.set(
          key,
          entry(
            section,
            p.name,
            p.version,
            p.license || (p.license_file ? 'see licence file' : 'unknown'),
            licenseFiles(path.dirname(p.manifest_path)),
            {a: p.authors?.[0]},
          ),
        );
      }
    }
  }
  return [...found.values()];
}

// -------------------------------------------------------- files we keep

const asset = (...p) =>
  fs.readFileSync(path.join(root, 'src', 'assets', 'licenses', ...p), 'utf8');

function extras() {
  return [
    entry(
      'base',
      'PocketPal AI',
      '',
      'MIT',
      [fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')],
      {
        u: 'https://github.com/a-ghorbani/pocketpal-ai',
      },
    ),
    entry(
      'native',
      'llama.cpp (model runner)',
      'b11662',
      'MIT',
      [asset('native', 'llama.cpp-LICENSE.txt')],
      {
        u: 'https://github.com/ggml-org/llama.cpp',
      },
    ),
    entry(
      'native',
      'LLVM OpenMP runtime (in the Windows model runner)',
      '',
      'Apache-2.0 WITH LLVM-exception',
      [asset('native', 'llvm-openmp-LICENSE.txt')],
      {u: 'https://github.com/llvm/llvm-project'},
    ),
    entry('fonts', 'Inter', '', 'OFL-1.1', [asset('fonts', 'Inter-OFL.txt')], {
      u: 'https://github.com/rsms/inter',
    }),
    entry(
      'fonts',
      'Fraunces',
      '',
      'OFL-1.1',
      [asset('fonts', 'Fraunces-OFL.txt')],
      {
        u: 'https://github.com/undercasetype/Fraunces',
      },
    ),
    entry(
      'fonts',
      'JetBrains Mono',
      '',
      'OFL-1.1',
      [asset('fonts', 'JetBrainsMono-OFL.txt')],
      {
        u: 'https://github.com/JetBrains/JetBrainsMono',
      },
    ),
  ];
}

// ---------------------------------------------------------------------- main

function main() {
  const packages = [
    ...extras(),
    ...javascript(),
    ...rust('desktop', 'src-tauri/Cargo.toml', [
      'x86_64-pc-windows-msvc',
      'x86_64-unknown-linux-gnu',
    ]),
    ...rust(
      'phone-native',
      'native/homelink/Cargo.toml',
      ['aarch64-linux-android'],
      'android',
    ),
  ];
  const order = {
    base: 0,
    native: 1,
    fonts: 2,
    app: 3,
    desktop: 4,
    'phone-native': 5,
  };
  packages.sort(
    (a, b) =>
      order[a.s] - order[b.s] ||
      a.n.localeCompare(b.n) ||
      a.v.localeCompare(b.v, undefined, {numeric: true}),
  );
  // For a library without its own licence file: the most common text for
  // its licence, taken from other libraries' own files.
  const usage = {};
  for (const p of packages) {
    if (p.t.length === 1) {
      usage[p.l] = usage[p.l] || {};
      usage[p.l][p.t[0]] = (usage[p.l][p.t[0]] || 0) + 1;
    }
  }
  const standard = {};
  for (const [lic, counts] of Object.entries(usage)) {
    standard[lic] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  // "Apache-2.0 OR MIT" with no single-text example: the first of its
  // choices that has one.
  for (const p of packages) {
    if (p.t.length === 0 && !standard[p.l]) {
      const choice = p.l.split(/\s+OR\s+/).find(part => standard[part]);
      if (choice) {
        standard[p.l] = standard[choice];
      }
    }
  }
  const result = {
    note: 'Made by scripts/licenses/generate.js. Do not edit by hand.',
    inputs: Object.fromEntries(INPUTS.map(f => [f, fingerprint(f)])),
    standard,
    texts: Object.fromEntries(
      [...texts.entries()].map(([body, id]) => [id, body]),
    ),
    packages,
  };
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(result) + '\n');
  const missing = packages.filter(p => p.t.length === 0 && !standard[p.l]);
  console.log(
    `${packages.length} libraries, ${texts.size} distinct licence texts, ${(
      fs.statSync(out).size / 1024
    ).toFixed(0)} KB → ${path.relative(root, out)}`,
  );
  if (missing.length) {
    console.log(`${missing.length} without any licence text:`);
    for (const p of missing) {
      console.log(`  ${p.s} ${p.n}@${p.v} (${p.l})`);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {INPUTS, fingerprint, split};
