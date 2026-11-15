/**
 * Android: Google Sign-In and Google Play billing are not built in (no
 * Google). See stubs/android/stubbedModules.js and SECURITY.md rule 7.
 */
const fs = require('fs');
const path = require('path');

const {STUBS, androidStubFor} = require('../stubbedModules');

const root = path.join(__dirname, '..', '..', '..');

describe('Google services on Android', () => {
  it('Google Sign-In and Play billing are unlinked from the Android build', () => {
    const config = jest.requireActual(path.join(root, 'react-native.config.js'));
    for (const name of [
      '@react-native-google-signin/google-signin',
      'react-native-iap',
    ]) {
      expect([name, config.dependencies[name]?.platforms?.android]).toEqual([
        name,
        null,
      ]);
      // ...and their JavaScript is stubbed there.
      expect(androidStubFor(name)).not.toBeNull();
    }
  });

  it('every package unlinked on Android is stubbed or never loaded', () => {
    const config = jest.requireActual(path.join(root, 'react-native.config.js'));
    const unlinked = Object.entries(config.dependencies)
      .filter(([, c]) => c.platforms && c.platforms.android === null)
      .map(([name]) => name);
    // Firebase: only src/utils/fb.ts, which nothing calls (config/outside.ts
    // refuses first). Apple sign-in: its JS checks for the native side itself.
    const handledElsewhere = [
      '@react-native-firebase/app',
      '@react-native-firebase/app-check',
      '@invertase/react-native-apple-authentication',
    ];
    expect(
      unlinked.filter(
        name => !(name in STUBS) && !handledElsewhere.includes(name),
      ),
    ).toEqual([]);
  });

  it('metro uses the Android stubs for Android only', () => {
    const metro = fs.readFileSync(path.join(root, 'metro.config.js'), 'utf8');
    expect(metro).toMatch(
      /platform === 'android'\s*\?\s*androidStubFor\(moduleName\)/,
    );
    expect(androidStubFor('react-native-iap/lib/module/index')).toBe(
      STUBS['react-native-iap'],
    );
    expect(androidStubFor('react-native')).toBeNull();
    expect(androidStubFor('react-native-iapx')).toBeNull();
  });

  it('nothing in the Android build pulls in Google sign-in, billing or Play services', () => {
    const gradle = ['app/build.gradle', 'build.gradle', 'settings.gradle']
      .map(f => path.join(root, 'android', f))
      .filter(f => fs.existsSync(f))
      .map(f => fs.readFileSync(f, 'utf8'))
      .join('\n')
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');
    expect(gradle).not.toMatch(/com\.google\.android\.gms/);
    expect(gradle).not.toMatch(/com\.android\.billingclient/);
    expect(gradle).not.toMatch(/com\.google\.firebase/);
    expect(gradle).not.toMatch(/google-services/);
  });

  it('signing in with Google says "not available"; signing out still works', async () => {
    const {GoogleSignin, statusCodes} = jest.requireActual(
      STUBS['@react-native-google-signin/google-signin'],
    );
    expect(() => GoogleSignin.configure({webClientId: 'x'})).not.toThrow();
    await expect(GoogleSignin.hasPlayServices()).rejects.toMatchObject({
      code: 'not_available',
    });
    await expect(GoogleSignin.signIn()).rejects.toThrow(/not available/);
    expect(GoogleSignin.getCurrentUser()).toBeNull();
    await expect(GoogleSignin.signOut()).resolves.toBeNull();
    expect(statusCodes.SIGN_IN_CANCELLED).toBe('SIGN_IN_CANCELLED');
  });

  it('every store call says "not available" and listeners never fire', async () => {
    const iap = jest.requireActual(STUBS['react-native-iap']);
    for (const name of [
      'initConnection',
      'fetchProducts',
      'requestPurchase',
      'getAvailablePurchases',
      'finishTransaction',
      'getStorefront',
    ]) {
      await expect(iap[name]()).rejects.toMatchObject({code: 'not_available'});
    }
    const sub = iap.purchaseUpdatedListener(() => {
      throw new Error('should never fire');
    });
    expect(() => sub.remove()).not.toThrow();
    expect(iap.ErrorCode.UserCancelled).toBe('user-cancelled');
  });
});
