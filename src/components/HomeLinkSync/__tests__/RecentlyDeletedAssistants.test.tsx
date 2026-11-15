import React from 'react';
import {fireEvent, render, waitFor} from '../../../../jest/test-utils';

const mockList: any[] = [];
const mockRestore = jest.fn(async (id: string) => {
  const i = mockList.findIndex(r => r.pal.id === id);
  mockList.splice(i, 1);
  return true;
});
jest.mock('../../../services/sync/assistantDeletes', () => ({
  RECENT_DAYS: 30,
  recentlyDeletedAssistants: async () => [...mockList],
  restoreAssistant: (id: string) => mockRestore(id),
}));

import {RecentlyDeletedAssistants} from '../RecentlyDeletedAssistants';

beforeEach(() => {
  mockList.length = 0;
  mockRestore.mockClear();
});

it('shows nothing when none were deleted elsewhere', async () => {
  const {queryByTestId} = render(<RecentlyDeletedAssistants />);
  await waitFor(() =>
    expect(queryByTestId('recently-deleted-assistants')).toBeNull(),
  );
});

it('lists assistants deleted on another device and restores one', async () => {
  mockList.push({
    pal: {id: 'p1', name: 'Coder'},
    deletedAt: 1,
    removedAt: Date.now(),
    from: 'the PC',
  });
  const {getByTestId, getByText, queryByTestId} = render(
    <RecentlyDeletedAssistants />,
  );
  await waitFor(() =>
    expect(getByTestId('recently-deleted-assistants-toggle')).toBeTruthy(),
  );
  fireEvent.press(getByTestId('recently-deleted-assistants-toggle'));
  expect(getByText(/Coder · deleted on the PC/)).toBeTruthy();
  fireEvent.press(getByTestId('recently-deleted-assistant-restore-p1'));
  await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('p1'));
  await waitFor(() =>
    expect(queryByTestId('recently-deleted-assistants')).toBeNull(),
  );
});
