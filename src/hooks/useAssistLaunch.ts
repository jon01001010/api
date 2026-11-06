import {useEffect} from 'react';
import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';

import {ROUTES} from '../utils/navigationConstants';
import {startVoiceInput} from '../services/voice/voiceController';

/**
 * PocketAgent chosen as the phone's assistant (Settings > Apps > Default
 * apps > Digital assistant app): long-press power or a corner swipe opens
 * it here. Go to Chat and start listening, as if the mic was tapped.
 */
export async function listenForAssist(
  navigate: (route: string) => void,
  tries = 10,
): Promise<void> {
  navigate(ROUTES.CHAT);
  // The chat input registers the voice sender once mounted.
  for (let i = 0; i < tries; i++) {
    const result = await startVoiceInput().catch(() => 'error');
    if (result !== 'no-sender') {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

export function useAssistLaunch(): void {
  const navigation = useNavigation<any>();
  useEffect(() => {
    const mod = Platform.OS === 'android' ? NativeModules.PhoneActions : null;
    if (!mod?.takeAssistLaunch) {
      return;
    }
    const navigate = (route: string) => navigation.navigate(route);
    const check = () =>
      mod
        .takeAssistLaunch()
        .then((was: boolean) => (was ? listenForAssist(navigate) : undefined))
        .catch(() => {});
    check();
    const emitter = new NativeEventEmitter(mod);
    const sub = emitter.addListener('PhoneActionsAssist', check);
    const app = AppState.addEventListener('change', state => {
      if (state === 'active') {
        check();
      }
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, [navigation]);
}
