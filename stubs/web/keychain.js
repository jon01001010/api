/**
 * react-native-keychain on the web build. Inside the .exe: Windows
 * Credential Manager through the native side. In a plain browser: not
 * available (keys are never kept unprotected).
 */
const {isTauri, invoke} = require('./tauri');
const {NotAvailableError} = require('../windows/_stub');

const serviceOf = options => (options && options.service) || 'default';

const Keychain = {
  getGenericPassword: async options => {
    if (!isTauri()) {
      throw new NotAvailableError('Saved keys');
    }
    const found = await invoke('secret_get', {service: serviceOf(options)});
    return found
      ? {
          username: found.username,
          password: found.password,
          service: serviceOf(options),
        }
      : false;
  },
  setGenericPassword: async (username, password, options) => {
    if (!isTauri()) {
      throw new NotAvailableError('Saving keys');
    }
    await invoke('secret_set', {
      service: serviceOf(options),
      username: String(username),
      password: String(password),
    });
    return {service: serviceOf(options), storage: 'WindowsCredentialManager'};
  },
  resetGenericPassword: async options => {
    if (!isTauri()) {
      return false;
    }
    await invoke('secret_delete', {service: serviceOf(options)});
    return true;
  },
  ACCESSIBLE: new Proxy({}, {get: (_t, k) => String(k)}),
  SECURITY_LEVEL: new Proxy({}, {get: (_t, k) => String(k)}),
  STORAGE_TYPE: new Proxy({}, {get: (_t, k) => String(k)}),
};

module.exports = {__esModule: true, default: Keychain, ...Keychain};
