/** Policy only: no microphone starts without explicit user action. */
export function canListenForWakeName(enabled: boolean, appState: string, micGranted: boolean): boolean {
  return enabled && appState === 'active' && micGranted;
}
