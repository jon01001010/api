import {NativeModules, PermissionsAndroid, Platform} from 'react-native';

/** A single user-visible timer. Android delivery is inexact, especially in Doze. */
export async function scheduleAgentTimer(seconds: number): Promise<number> {
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) {
    throw new Error('Timer must be 60–86400 whole seconds');
  }
  if (Platform.OS !== 'android' || !NativeModules.AgentTimer?.schedule) {
    throw new Error('Native timer service is unavailable');
  }
  if (Number(Platform.Version) >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Notification permission required');
  }
  return NativeModules.AgentTimer.schedule(seconds);
}
export async function cancelAgentTimer(): Promise<void> {
  if (Platform.OS !== 'android' || !NativeModules.AgentTimer?.cancel) throw new Error('Native timer service is unavailable');
  await NativeModules.AgentTimer.cancel();
}
