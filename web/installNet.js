/* eslint-env browser */
/* global globalThis */
/** Runs first: inside the .exe, network goes through the native side. */
import {installTauriNetwork} from './tauriNet';

// Start-up timing (ms since the page began loading): the app's code file
// has loaded and started running. Shown in Settings → Start-up time.
globalThis.__paBoot = {codeRunning: performance.now()};

installTauriNetwork();
