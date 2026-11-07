import type {DeviceRules} from './types';

/**
 * Desktop app: no online device rules. The phone version fetches PocketPal's
 * hosted rules for phone models; a PC needs none, and the app shouldn't
 * contact a third party at start-up for nothing. Null means "use the
 * bundled rules", as on any failure.
 */
export async function fetchRules(
  _appVersion: string,
  _platform?: string,
): Promise<DeviceRules | null> {
  return null;
}
