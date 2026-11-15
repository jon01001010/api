/**
 * The phone's battery, for a loop's battery guard (loops.ts batteryOk).
 * Read through react-native-device-info (already in the app; no new native
 * code). The desktop, and anything that can't read it, gives no reading,
 * which the guard treats as OK.
 */
import {Platform} from 'react-native';
import DeviceInfo from 'react-native-device-info';

import {isDesktopApp} from './loopNotify';
import type {BatteryState} from './loops';

export async function readBattery(): Promise<BatteryState | undefined> {
  if (Platform.OS !== 'android' || isDesktopApp()) {
    return undefined;
  }
  try {
    const power: any = await DeviceInfo.getPowerState();
    const level =
      typeof power?.batteryLevel === 'number' ? power.batteryLevel : -1;
    const charging =
      power?.batteryState === 'charging' || power?.batteryState === 'full';
    return {level, charging};
  } catch {
    return undefined;
  }
}
