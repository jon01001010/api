import {NativeModules, PermissionsAndroid, Platform} from 'react-native';

/** User-initiated, one-shot transcription; never sends or executes automatically. */
export async function transcribeOnce(): Promise<string> {
  if (Platform.OS !== 'android') throw new Error('Voice input currently requires Android');
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Microphone permission denied');
  const module = NativeModules.PocketAgentVoiceInput;
  if (!module?.listen) throw new Error('Voice input module unavailable');
  const result: unknown = await module.listen();
  if (typeof result !== 'string') throw new Error('Invalid transcription');
  return result.trim();
}
