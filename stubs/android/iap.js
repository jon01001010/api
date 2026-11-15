/**
 * Google Play billing (react-native-iap), Android: not built in (no Google,
 * no purchases: src/config/freeBuild.ts; react-native.config.js unlinks the
 * native library, and with it Google's billing library). Every store call
 * says "not available"; listeners are accepted and never fire. The purchase
 * code stays in place (stubbed, not removed).
 */
const {notAvailable} = require('./notAvailable');

const what = 'Google Play billing';

const ErrorCode = {
  AlreadyOwned: 'already-owned',
  BillingUnavailable: 'billing-unavailable',
  DeferredPayment: 'deferred-payment',
  DeveloperError: 'developer-error',
  DuplicatePurchase: 'duplicate-purchase',
  FeatureNotSupported: 'feature-not-supported',
  IapNotAvailable: 'iap-not-available',
  ItemUnavailable: 'item-unavailable',
  NetworkError: 'network-error',
  Pending: 'pending',
  ServiceError: 'service-error',
  SkuNotFound: 'sku-not-found',
  Unknown: 'unknown',
  UserCancelled: 'user-cancelled',
};

const listener = () => ({remove() {}});

module.exports = {
  ErrorCode,
  initConnection: notAvailable(what),
  endConnection: () => Promise.resolve(true),
  fetchProducts: notAvailable(what),
  requestPurchase: notAvailable(what),
  getAvailablePurchases: notAvailable(what),
  getPendingTransactionsIOS: notAvailable(what),
  finishTransaction: notAvailable(what),
  acknowledgePurchaseAndroid: notAvailable(what),
  consumePurchaseAndroid: notAvailable(what),
  getStorefront: notAvailable(what),
  syncIOS: notAvailable(what),
  purchaseUpdatedListener: listener,
  purchaseErrorListener: listener,
  __pocketAgentStub: what,
};
