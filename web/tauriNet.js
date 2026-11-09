/* eslint-env browser */
/**
 * Network inside the .exe. The web view has no internet access of its own
 * (its content security policy allows only the app and the native bridge),
 * so `fetch` and `XMLHttpRequest` to outside addresses go through the native
 * side (src-tauri/src/net.rs), which streams the reply back in pieces. That
 * also removes the browser's cross-site limits, like on the phone.
 * Requests to the app itself are left alone. Not used in a plain browser.
 */
import {Channel, invoke} from '@tauri-apps/api/core';

let nextId = 1;

/**
 * True for addresses that leave the app (http/https elsewhere). The app's
 * own addresses are never outside: on Windows the native bridge itself is
 * `http://ipc.localhost/…` (and the app `http://tauri.localhost`); sending
 * those through the bridge made every native call call itself until the
 * page gave up (the 40 s Windows start).
 */
export function isOutside(url, origin) {
  try {
    const parsed = new URL(url, origin);
    const host = parsed.hostname.replace(/\.$/, '').toLowerCase();
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin !== origin &&
      !host.endsWith('.localhost')
    );
  } catch (e) {
    return false;
  }
}

function headerPairs(headers) {
  if (!headers) {
    return [];
  }
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return [...headers.entries()];
  }
  if (Array.isArray(headers)) {
    return headers.map(([k, v]) => [String(k), String(v)]);
  }
  return Object.entries(headers).map(([k, v]) => [k, String(v)]);
}

/** Sends one request through the native side; events: head, chunk, end, error. */
function bridge({method, url, headers, body}, onEvent) {
  const id = nextId++;
  const channel = new Channel(onEvent);
  invoke('http_request', {
    id,
    method: method || 'GET',
    url,
    headers: headerPairs(headers),
    body: body == null ? null : String(body),
    onEvent: channel,
  }).catch(error => onEvent({type: 'error', message: String(error)}));
  return () => invoke('http_abort', {id}).catch(() => {});
}

function bridgedFetch(originalFetch) {
  return function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    if (!isOutside(url, window.location.origin)) {
      return originalFetch(input, init);
    }
    return new Promise((resolve, reject) => {
      const encoder = new TextEncoder();
      let controller;
      const stream = new ReadableStream({
        start(c) {
          controller = c;
        },
      });
      let settled = false;
      const abort = bridge(
        {
          method:
            init.method || (typeof input === 'string' ? 'GET' : input.method),
          url,
          headers:
            init.headers ||
            (typeof input === 'string' ? undefined : input.headers),
          body: init.body,
        },
        event => {
          if (event.type === 'head') {
            settled = true;
            const status = event.status;
            const response = new Response(
              status === 204 || status === 304 ? null : stream,
              {status, headers: event.headers},
            );
            Object.defineProperty(response, 'url', {value: event.url});
            resolve(response);
          } else if (event.type === 'chunk') {
            controller.enqueue(encoder.encode(event.data));
          } else if (event.type === 'end') {
            controller.close();
          } else if (event.type === 'error') {
            const error = new TypeError(
              `Network request failed: ${event.message}`,
            );
            if (settled) {
              controller.error(error);
            } else {
              reject(error);
            }
          }
        },
      );
      if (init.signal) {
        const onAbort = () => {
          abort();
          const error = new DOMException('Aborted', 'AbortError');
          if (settled) {
            controller.error(error);
          } else {
            reject(error);
          }
        };
        if (init.signal.aborted) {
          onAbort();
        } else {
          init.signal.addEventListener('abort', onAbort, {once: true});
        }
      }
    });
  };
}

/**
 * XMLHttpRequest for outside addresses (chat streaming uses it). Requests
 * to the app itself use the browser's own XMLHttpRequest.
 */
function bridgedXHR(OriginalXHR) {
  return class BridgedXMLHttpRequest {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.statusText = '';
      this.responseText = '';
      this.responseURL = '';
      this.timeout = 0;
      this.withCredentials = false;
      this.upload = {addEventListener() {}};
      this._headers = [];
      this._responseHeaders = [];
      this._listeners = {};
      this._native = null;
    }
    get response() {
      return this._native ? this._native.response : this.responseText;
    }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    removeEventListener(type, fn) {
      this._listeners[type] = (this._listeners[type] || []).filter(
        f => f !== fn,
      );
    }
    _emit(type) {
      const event = {type, target: this, currentTarget: this};
      const handler = this[`on${type}`];
      if (typeof handler === 'function') {
        handler.call(this, event);
      }
      (this._listeners[type] || []).forEach(fn => fn.call(this, event));
    }
    _setState(state) {
      this.readyState = state;
      this._emit('readystatechange');
    }
    open(method, url) {
      this._method = method;
      this._url = url;
      if (!isOutside(url, window.location.origin)) {
        // The app itself: a real XMLHttpRequest, with its events passed on.
        const native = new OriginalXHR();
        this._native = native;
        native.open(method, url, true);
        [
          'readystatechange',
          'progress',
          'load',
          'error',
          'abort',
          'timeout',
          'loadend',
        ].forEach(type =>
          native.addEventListener(type, () => {
            this.readyState = native.readyState;
            this.status = native.status;
            this.statusText = native.statusText;
            this.responseURL = native.responseURL;
            try {
              this.responseText = native.responseText;
            } catch (e) {}
            this._emit(type);
          }),
        );
        return;
      }
      this._setState(1);
    }
    setRequestHeader(name, value) {
      if (this._native) {
        this._native.setRequestHeader(name, value);
      } else {
        this._headers.push([name, String(value)]);
      }
    }
    getResponseHeader(name) {
      if (this._native) {
        return this._native.getResponseHeader(name);
      }
      const found = this._responseHeaders.find(
        ([k]) => k.toLowerCase() === String(name).toLowerCase(),
      );
      return found ? found[1] : null;
    }
    getAllResponseHeaders() {
      if (this._native) {
        return this._native.getAllResponseHeaders();
      }
      return this._responseHeaders.map(([k, v]) => `${k}: ${v}`).join('\r\n');
    }
    send(body) {
      if (this._native) {
        this._native.send(body);
        return;
      }
      this._abort = bridge(
        {method: this._method, url: this._url, headers: this._headers, body},
        event => {
          if (this._aborted) {
            return;
          }
          if (event.type === 'head') {
            this.status = event.status;
            this.responseURL = event.url;
            this._responseHeaders = event.headers;
            this._setState(2);
          } else if (event.type === 'chunk') {
            this.responseText += event.data;
            if (this.readyState !== 3) {
              this._setState(3);
            }
            this._emit('progress');
          } else if (event.type === 'end') {
            this._setState(4);
            this._emit('load');
            this._emit('loadend');
          } else if (event.type === 'error') {
            this.status = 0;
            this._setState(4);
            this._emit('error');
            this._emit('loadend');
          }
        },
      );
    }
    abort() {
      if (this._native) {
        this._native.abort();
        return;
      }
      this._aborted = true;
      if (this._abort) {
        this._abort();
      }
      this.readyState = 4;
      this.status = 0;
      this._emit('abort');
      this._emit('loadend');
    }
  };
}

/** Installs the bridge (only inside the .exe). */
export function installTauriNetwork() {
  if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) {
    return false;
  }
  const originalFetch = window.fetch.bind(window);
  const OriginalXHR = window.XMLHttpRequest;
  window.fetch = bridgedFetch(originalFetch);
  global.fetch = window.fetch;
  window.XMLHttpRequest = bridgedXHR(OriginalXHR);
  global.XMLHttpRequest = window.XMLHttpRequest;
  return true;
}
