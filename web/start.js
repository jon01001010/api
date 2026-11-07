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
import App from '../App';
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

AppRegistry.registerComponent(DESKTOP_APP, () => () => (
  <ErrorScreen>
    <FirstScreenTimer />
    <App />
    {/* Alert.alert dialogs (empty in react-native-web otherwise). */}
    <AlertHost />
  </ErrorScreen>
));
AppRegistry.runApplication(DESKTOP_APP, {
  rootTag: document.getElementById('root'),
});
// All the app's start-up code has run (the first screen is drawn later).
if (globalThis.__paBoot) {
  globalThis.__paBoot.codeDone = performance.now();
}
