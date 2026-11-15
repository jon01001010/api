/**
 * Shared by the Android stubs (see stubbedModules.js): a call that can't
 * work in this build fails with "not available", never silently.
 */
class NotAvailableError extends Error {
  constructor(what) {
    super(`${what} is not available in PocketAgent.`);
    this.name = 'NotAvailableError';
    this.code = 'not_available';
  }
}

/** A function that always rejects with NotAvailableError. */
const notAvailable = what =>
  function notAvailableCall() {
    return Promise.reject(new NotAvailableError(what));
  };

module.exports = {NotAvailableError, notAvailable};
