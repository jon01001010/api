/**
 * Which commit this app was built from (scripts/build-info/write.js runs in
 * both builds). "dev" for local builds. Shown in App Info; the home link
 * compares the phone's and the PC's.
 */
const info = require('../assets/build-info.json') as {
  commit: string;
  version?: string;
  run: string;
  builtAt: string;
};

/** "1.21.338": the same on the phone and the PC built from one commit. */
export const buildVersion = (): string => info.version || 'dev';

export const buildCommit = (): string => info.commit || 'dev';

/** "Build 1a2b3c4" (7 characters, like GitHub shows). */
export const buildLabel = (): string =>
  buildCommit() === 'dev'
    ? 'Build: development'
    : `Build ${buildCommit().slice(0, 7)}`;

/** True when two builds are known and differ ("dev" never warns). */
export function buildsDiffer(a?: string | null, b?: string | null): boolean {
  if (!a || !b || a === 'dev' || b === 'dev') {
    return false;
  }
  const n = Math.min(a.length, b.length, 12);
  return a.slice(0, n) !== b.slice(0, n);
}
