#!/usr/bin/env node
/**
 * Writes src/assets/build-info.json: which commit this build was made from.
 * Both builds (the Android APK and the desktop app) run this first, so the
 * two apps can show they match (App Info) and the home link can say when
 * they don't. Without it (local builds) the committed file says "dev".
 *
 *   node scripts/build-info/write.js            (uses GITHUB_SHA / git)
 */
const fs = require('node:fs');
const path = require('node:path');
const {execSync} = require('node:child_process');

let commit = process.env.GITHUB_SHA || '';
if (!commit) {
  try {
    commit = execSync('git rev-parse HEAD', {encoding: 'utf8'}).trim();
  } catch {
    commit = 'dev';
  }
}
const info = {
  commit: commit.slice(0, 12),
  run: process.env.GITHUB_RUN_ID || '',
  builtAt: new Date().toISOString(),
};
const out = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'assets',
  'build-info.json',
);
fs.writeFileSync(out, JSON.stringify(info, null, 2) + '\n');
console.log(`build ${info.commit} → ${path.relative(process.cwd(), out)}`);
