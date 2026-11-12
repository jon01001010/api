#!/usr/bin/env node
/**
 * Writes src/assets/build-info.json: which commit this build was made from
 * and its version. Every build (the Android APK and the desktop apps) runs
 * this first, so the apps can show they match (App Info) and the home link
 * can say when they don't. Without it (local builds) the file says "dev".
 *
 * Version (same for the phone and the PC from the same commit): 1.21.<number
 * of commits>, so each later commit is a higher version and installs over
 * the one before (Windows installer, Android update). Android's version code
 * is 1000 + that number (above PocketPal's 151, already on phones).
 *
 *   node scripts/build-info/write.js            build-info.json only
 *   node scripts/build-info/write.js --apply    also the version in the
 *        desktop config and the Android build (CI; not committed)
 * Needs the full history (actions/checkout fetch-depth: 0) for the count.
 */
const fs = require('node:fs');
const path = require('node:path');
const {execSync} = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const git = cmd => {
  try {
    return execSync(`git ${cmd}`, {encoding: 'utf8', cwd: root}).trim();
  } catch {
    return '';
  }
};

let commit = process.env.GITHUB_SHA || git('rev-parse HEAD') || 'dev';
const count = Number(git('rev-list --count HEAD')) || 0;

/** The version for a commit count (exported for tests). */
function versionFor(n) {
  return {version: `1.21.${n}`, versionCode: 1000 + n};
}

function applyVersion(v) {
  const conf = path.join(root, 'src-tauri', 'tauri.conf.json');
  const json = JSON.parse(fs.readFileSync(conf, 'utf8'));
  json.version = v.version;
  fs.writeFileSync(conf, JSON.stringify(json, null, 2) + '\n');
  const gradle = path.join(root, 'android', 'app', 'build.gradle');
  const text = fs
    .readFileSync(gradle, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${v.versionCode}`)
    .replace(/versionName "[^"]*"/, `versionName "${v.version}"`);
  fs.writeFileSync(gradle, text);
}

if (require.main === module) {
  const v = count ? versionFor(count) : {version: 'dev', versionCode: 0};
  const info = {
    commit: commit.slice(0, 12),
    version: v.version,
    run: process.env.GITHUB_RUN_ID || '',
    builtAt: new Date().toISOString(),
  };
  const out = path.join(root, 'src', 'assets', 'build-info.json');
  fs.writeFileSync(out, JSON.stringify(info, null, 2) + '\n');
  if (process.argv.includes('--apply')) {
    if (!count) {
      throw new Error('No commit count: check out with fetch-depth: 0');
    }
    applyVersion(v);
  }
  console.log(
    `build ${info.commit}, version ${v.version} → ${path.relative(process.cwd(), out)}`,
  );
}

module.exports = {versionFor};
