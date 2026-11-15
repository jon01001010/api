import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {Provider as PaperProvider} from 'react-native-paper';

import {HomeLinkCard} from '../HomeLinkCard';
import {
  linkDeviceMayAnswer,
  linkDeviceMayCommand,
  linkDeviceMayPicture,
  linkPicturesAllow,
  linkStatus,
} from '../../../services/desktop/homeLink';

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
  linkDeviceMayPicture: jest.fn(async () => {}),
  linkDeviceMayRead: jest.fn(async () => {}),
  linkDeviceMayAct: jest.fn(async () => {}),
  linkDeviceMayCommand: jest.fn(async () => {}),
  linkToolsAllow: jest.fn(async () => {}),
  linkPicturesAllow: jest.fn(async () => {}),
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

describe('Home link card: pictures for paired devices', () => {
  it('off: the PC switch is off and no per-device switch shows', async () => {
    const {findByTestId, queryByTestId} = show();
    expect((await findByTestId('home-link-pictures-allow')).props.value).toBe(
      false,
    );
    expect(queryByTestId('home-link-may-picture-aaaa')).toBeNull();
    fireEvent(
      await findByTestId('home-link-pictures-allow'),
      'valueChange',
      true,
    );
    await waitFor(() => expect(linkPicturesAllow).toHaveBeenCalledWith(true));
  });

  it('on: one switch per device, off unless allowed; changes go to the PC', async () => {
    (linkStatus as jest.Mock).mockResolvedValueOnce({
      on: true,
      pcId: 'pc',
      picturesAllowed: true,
      phones: [
        {id: 'aaaa', name: 'Pixel', mayAnswer: true},
        {id: 'bbbb', name: 'Laptop', mayPicture: true},
      ],
      events: [],
    });
    const {findByTestId, getByTestId} = show();
    expect((await findByTestId('home-link-may-picture-bbbb')).props.value).toBe(
      true,
    );
    // May answer does not mean may make pictures.
    expect(getByTestId('home-link-may-picture-aaaa').props.value).toBe(false);
    fireEvent(getByTestId('home-link-may-picture-aaaa'), 'valueChange', true);
    await waitFor(() =>
      expect(linkDeviceMayPicture).toHaveBeenCalledWith('aaaa', true),
    );
  });
});

describe('Home link card: commands from paired devices', () => {
  it('"May run commands" is its own switch, off unless allowed; changes go to the PC', async () => {
    (linkStatus as jest.Mock).mockResolvedValueOnce({
      on: true,
      pcId: 'pc',
      toolsAllowed: true,
      phones: [
        {id: 'aaaa', name: 'Pixel', mayRead: true, mayAct: true},
        {id: 'bbbb', name: 'Laptop', mayCommand: true},
      ],
      events: [],
    });
    const {findByTestId, getByTestId} = show();
    expect((await findByTestId('home-link-may-command-bbbb')).props.value).toBe(
      true,
    );
    // May read and may act do not mean may run commands.
    expect(getByTestId('home-link-may-command-aaaa').props.value).toBe(false);
    fireEvent(getByTestId('home-link-may-command-aaaa'), 'valueChange', true);
    await waitFor(() =>
      expect(linkDeviceMayCommand).toHaveBeenCalledWith('aaaa', true),
    );
  });

  it('shows no per-device switch while device tools are off on this PC', async () => {
    const {findByTestId, queryByTestId} = show();
    await findByTestId('home-link-forget-aaaa');
    expect(queryByTestId('home-link-may-command-aaaa')).toBeNull();
  });
});
