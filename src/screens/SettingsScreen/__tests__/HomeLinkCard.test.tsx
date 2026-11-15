import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {Provider as PaperProvider} from 'react-native-paper';

import {HomeLinkCard} from '../HomeLinkCard';
import {linkDeviceMayAnswer} from '../../../services/desktop/homeLink';

let mockAnswers = false;
jest.mock('../../../services/sync/hostSync', () => ({
  hostSyncAllowed: jest.fn(async () => false),
  hostMirrorAllowed: jest.fn(async () => false),
  hostAnswersAllowed: jest.fn(async () => mockAnswers),
  setHostSyncAllowed: jest.fn(async () => {}),
  setHostMirrorAllowed: jest.fn(async () => {}),
  setHostAnswersAllowed: jest.fn(async () => {}),
}));
jest.mock('../../../services/desktop/homeLink', () => ({
  homeLinkAvailable: () => true,
  linkStatus: jest.fn(async () => ({
    on: true,
    pcId: 'pc',
    phones: [
      {id: 'aaaa', name: 'Pixel', mayAnswer: true},
      {id: 'bbbb', name: 'Laptop'},
    ],
    events: [],
  })),
  linkPair: jest.fn(),
  linkOn: jest.fn(),
  linkOff: jest.fn(),
  linkForget: jest.fn(),
  linkDeviceMayAnswer: jest.fn(async () => {}),
}));
jest.mock('../../../components/HomeLinkSync/RecentlyDeletedChats', () => ({
  RecentlyDeletedChats: () => null,
}));

const show = () =>
  render(
    <PaperProvider>
      <HomeLinkCard />
    </PaperProvider>,
  );

describe('Home link card: which devices may answer', () => {
  it('shows no per-device switch while answering is off on this PC', async () => {
    mockAnswers = false;
    const {findByTestId, queryByTestId} = show();
    await findByTestId('home-link-forget-aaaa');
    expect(queryByTestId('home-link-may-answer-aaaa')).toBeNull();
  });

  it('one switch per device, off unless allowed; changes go to the PC', async () => {
    mockAnswers = true;
    const {findByTestId, getByTestId} = show();
    expect((await findByTestId('home-link-may-answer-aaaa')).props.value).toBe(
      true,
    );
    // An old record without the field: not allowed.
    expect(getByTestId('home-link-may-answer-bbbb').props.value).toBe(false);
    fireEvent(getByTestId('home-link-may-answer-bbbb'), 'valueChange', true);
    await waitFor(() =>
      expect(linkDeviceMayAnswer).toHaveBeenCalledWith('bbbb', true),
    );
    fireEvent(getByTestId('home-link-may-answer-aaaa'), 'valueChange', false);
    await waitFor(() =>
      expect(linkDeviceMayAnswer).toHaveBeenCalledWith('aaaa', false),
    );
  });
});
