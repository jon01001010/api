/**
 * One version for the phone and the PC built from the same commit, always
 * higher for a later commit, so each install upgrades the one before.
 */
const {versionFor} = require('../write');

it('counts commits, above the version code already on phones', () => {
  expect(versionFor(338)).toEqual({version: '1.21.338', versionCode: 1338});
  expect(versionFor(339).versionCode).toBeGreaterThan(
    versionFor(338).versionCode,
  );
  // PocketPal's version code (151) is already on phones: always above it.
  expect(versionFor(1).versionCode).toBeGreaterThan(151);
});
