/**
 * Stub maker for the Windows build (see stubbedModules.js).
 *
 * A stub module answers any name the app (or a library) asks for:
 * - Names in `overrides` are used as given.
 * - Capitalised names (Camera, KeyboardProvider…) are components that just
 *   render their children (or, with components: 'view', a plain View that
 *   keeps its style), so layouts keep working.
 * - `use…` names are hooks that return `hookValue` (default undefined).
 * - Anything else is a function. "native" stubs: calling it fails with
 *   "not available on this device" (a rejected promise, so `await` and
 *   `.catch` work). "ui" stubs: calling it does nothing and returns a
 *   chainable no-op (e.g. Gesture.Pan().onStart(…).onEnd(…)).
 */
const React = require('react');

class NotAvailableError extends Error {
  constructor(what) {
    super(`${what} is not available on this device (Windows).`);
    this.name = 'NotAvailableError';
    this.code = 'not_available';
  }
}

const SKIP = new Set([
  'then',
  'catch',
  'finally',
  '$$typeof',
  'prototype',
  'toJSON',
  'constructor',
]);

function passthrough(displayName) {
  const Component = React.forwardRef(function Stub(props, _ref) {
    return props && props.children !== undefined ? props.children : null;
  });
  Component.displayName = displayName;
  return Component;
}

/** A callable no-op whose every property is itself (for builder chains). */
function chain() {
  const fn = function () {
    return proxy;
  };
  const proxy = new Proxy(fn, {
    get(_t, key) {
      if (typeof key === 'symbol' || SKIP.has(key)) {
        return undefined;
      }
      return proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

function makeStub(
  packageName,
  {mode = 'native', overrides = {}, hookValue, components = 'passthrough'} = {},
) {
  const made = {};
  const answer = key => {
    if (key in overrides) {
      return overrides[key];
    }
    if (key in made) {
      return made[key];
    }
    let value;
    if (/^[A-Z]/.test(key)) {
      // 'view': a plain View that keeps its style (layout containers);
      // 'passthrough': just the children.
      value =
        components === 'view'
          ? require('react-native').View
          : passthrough(`${packageName}.${key}`);
    } else if (/^use[A-Z]/.test(key)) {
      value = () => hookValue;
    } else if (mode === 'ui') {
      value = chain();
    } else {
      value = function notAvailable() {
        return Promise.reject(new NotAvailableError(`${packageName} (${key})`));
      };
    }
    made[key] = value;
    return value;
  };
  const target = {};
  const moduleProxy = new Proxy(target, {
    get(_t, key) {
      if (key === '__esModule') {
        return true;
      }
      if (key === '__isWindowsStub') {
        return packageName;
      }
      if (key === 'default') {
        return 'default' in overrides ? overrides.default : moduleProxy;
      }
      if (typeof key === 'symbol' || SKIP.has(key)) {
        return undefined;
      }
      return answer(key);
    },
    has() {
      return true;
    },
  });
  return moduleProxy;
}

module.exports = {makeStub, NotAvailableError, passthrough, chain};
