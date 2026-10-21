import AsyncStorage from '@react-native-async-storage/async-storage';
import {AppState, NativeModules, Platform} from 'react-native';

const KEY = '@pocketagent/background-inference/enabled/v1';
export async function isBackgroundInferenceEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === 'true';
}
export async function setBackgroundInferenceEnabled(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, String(value));
}
export async function startBackgroundInference(): Promise<void> {
  if (Platform.OS === 'android' && await isBackgroundInferenceEnabled()) {
    await NativeModules.BackgroundInference?.start();
  }
}
export async function finishBackgroundInference(completed = false): Promise<void> {
  if (Platform.OS === 'android') await NativeModules.BackgroundInference?.finish(completed && AppState.currentState !== 'active');
}
