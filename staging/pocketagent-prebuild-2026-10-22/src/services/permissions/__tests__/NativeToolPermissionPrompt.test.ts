import {Alert} from 'react-native';
import {askNativeToolPermission} from '../NativeToolPermissionPrompt';

jest.mock('react-native', () => ({Alert: {alert: jest.fn()}}));
const alert = Alert.alert as jest.Mock;

beforeEach(() => alert.mockReset());

describe('human tool permission dialog', () => {
  const request = {tool: 'send_message', category: 'messages' as const};
  it.each([['Deny', 'deny'], ['Allow once', 'allow-once'], ['Always allow', 'allow-always']])(
    '%s produces %s', async (button, expected) => {
      const promise = askNativeToolPermission(request);
      const buttons = alert.mock.calls[0][2];
      buttons.find((b: {text: string}) => b.text === button).onPress();
      await expect(promise).resolves.toBe(expected);
    },
  );
  it('denies dismissed dialogs', async () => {
    const promise = askNativeToolPermission(request);
    alert.mock.calls[0][3].onDismiss();
    await expect(promise).resolves.toBe('deny');
  });
  it('denies native dialog failures', async () => {
    alert.mockImplementation(() => {throw Error('native unavailable');});
    await expect(askNativeToolPermission(request)).resolves.toBe('deny');
  });
});
