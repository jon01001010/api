import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppState, NativeModules, PermissionsAndroid, Platform, type NativeEventSubscription} from 'react-native';

const KEY = '@pocketagent/background-inference/enabled/v1';
let backgroundSeen = false;
let appStateListener: NativeEventSubscription | null = null;
let active = false;
let serviceStarted = false;
let operations: Promise<void> = Promise.resolve();

export async function isBackgroundInferenceEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === 'true';
}
/** Request notification permission only on explicit user opt-in, never at startup. */
export async function setBackgroundInferenceEnabled(value: boolean): Promise<void> {
  if (value && Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    try {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any);
    } catch {
      // Denial does not prevent background execution.
    }
  }
  await AsyncStorage.setItem(KEY, String(value));
  if (!value && active) await finishBackgroundInference(false);
}
export async function startBackgroundInference(): Promise<void> {
  if (Platform.OS !== 'android' || !(await isBackgroundInferenceEnabled())) return;
  operations = operations.catch(() => {}).then(async () => {
    if (active) return;
    if (!NativeModules.BackgroundInference?.start) throw new Error('Background inference native service is unavailable');
    await NativeModules.BackgroundInference.start();
    active = true;
    serviceStarted = true;
    backgroundSeen = AppState.currentState !== 'active';
    appStateListener?.remove();
    appStateListener = AppState.addEventListener('change', state => {
      if (state !== 'active') backgroundSeen = true;
    });
  });
  return operations;
}
export async function finishBackgroundInference(completed = false): Promise<void> {
  operations = operations.catch(() => {}).then(async () => {
    appStateListener?.remove();
    appStateListener = null;
    const shouldNotify = completed && (backgroundSeen || AppState.currentState !== 'active');
    backgroundSeen = false;
    active = false;
    if (Platform.OS === 'android' && serviceStarted) {
      serviceStarted = false;
      // Native module checks the OS permission at delivery time.
      await NativeModules.BackgroundInference.finish(shouldNotify);
    }
  });
  return operations;
}
export function isBackgroundInferenceRunning(): boolean {return active;}
