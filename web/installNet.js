/* eslint-env browser */
/* global globalThis */
/** Runs first: inside the .exe, network goes through the native side. */
import {installTauriNetwork} from './tauriNet';

// Start-up timing (ms since the page began loading): the app's code file
// has loaded and started running. Shown in Settings → Start-up time.
globalThis.__paBoot = {codeRunning: performance.now(), slowCalls: []};

// Finer start-up marks, to tell "the code is busy" from "the window waits":
// long tasks (the page busy without a break), when the window was hidden or
// shown, and the slowest files the page loaded.
(function watchStart() {
  const boot = globalThis.__paBoot;
  // The browser's storage: the first localStorage read freezes the page
  // until storage answers (the app's settings live there); IndexedDB (the
  // chats) answers later without freezing. Suspected 40 s Windows stall.
  try {
    const t = performance.now();
    window.localStorage.getItem('pa-startup-probe');
    boot.localStorageMs = performance.now() - t;
  } catch (e) {
    boot.localStorageMs = -1;
  }
  try {
    const t = performance.now();
    const req = window.indexedDB.open('pa-startup-probe');
    req.onsuccess = () => {
      boot.indexedDbMs = performance.now() - t;
      try {
        req.result.close();
      } catch (e) {}
    };
  } catch (e) {}
  boot.longTasks = [];
  boot.visibility = [
    {
      state: typeof document !== 'undefined' ? document.visibilityState : '?',
      at: performance.now(),
    },
  ];
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        boot.longTasks.push({start: e.startTime, ms: e.duration});
      }
    }).observe({type: 'longtask', buffered: true});
  } catch (e) {}
  // Canvas setup can wait for the graphics process (suspected Windows stall).
  boot.canvas = [];
  try {
    const proto =
      window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
    if (proto && proto.getContext) {
      const real = proto.getContext;
      proto.getContext = function (...args) {
        const t = performance.now();
        try {
          return real.apply(this, args);
        } finally {
          const ms = performance.now() - t;
          if (ms >= 50 && boot.canvas.length < 5) {
            boot.canvas.push({kind: String(args[0]), start: t, ms});
          }
        }
      };
    }
  } catch (e) {}
  // Where start-up time goes inside the browser: total time spent in each
  // kind of browser call during the first two minutes (the card shows the
  // biggest). A call that takes 38 s on one PC shows up here by name.
  boot.calls = {};
  const timed = (owner, name, label) => {
    try {
      const desc = owner && Object.getOwnPropertyDescriptor(owner, name);
      if (!desc) {
        return;
      }
      const note = t => {
        const ms = performance.now() - t;
        if (t < 120000) {
          const c = (boot.calls[label] = boot.calls[label] || {
            ms: 0,
            n: 0,
            max: 0,
          });
          c.ms += ms;
          c.n += 1;
          c.max = Math.max(c.max, ms);
        }
      };
      if (typeof desc.value === 'function') {
        const real = desc.value;
        owner[name] = function (...args) {
          const t = performance.now();
          try {
            return real.apply(this, args);
          } finally {
            note(t);
          }
        };
      } else if (desc.get) {
        const get = desc.get;
        Object.defineProperty(owner, name, {
          ...desc,
          get() {
            const t = performance.now();
            try {
              return get.call(this);
            } finally {
              note(t);
            }
          },
        });
      }
    } catch (e) {}
  };
  const W = typeof window !== 'undefined' ? window : {};
  const P = c => W[c] && W[c].prototype;
  timed(P('CSSStyleSheet'), 'insertRule', 'add a style rule');
  timed(P('Element'), 'getBoundingClientRect', 'measure layout');
  timed(P('HTMLElement'), 'offsetWidth', 'measure layout');
  timed(P('HTMLElement'), 'offsetHeight', 'measure layout');
  timed(P('Element'), 'scrollHeight', 'measure layout');
  timed(W, 'getComputedStyle', 'read computed style');
  timed(P('CanvasRenderingContext2D'), 'measureText', 'measure text (canvas)');
  timed(P('HTMLCanvasElement'), 'getContext', 'set up a canvas');
  timed(P('Document'), 'createElement', 'create an element');
  timed(P('Node'), 'appendChild', 'add to the page');
  timed(P('Node'), 'insertBefore', 'add to the page');
  timed(P('Element'), 'setAttribute', 'set an attribute');
  timed(P('Storage'), 'getItem', 'read saved settings');
  timed(P('Storage'), 'setItem', 'save settings');
  timed(P('IDBFactory'), 'open', 'open the chat database');
  timed(W.JSON, 'parse', 'read data (JSON)');
  timed(P('FontFaceSet'), 'load', 'load a font');
  timed(P('FontFaceSet'), 'check', 'check a font');
  timed(W, 'matchMedia', 'check screen settings');
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      boot.visibility.push({
        state: document.visibilityState,
        at: performance.now(),
      });
    });
    document.addEventListener('DOMContentLoaded', () => {
      boot.domReady = performance.now();
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
      boot.pageLoad = performance.now();
    });
  }
})();

// The slowest native calls in the first two minutes (also in the card), to
// see if one of them holds up the start.
const internals = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;
if (internals && typeof internals.invoke === 'function') {
  const realInvoke = internals.invoke.bind(internals);
  internals.invoke = (cmd, ...rest) => {
    const started = performance.now();
    const note = () => {
      const ms = performance.now() - started;
      const slow = globalThis.__paBoot.slowCalls;
      if (ms >= 250 && started < 120000) {
        slow.push({cmd: String(cmd), startedMs: started, ms});
        slow.sort((a, b) => b.ms - a.ms);
        slow.length = Math.min(slow.length, 5);
      }
    };
    const result = realInvoke(cmd, ...rest);
    if (result && typeof result.then === 'function') {
      result.then(note, note);
    }
    return result;
  };
}

installTauriNetwork();
