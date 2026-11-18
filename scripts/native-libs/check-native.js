#!/usr/bin/env node
/**
 * Checks llama.rn's native libraries in node_modules file by file against
 * the SHA-256 list kept here (native-<version>.sha256), whether they were
 * just downloaded or restored from a build cache. llama.rn's own download
 * checks the archive, but a cached copy is trusted by its marker file alone
 * (.llama-rn.sha256, which only says which archive it came from); this
 * checks what is really there (security review 2, 2026-11-18).
 *
 * The list was made from llama.rn's release archives for the version in
 * yarn.lock, each first checked against the SHA-256 in llama.rn's
 * install/native-artifacts.json, extracted into an empty folder, then:
 *   find . -type f | LC_ALL=C sort | sed 's|^\./||' | xargs -d '\n' sha256sum
 * A new llama.rn version needs a new list (this says so and fails).
 *
 * Usage: node scripts/native-libs/check-native.js [path to llama.rn]
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIRS = ['android/src/main/jniLibs', 'ios/rnllama.xcframework'];
const MARKER = '.llama-rn.sha256';

/** Every file under `dir` (relative to `root`, with /); throws on a link. */
function filesUnder(root, dir) {
  const out = [];
  const walk = rel => {
    for (const entry of fs.readdirSync(path.join(root, rel), {
      withFileTypes: true,
    })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(`a link: ${child}`);
      }
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.name !== MARKER) {
        out.push(child);
      }
    }
  };
  walk(dir);
  return out;
}

/** The list as {path: sha256}; Windows line ends allowed. */
function parseList(text) {
  const list = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) {
      throw new Error(`not a SHA-256 line: ${line}`);
    }
    list.set(m[2], m[1]);
  }
  return list;
}

/** Problems found (none: all files match exactly). */
function check(pkg, list) {
  const problems = [];
  let found;
  try {
    found = DIRS.flatMap(d => filesUnder(pkg, d));
  } catch (e) {
    return [String(e.message || e)];
  }
  const seen = new Set(found);
  for (const file of found) {
    if (!list.has(file)) {
      problems.push(`not listed: ${file}`);
    }
  }
  for (const [file, sha] of list) {
    if (!seen.has(file)) {
      problems.push(`missing: ${file}`);
      continue;
    }
    const got = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(pkg, file)))
      .digest('hex');
    if (got !== sha) {
      problems.push(`SHA-256 differs: ${file}`);
    }
  }
  return problems;
}

function main() {
  const pkg = path.resolve(process.argv[2] || 'node_modules/llama.rn');
  const {version} = JSON.parse(
    fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'),
  );
  const listFile = path.join(__dirname, `native-${version}.sha256`);
  if (!fs.existsSync(listFile)) {
    console.error(
      `::error::No SHA-256 list for llama.rn ${version}'s native libraries (${listFile}): make one as described in ${__filename}.`,
    );
    process.exit(1);
  }
  const list = parseList(fs.readFileSync(listFile, 'utf8'));
  const problems = check(pkg, list);
  if (problems.length) {
    console.error(
      "::error::llama.rn's native libraries are not exactly the listed files.",
    );
    problems.slice(0, 20).forEach(p => console.error(p));
    process.exit(1);
  }
  console.log(
    `llama.rn ${version} native libraries: all ${list.size} files match.`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {check, parseList};
