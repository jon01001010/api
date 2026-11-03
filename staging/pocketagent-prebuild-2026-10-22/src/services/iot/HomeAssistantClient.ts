/** Opt-in Home Assistant bridge. Never pass model-generated URLs or bearer tokens. */
export type DeviceAction = 'turn_on' | 'turn_off' | 'toggle';
export type DeviceDomain = 'light' | 'switch' | 'fan';
export interface DeviceTarget { entityId: string; label: string }
export interface HomeAssistantConfig {
  /** Set explicitly by the user; HTTPS required except literal RFC1918 LAN IPv4. */
  baseUrl: string;
  token: string;
  /** Exact user-approved entity IDs, not wildcards. */
  allowedEntities: readonly DeviceTarget[];
}
export interface DeviceCommand { entityId: string; action: DeviceAction }

const LOCAL_V4 = /^(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})$/;
const ENTITY = /^(light|switch|fan)\.[a-z0-9_]+$/;

export function validateHomeAssistantUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use a base URL without credentials, path, query or fragment');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_V4.test(url.hostname))) {
    throw new Error('HTTPS is required outside a private IPv4 LAN');
  }
  return url.origin;
}

export function validateDeviceCommand(config: HomeAssistantConfig, command: DeviceCommand): DeviceDomain {
  if (!ENTITY.test(command.entityId)) throw new Error('Unsupported device entity');
  if (!config.allowedEntities.some(x => x.entityId === command.entityId)) {
    throw new Error('Device has not been explicitly allowed');
  }
  if (!(['turn_on', 'turn_off', 'toggle'] as string[]).includes(command.action)) {
    throw new Error('Unsupported action');
  }
  return command.entityId.split('.')[0] as DeviceDomain;
}

/** Caller must show a confirmation dialog for each action before invoking this. */
export async function executeDeviceCommand(
  config: HomeAssistantConfig,
  command: DeviceCommand,
  confirmed: boolean,
  request: typeof fetch = fetch,
): Promise<void> {
  if (!confirmed) throw new Error('User confirmation required');
  const origin = validateHomeAssistantUrl(config.baseUrl);
  const domain = validateDeviceCommand(config, command);
  if (!config.token.trim()) throw new Error('Home Assistant token is missing');
  const response = await request(`${origin}/api/services/${domain}/${command.action}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`},
    body: JSON.stringify({entity_id: command.entityId}),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`Device request failed (HTTP ${response.status})`);
}
