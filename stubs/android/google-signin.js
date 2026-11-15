/**
 * Google Sign-In, Android: not built in (no Google; react-native.config.js
 * unlinks the native library). Signing in says "not available"; signing out
 * and "who is signed in" answer "nobody", so PalsHub's sign-out still works.
 * The PalsHub code that would use it stays in place (stubbed, not removed).
 */
const {notAvailable} = require('./notAvailable');

const what = 'Google Sign-In';

const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
};

const GoogleSignin = {
  configure() {},
  hasPlayServices: notAvailable(what),
  signIn: notAvailable(what),
  signInSilently: notAvailable(what),
  addScopes: notAvailable(what),
  getTokens: notAvailable(what),
  clearCachedAccessToken: notAvailable(what),
  getCurrentUser: () => null,
  hasPreviousSignIn: () => false,
  signOut: () => Promise.resolve(null),
  revokeAccess: () => Promise.resolve(null),
};

const isErrorWithCode = error =>
  !!error && typeof error === 'object' && typeof error.code === 'string';

module.exports = {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
  isSuccessResponse: () => false,
  isCancelledResponse: () => false,
  isNoSavedCredentialFoundResponse: () => true,
  GoogleSigninButton: () => null,
  __pocketAgentStub: what,
};
