import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {QuickKeyCard} from '../QuickKeyCard';

const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
};

afterEach(() => {
  delete (globalThis as any).__TAURI_INTERNALS__;
});

it('shows nothing on the phone', () => {
  const {queryByTestId} = render(<QuickKeyCard />);
  expect(queryByTestId('quick-key-card')).toBeNull();
});

it('is off until switched on, and remembers it', async () => {
  const invoke = jest.fn(async () => null);
  (globalThis as any).__TAURI_INTERNALS__ = {invoke};
  const {getByTestId} = render(<QuickKeyCard />);
  expect(getByTestId('quick-key-switch').props.value).toBe(false);
  fireEvent(getByTestId('quick-key-switch'), 'valueChange', true);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('quick_key_set', {enabled: true}),
  );
  expect(store['pa-quick-key']).toBe('on');
});
