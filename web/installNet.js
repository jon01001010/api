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
