/* eslint-env browser */
/* global globalThis */
/**
 * Web start (the desktop app, DesktopAgent): the same app as index.js, shown
 * in the page's #root element, inside a safety net that shows the error
 * instead of an empty window if the screens crash (web/ErrorScreen.js).
 */
// Must come first: inside the .exe, network goes through the native side.
import './installNet';
import React from 'react';
import {AppRegistry} from 'react-native';
import '../index';
import {AppLockRoot} from '../src/components/AppLock/AppLockRoot';
import {whenAppUnlocked} from '../src/services/appLock/appLock';
import {ErrorScreen} from './ErrorScreen';
import {AlertHost} from './AlertHost';

const DESKTOP_APP = 'DesktopAgent';

// The browser's own right-click menu (Back, Reload, Inspect…) means nothing
// in an app: keep it only in text boxes and on selected text (copy / paste).
document.addEventListener('contextmenu', event => {
  const target = event.target;
  const editable =
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable);
  const selection = window.getSelection && String(window.getSelection());
  if (!editable && !selection) {
    event.preventDefault();
  }
});

function FirstScreenTimer() {
  React.useEffect(() => {
    // React has put the first screen together (drawing comes next).
    if (globalThis.__paBoot && !globalThis.__paBoot.firstCommit) {
      globalThis.__paBoot.firstCommit = performance.now();
    }
    // After the first screen is drawn.
    requestAnimationFrame(() => {
      if (globalThis.__paBoot && !globalThis.__paBoot.firstScreen) {
        globalThis.__paBoot.firstScreen = performance.now();
      }
    });
  }, []);
  return null;
}

const loadApp = () => require('../App').default;

AppRegistry.registerComponent(DESKTOP_APP, () => () => (
  <ErrorScreen>
    <FirstScreenTimer />
    {/* The app PIN first (off by default): the app's own code, and with
        it the chats, loads only after it (src/services/appLock). */}
    <AppLockRoot loadApp={loadApp} />
    {/* Alert.alert dialogs (empty in react-native-web otherwise). */}
    <AlertHost />
  </ErrorScreen>
));
AppRegistry.runApplication(DESKTOP_APP, {
  rootTag: document.getElementById('root'),
});
// Keeping in step with paired devices (off unless allowed in Settings),
// once the app PIN (if on) was entered.
whenAppUnlocked()
  .then(() => require('../src/services/sync/hostSync').startHostSync())
  .catch(() => {});

// The quick-chat key (Settings), if the user switched it on.
try {
  if (
    window.__TAURI_INTERNALS__ &&
    window.localStorage.getItem('pa-quick-key') === 'on'
  ) {
    window.__TAURI_INTERNALS__
      .invoke('quick_key_set', {enabled: true})
      .catch(() => {});
  }
} catch (e) {}

// All the app's start-up code has run (the first screen is drawn later).
if (globalThis.__paBoot) {
  globalThis.__paBoot.codeDone = performance.now();
}
