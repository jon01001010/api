/**
 * Desktop dialogs wait while the app is locked (security review 2,
 * 2026-11-18): nothing is drawn over the PIN screen.
 */
import React from 'react';
import {act, render} from '@testing-library/react-native';

let mockLocked = false;
const mockListeners = new Set();
jest.mock('../../src/services/appLock/appLock', () => ({
  appLockedNow: () => mockLocked,
  subscribeAppLock: listener => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));

import {AlertHost, showDesktopAlert} from '../AlertHost';

const setLocked = locked => {
  mockLocked = locked;
  mockListeners.forEach(l => l(locked));
};

describe('desktop dialogs and the app lock', () => {
  it('held while locked, shown after the unlock, in order', () => {
    setLocked(true);
    const view = render(<AlertHost />);
    act(() => {
      showDesktopAlert('Kept in step', 'System prompt updated');
    });
    expect(view.queryByTestId('desktop-alert')).toBeNull();
    expect(view.queryByText('System prompt updated')).toBeNull();
    act(() => setLocked(false));
    expect(view.getByText('System prompt updated')).toBeTruthy();
    // Locking again hides an open one until the next unlock.
    act(() => setLocked(true));
    expect(view.queryByTestId('desktop-alert')).toBeNull();
    act(() => setLocked(false));
    expect(view.getByTestId('desktop-alert')).toBeTruthy();
  });
});
