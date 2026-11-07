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

AppRegistry.registerComponent(DESKTOP_APP, () => () => (
  <ErrorScreen>
    <App />
    {/* Alert.alert dialogs (empty in react-native-web otherwise). */}
    <AlertHost />
  </ErrorScreen>
));
AppRegistry.runApplication(DESKTOP_APP, {
  rootTag: document.getElementById('root'),
});
