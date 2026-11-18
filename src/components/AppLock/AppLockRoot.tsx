import * as React from 'react';
import {Platform, StyleSheet, useColorScheme, View} from 'react-native';

import {
  appLockedNow,
  holdAlertsWhileLocked,
  loadAppLock,
  subscribeAppLock,
} from '../../services/appLock/appLock';
import {AppLockScreen} from './AppLockScreen';
import {LockLayer} from './LockLayer';

// Phone: dialogs wait while locked, so none is drawn over the PIN screen
// (the desktop holds its own in web/AlertHost.js; security review 2,
// 2026-11-18).
if (Platform.OS !== 'web') {
  holdAlertsWhileLocked();
}

type Phase = 'reading' | 'locked' | 'error' | 'open';

/**
 * The app's outermost part (index.js, web/start.js). With an app PIN on,
 * the PIN screen comes first and the app's own code (its screens and
 * stores, and with them the chats) is loaded only after the PIN: `loadApp`
 * is called then, once. When the app locks again later (away longer than
 * the chosen minutes), the PIN screen covers everything, in a window of its
 * own above the app's dialogs (LockLayer: a Modal on the phone; on the
 * desktop a layer above every other one, with the app behind it inert).
 */
export function AppLockRoot({
  loadApp,
}: {
  loadApp: () => React.ComponentType;
}): React.JSX.Element {
  const [phase, setPhase] = React.useState<Phase>('reading');
  const [App, setApp] = React.useState<React.ComponentType | null>(null);
  const dark = useColorScheme() === 'dark';

  React.useEffect(() => {
    let live = true;
    const stop = subscribeAppLock(locked => {
      if (live) {
        setPhase(locked ? 'locked' : 'open');
      }
    });
    loadAppLock().then(result => {
      if (!live) {
        return;
      }
      if (result === 'error') {
        setPhase('error');
      } else {
        setPhase(appLockedNow() ? 'locked' : 'open');
      }
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  React.useEffect(() => {
    if (phase === 'open' && !App) {
      const Loaded = loadApp();
      setApp(() => Loaded);
    }
  }, [phase, App, loadApp]);

  if (!App) {
    if (phase === 'locked' || phase === 'error') {
      return <AppLockScreen error={phase === 'error'} />;
    }
    // Reading the setting: a plain background, nothing of the app.
    return <View style={dark ? styles.dark : styles.light} />;
  }
  const locked = phase === 'locked' || phase === 'error';
  return (
    <View style={styles.fill}>
      <App />
      {locked ? (
        <LockLayer>
          <AppLockScreen error={phase === 'error'} />
        </LockLayer>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  light: {flex: 1, backgroundColor: '#ffffff'},
  dark: {flex: 1, backgroundColor: '#000000'},
});
