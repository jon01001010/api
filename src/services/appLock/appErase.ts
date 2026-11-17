/**
 * Erases everything the app keeps on this device, at once and without
 * asking: only ever called by appLock.ts when the erase PIN was entered.
 * Nothing is sent to paired devices.
 *
 * - Phone (Android): ActivityManager.clearApplicationUserData()
 *   (AppEraseModule.kt): the same as "Clear storage" in Android's settings.
 *   It erases the app's private files (chats, memory, settings, models,
 *   pictures, logs, caches, the home link key in the no-backup folder), its
 *   area on shared storage and its Android Keystore keys (so both PIN
 *   hashes and all API keys), cancels its alarms and notifications, and
 *   stops the app. Opened again, it starts as new (onboarding).
 * - PC (DesktopAgent): the native `app_erase_all` (src-tauri/src/erase.rs)
 *   removes only the app's own folders and its own Credential Manager /
 *   Linux key store entries, then restarts the app, which starts as new.
 */
import {NativeModules, Platform} from 'react-native';

const tauri = (): any => (globalThis as any).__TAURI_INTERNALS__;

/** Whether this device can erase (the erase PIN is offered only then). */
export function eraseAvailable(): boolean {
  if (Platform.OS === 'android') {
    return typeof NativeModules.AppErase?.eraseAll === 'function';
  }
  return typeof tauri()?.invoke === 'function';
}

/** True when erasing started (the app closes or restarts soon after). */
export async function eraseEverything(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      const mod = NativeModules.AppErase;
      if (typeof mod?.eraseAll !== 'function') {
        return false;
      }
      return (await mod.eraseAll()) === true;
    }
    const t = tauri();
    if (typeof t?.invoke !== 'function') {
      return false;
    }
    try {
      // The page's own storage first (the native side removes its folder
      // too, after the restart when Windows still holds it).
      (globalThis as any).localStorage?.clear();
      (globalThis as any).sessionStorage?.clear();
    } catch {}
    await t.invoke('app_erase_all');
    return true;
  } catch {
    return false;
  }
}
