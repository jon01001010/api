import React from 'react';
import {fireEvent, render, waitFor} from '../../../../jest/test-utils';

const mockList: any[] = [];
const mockRestore = jest.fn(async (id: string) => {
  const i = mockList.findIndex(r => r.loop.id === id);
  mockList.splice(i, 1);
  return true;
});
jest.mock('../../../services/sync/loopSync', () => ({
  LOOP_RECENT_DAYS: 30,
  recentlyDeletedLoops: async () => [...mockList],
  restoreLoop: (id: string) => mockRestore(id),
}));

import {RecentlyDeletedLoops} from '../RecentlyDeletedLoops';

beforeEach(() => {
  mockList.length = 0;
  mockRestore.mockClear();
});

it('shows nothing when no loop was stopped elsewhere', async () => {
  const {queryByTestId} = render(<RecentlyDeletedLoops />);
  await waitFor(() =>
    expect(queryByTestId('recently-deleted-loops')).toBeNull(),
  );
});

it('lists loops stopped on another device and restores one', async () => {
  mockList.push({
    loop: {id: 'l1', title: 'Walk'},
    deletedAt: 1,
    removedAt: Date.now(),
    from: 'the PC',
  });
  const {getByTestId, getByText, queryByTestId} = render(
    <RecentlyDeletedLoops />,
  );
  await waitFor(() =>
    expect(getByTestId('recently-deleted-loops-toggle')).toBeTruthy(),
  );
  fireEvent.press(getByTestId('recently-deleted-loops-toggle'));
  expect(getByText(/Walk · stopped on the PC/)).toBeTruthy();
  fireEvent.press(getByTestId('recently-deleted-loop-restore-l1'));
  await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('l1'));
  await waitFor(() =>
    expect(queryByTestId('recently-deleted-loops')).toBeNull(),
  );
});
