import React from 'react';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';
import {MemorySection} from '../MemorySection';

jest.mock('../../../services/talents/agentMemory', () => ({
  memoryGet: jest.fn(async () => 'model v2'),
  memoryReplace: jest.fn(async () => {}),
  memoryHistory: jest.fn(async () => []),
  memoryReadSnapshot: jest.fn(),
  userMemoryGet: jest.fn(async () => 'user v3'),
  userMemoryReplace: jest.fn(async () => {}),
  userMemoryHistory: jest.fn(async () => [
    'memory-2000-bbb.txt',
    'memory-1000-aaa.txt',
  ]),
  userMemoryReadSnapshot: jest.fn(async (name: string) =>
    name === 'memory-1000-aaa.txt' ? 'user v1' : 'user v2',
  ),
  snapshotDate: (name: string) => {
    const m = /^memory-([0-9]+)-/.exec(name);
    return m ? new Date(Number(m[1])) : null;
  },
}));

const memory = jest.requireMock('../../../services/talents/agentMemory');

describe('MemorySection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads both memories when visible', async () => {
    const {getByTestId} = render(<MemorySection isVisible />);
    await waitFor(() =>
      expect(getByTestId('user-memory-editor').props.value).toBe('user v3'),
    );
    expect(getByTestId('model-memory-editor').props.value).toBe('model v2');
  });

  it('saves user memory against the last loaded version', async () => {
    const {getByTestId} = render(<MemorySection isVisible />);
    await waitFor(() =>
      expect(getByTestId('user-memory-editor').props.value).toBe('user v3'),
    );
    fireEvent.changeText(getByTestId('user-memory-editor'), 'user v4');
    fireEvent.press(getByTestId('user-memory-save'));
    await waitFor(() =>
      expect(memory.userMemoryReplace).toHaveBeenCalledWith(
        'user v4',
        'user v3',
      ),
    );
    expect(memory.memoryReplace).not.toHaveBeenCalled();
  });

  it('lists every snapshot and restores the one picked', async () => {
    const {getByTestId, findByTestId, getByText} = render(
      <MemorySection isVisible />,
    );
    await waitFor(() =>
      expect(getByTestId('user-memory-editor').props.value).toBe('user v3'),
    );
    fireEvent.press(getByTestId('user-memory-history'));
    // Both snapshots are offered, not just the latest.
    await findByTestId('memory-snapshot-memory-2000-bbb.txt');
    fireEvent.press(getByTestId('memory-snapshot-memory-1000-aaa.txt'));
    await findByTestId('memory-snapshot-preview');
    expect(getByText('user v1')).toBeTruthy();
    fireEvent.press(getByTestId('memory-snapshot-restore'));
    await waitFor(() =>
      expect(memory.userMemoryReplace).toHaveBeenCalledWith(
        'user v1',
        'user v3',
      ),
    );
  });
});
