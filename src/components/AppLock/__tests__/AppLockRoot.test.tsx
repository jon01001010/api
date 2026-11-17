import React from 'react';
import {AppState, Text} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {AppLockRoot} from '../AppLockRoot';
import {
  resetAppLockForTests,
  turnOnAppPin,
} from '../../../services/appLock/appLock';

const mockErase = jest.fn(async () => true);
jest.mock('../../../services/appLock/appErase', () => ({
  eraseAvailable: () => true,
  eraseEverything: () => mockErase(),
}));

const store = new Map<string, {username: string; password: string}>();
const K = Keychain as jest.Mocked<typeof Keychain>;

jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation((() => ({remove: () => {}})) as any);

beforeEach(() => {
  store.clear();
  resetAppLockForTests();
  K.setGenericPassword.mockImplementation((async (
    username: string,
    password: string,
    options?: {service?: string},
  ) => {
    store.set(options?.service ?? 'default', {username, password});
    return {service: options?.service, storage: 'test'};
  }) as any);
  K.getGenericPassword.mockImplementation(
    (async (options?: {service?: string}) =>
      store.get(options?.service ?? 'default') ?? false) as any,
  );
});

const TheApp = () => <Text>the chats</Text>;

describe('AppLockRoot', () => {
  it('no PIN: the app loads at once', async () => {
    const loadApp = jest.fn(() => TheApp);
    const {findByText} = render(<AppLockRoot loadApp={loadApp} />);
    expect(await findByText('the chats')).toBeTruthy();
    expect(loadApp).toHaveBeenCalledTimes(1);
  });

  it("with a PIN: the app's code isn't loaded before the PIN", async () => {
    await turnOnAppPin('2468');
    resetAppLockForTests(); // as after a restart
    const loadApp = jest.fn(() => TheApp);
    const {findByTestId, queryByText, getByTestId, findByText} = render(
      <AppLockRoot loadApp={loadApp} />,
    );
    await findByTestId('app-lock-screen');
    expect(loadApp).not.toHaveBeenCalled();
    expect(queryByText('the chats')).toBeNull();

    fireEvent.changeText(getByTestId('app-lock-input'), '1111');
    fireEvent.press(getByTestId('app-lock-unlock'));
    await findByText(/Wrong PIN/);
    expect(loadApp).not.toHaveBeenCalled();

    fireEvent.changeText(getByTestId('app-lock-input'), '2468');
    fireEvent.press(getByTestId('app-lock-unlock'));
    expect(await findByText('the chats')).toBeTruthy();
    await waitFor(() => expect(loadApp).toHaveBeenCalledTimes(1));
  });

  it('the erase PIN erases and the app is never loaded', async () => {
    await turnOnAppPin('2468');
    const {changeAppLock} = require('../../../services/appLock/appLock');
    await changeAppLock('2468', {erasePin: '9999'});
    resetAppLockForTests();
    const loadApp = jest.fn(() => TheApp);
    const {findByTestId, getByTestId} = render(
      <AppLockRoot loadApp={loadApp} />,
    );
    await findByTestId('app-lock-screen');
    fireEvent.changeText(getByTestId('app-lock-input'), '9999');
    fireEvent.press(getByTestId('app-lock-unlock'));
    await waitFor(() => expect(mockErase).toHaveBeenCalledTimes(1));
    expect(loadApp).not.toHaveBeenCalled();
  });
});
