/**
 * Web start (the Windows app via Tauri): the same app as index.js, then
 * shown in the page's #root element.
 */
// Must come first: inside the .exe, network goes through the native side.
import './installNet';
import {AppRegistry} from 'react-native';
import '../index';
import {name as appName} from '../app.json';

AppRegistry.runApplication(appName, {
  rootTag: document.getElementById('root'),
});
