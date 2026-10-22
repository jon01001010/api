import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppState, NativeModules, Platform, type NativeEventSubscription} from 'react-native';

const KEY = '@pocketagent/background-inference/enabled/v1';
let backgroundSeen = false;
let appStateListener: NativeEventSubscription | null = null;
export async function isBackgroundInferenceEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === 'true';
}
export async function setBackgroundInferenceEnabled(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, String(value));
}
export async function startBackgroundInference(): Promise<void> {
  if (Platform.OS === 'android' && await isBackgroundInferenceEnabled()) {
    backgroundSeen = AppState.currentState !== 'active';
    appStateListener?.remove();
    appStateListener = AppState.addEventListener('change', state => {
      if (state !== 'active') backgroundSeen = true;
    });
    await NativeModules.BackgroundInference?.start();
  }
}
export async function finishBackgroundInference(completed = false): Promise<void> {
  appStateListener?.remove();
  appStateListener = null;
  const shouldNotify = completed && (backgroundSeen || AppState.currentState !== 'active');
  backgroundSeen = false;
  if (Platform.OS === 'android') await NativeModules.BackgroundInference?.finish(shouldNotify);
}
