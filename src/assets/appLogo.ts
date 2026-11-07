import {Platform} from 'react-native';

/**
 * The app's logo. Phone: the Android drawable (unchanged). The desktop app
 * uses the DesktopAgent logo (appLogo.web.ts).
 */
export const appLogo =
  Platform.OS === 'android'
    ? {uri: 'pocketagent_logo'}
    : require('./pocketagent-dark-v2.png');
