/**
 * The bridge to the .exe's native side (src-tauri). In a plain browser there
 * is none, and callers fall back to their in-browser versions.
 */
const core = require('@tauri-apps/api/core');

const isTauri = () =>
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

module.exports = {isTauri, invoke: core.invoke, Channel: core.Channel};
