const storage: Record<string, string> = {};
const listeners: Array<(state: string) => void> = [];
const start = jest.fn(async () => true);
const finish = jest.fn(async (_completed: boolean) => true);
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => storage[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {storage[key] = value;}),
}));
jest.mock('react-native', () => ({
  Platform: {OS: 'android', Version: 32},
  PermissionsAndroid: {RESULTS: {GRANTED: 'granted'}, request: jest.fn(async () => 'granted')},
  NativeModules: {BackgroundInference: {start: (...args: unknown[]) => start(...args), finish: (...args: [boolean]) => finish(...args)}},
  AppState: {currentState: 'active', addEventListener: (_: string, fn: (state: string) => void) => {
    listeners.push(fn); return {remove: () => {const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1);}};
  }},
}));
import {startBackgroundInference, finishBackgroundInference, isBackgroundInferenceRunning, setBackgroundInferenceEnabled} from '../backgroundInference';

beforeEach(async () => {
  await finishBackgroundInference();
  start.mockClear(); finish.mockClear();
  await setBackgroundInferenceEnabled(false);
});
it('defaults off, never starts native service', async () => {
  await startBackgroundInference();
  expect(start).not.toHaveBeenCalled();
});
it('starts once and stops once', async () => {
  await setBackgroundInferenceEnabled(true);
  await startBackgroundInference();
  await startBackgroundInference();
  expect(start).toHaveBeenCalledTimes(1);
  expect(isBackgroundInferenceRunning()).toBe(true);
  await finishBackgroundInference();
  expect(finish).toHaveBeenCalledTimes(1);
  expect(isBackgroundInferenceRunning()).toBe(false);
});
it('notifies on completion after backgrounding', async () => {
  await setBackgroundInferenceEnabled(true);
  await startBackgroundInference();
  listeners.forEach(fn => fn('background'));
  await finishBackgroundInference(true);
  expect(finish).toHaveBeenCalledWith(true);
});
it('does not notify for cancelled work', async () => {
  await setBackgroundInferenceEnabled(true);
  await startBackgroundInference();
  listeners.forEach(fn => fn('background'));
  await finishBackgroundInference(false);
  expect(finish).toHaveBeenCalledWith(false);
});
it('disabling during a run stops the foreground service', async () => {
  await setBackgroundInferenceEnabled(true);
  await startBackgroundInference();
  await setBackgroundInferenceEnabled(false);
  expect(finish).toHaveBeenCalledWith(false);
});

it('does not finish just because the app becomes backgrounded', async () => {
  await setBackgroundInferenceEnabled(true);
  await startBackgroundInference();
  listeners.forEach(fn => fn('background'));
  expect(isBackgroundInferenceRunning()).toBe(true);
  expect(finish).not.toHaveBeenCalled();
  await finishBackgroundInference(true);
  expect(finish).toHaveBeenCalledWith(true);
});
it('supports returning to foreground without restarting generation', async () => {
  await setBackgroundInferenceEnabled(true);
  await startBackgroundInference();
  listeners.forEach(fn => fn('background'));
  listeners.forEach(fn => fn('active'));
  await startBackgroundInference();
  expect(start).toHaveBeenCalledTimes(1);
  await finishBackgroundInference(true);
  expect(finish).toHaveBeenCalledWith(true);
});

it('requests notification permission on Android 13+ only when enabled', async () => {
  const {Platform, PermissionsAndroid} = require('react-native');
  Platform.Version = 33;
  PermissionsAndroid.request.mockClear();
  await setBackgroundInferenceEnabled(false);
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  await setBackgroundInferenceEnabled(true);
  expect(PermissionsAndroid.request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
  Platform.Version = 32;
});
