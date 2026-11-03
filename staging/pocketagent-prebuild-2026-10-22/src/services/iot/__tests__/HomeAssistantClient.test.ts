import {executeDeviceCommand, validateDeviceCommand, validateHomeAssistantUrl} from '../HomeAssistantClient';
const config = {baseUrl: 'http://192.168.1.10:8123', token: 'secret', allowedEntities: [{entityId: 'light.desk', label: 'Desk light'}]};
test('private LAN and HTTPS allowed, public HTTP rejected', () => {
  expect(validateHomeAssistantUrl(config.baseUrl)).toBe(config.baseUrl);
  expect(validateHomeAssistantUrl('https://home.example.com')).toBe('https://home.example.com');
  expect(() => validateHomeAssistantUrl('http://example.com')).toThrow();
  expect(() => validateHomeAssistantUrl('http://127.0.0.1:8123')).toThrow();
});
test('exact approved device only', () => {
  expect(validateDeviceCommand(config, {entityId: 'light.desk', action: 'turn_on'})).toBe('light');
  expect(() => validateDeviceCommand(config, {entityId: 'light.other', action: 'turn_on'})).toThrow();
  expect(() => validateDeviceCommand(config, {entityId: 'lock.front', action: 'turn_on'})).toThrow();
});
test('explicit confirmation and exact service endpoint', async () => {
  const request = jest.fn().mockResolvedValue({ok: true});
  await expect(executeDeviceCommand(config, {entityId: 'light.desk', action: 'turn_on'}, false, request)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  await executeDeviceCommand(config, {entityId: 'light.desk', action: 'turn_on'}, true, request);
  expect(request).toHaveBeenCalledWith('http://192.168.1.10:8123/api/services/light/turn_on', expect.objectContaining({method: 'POST', redirect: 'error'}));
});
