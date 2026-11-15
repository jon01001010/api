import React from 'react';
import {AppState} from 'react-native';
import * as Keychain from 'react-native-keychain';
import {act, fireEvent, render, waitFor} from '../../../../jest/test-utils';

import {HomePcLockSettings, HomePcPinPrompt} from '..';
import {
  homePcGate,
  resetHomePcLockForTests,
  turnOnPin,
  unlockHomePc,
} from '../../../services/homeLink/homePcLock';

const PC = '9'.repeat(64);
const store = new Map<string, {username: string; password: string}>();
const K = Keychain as jest.Mocked<typeof Keychain>;

jest
  .spyOn(AppState, 'addEventListener')
  .mockImplementation((() => ({remove: () => {}})) as any);

beforeEach(() => {
  store.clear();
  resetHomePcLockForTests();
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
  K.resetGenericPassword.mockImplementation((async (options?: {
    service?: string;
  }) => store.delete(options?.service ?? 'default')) as any);
});

it('the PIN window: a wrong PIN says so, the right one unlocks', async () => {
  await turnOnPin(PC, '2468');
  resetHomePcLockForTests();
  const {getByTestId, queryByTestId} = render(<HomePcPinPrompt />);
  let unlocked: Promise<boolean> | undefined;
  await act(async () => {
    unlocked = unlockHomePc(PC);
  });
  await waitFor(() => expect(getByTestId('home-pc-pin-prompt')).toBeTruthy());

  fireEvent.changeText(getByTestId('home-pc-pin-input'), '1111');
  fireEvent.press(getByTestId('home-pc-pin-unlock'));
  await waitFor(() =>
    expect(getByTestId('home-pc-pin-message')).toHaveTextContent(
      /Wrong PIN\. 4 tries left/,
    ),
  );

  fireEvent.changeText(getByTestId('home-pc-pin-input'), '2468');
  fireEvent.press(getByTestId('home-pc-pin-unlock'));
  await act(async () => {
    await expect(unlocked).resolves.toBe(true);
  });
  expect(queryByTestId('home-pc-pin-input')).toBeNull();
});

it('the server sheet turns the PIN on (both entries must match)', async () => {
  const {getByTestId} = render(<HomePcLockSettings pc={PC} />);
  fireEvent(getByTestId('home-pc-lock-switch'), 'valueChange', true);
  fireEvent.changeText(getByTestId('home-pc-lock-new'), '1357');
  fireEvent.changeText(getByTestId('home-pc-lock-again'), '1358');
  fireEvent.press(getByTestId('home-pc-lock-save'));
  await waitFor(() =>
    expect(getByTestId('home-pc-lock-result')).toHaveTextContent(
      "The two PINs don't match.",
    ),
  );
  expect(store.size).toBe(0);

  fireEvent.changeText(getByTestId('home-pc-lock-again'), '1357');
  fireEvent.press(getByTestId('home-pc-lock-save'));
  await waitFor(() =>
    expect(getByTestId('home-pc-lock-result')).toHaveTextContent(
      'PIN on for this PC.',
    ),
  );
  resetHomePcLockForTests();
  expect(await homePcGate(PC)).toMatchObject({ok: false, locked: true});
});

it('turning it off needs the current PIN', async () => {
  await turnOnPin(PC, '2468');
  const {getByTestId} = render(<HomePcLockSettings pc={PC} />);
  await waitFor(() => expect(getByTestId('home-pc-lock-edit')).toBeTruthy());
  fireEvent.press(getByTestId('home-pc-lock-edit'));
  fireEvent.changeText(getByTestId('home-pc-lock-current'), '0000');
  fireEvent.press(getByTestId('home-pc-lock-off'));
  await waitFor(() =>
    expect(getByTestId('home-pc-lock-result')).toHaveTextContent(/Wrong PIN/),
  );
  expect(store.size).toBe(1);
  fireEvent.changeText(getByTestId('home-pc-lock-current'), '2468');
  fireEvent.press(getByTestId('home-pc-lock-off'));
  await waitFor(() =>
    expect(getByTestId('home-pc-lock-result')).toHaveTextContent(
      'PIN off for this PC.',
    ),
  );
  expect(store.size).toBe(0);
});
