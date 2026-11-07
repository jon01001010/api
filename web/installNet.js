/* eslint-env browser */
/* global globalThis */
/** Runs first: inside the .exe, network goes through the native side. */
import {installTauriNetwork} from './tauriNet';

// Start-up timing (ms since the page began loading): the app's code file
// has loaded and started running. Shown in Settings → Start-up time.
globalThis.__paBoot = {codeRunning: performance.now(), slowCalls: []};

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
