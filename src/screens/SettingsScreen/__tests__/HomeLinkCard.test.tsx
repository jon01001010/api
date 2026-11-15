import React from 'react';
import {Alert, NativeModules} from 'react-native';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {Provider as PaperProvider} from 'react-native-paper';

import {HomeLinkCard} from '../HomeLinkCard';
import {
  linkDeviceMayAnswer,
  linkDeviceMayCommand,
  linkDeviceMayPicture,
  linkForget,
  linkKeyMode,
  linkPicturesAllow,
  linkStatus,
  linkUseOneKey,
} from '../../../services/desktop/homeLink';
import {serverStore} from '../../../store';

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
  linkForget: jest.fn(async () => {}),
  linkKeyMode: jest.fn(async () => ({
    oneKey: false,
    linkKey: 'l'.repeat(64),
    deviceKey: 'd'.repeat(64),
  })),
  linkUseOneKey: jest.fn(async () => {}),
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
    await findByTestId('your-devices-remove-aaaa');
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
    await findByTestId('your-devices-remove-aaaa');
    expect(queryByTestId('home-link-may-command-aaaa')).toBeNull();
  });
});

describe('Home link card: your devices', () => {
  const pressAlert = (button: string) => {
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1);
    return act(() =>
      buttons.find((b: {text: string}) => b.text === button).onPress(),
    );
  };
  beforeEach(() => {
    serverStore.servers = [];
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    (Alert.alert as jest.Mock).mockRestore();
  });

  it('lists devices that use this PC and PCs it uses, with what each was given', async () => {
    serverStore.servers = [
      {id: 's1', name: 'Desktop', url: 'x', homeLinkPc: 'cccc'},
    ];
    const {findByTestId, getByTestId} = show();
    await findByTestId('your-devices-aaaa');
    expect(getByTestId('your-devices-cccc')).toBeTruthy();
    expect(getByTestId('your-devices-rights-aaaa').props.children).toBe(
      'May use here: Model, Answer questions',
    );
    expect(getByTestId('your-devices-rights-bbbb').props.children).toBe(
      'May use here: Model',
    );
    expect(getByTestId('your-devices-rights-cccc').props.children).toMatch(
      /^Given nothing by this device/,
    );
  });

  it('removing asks first, removes here, then tells the other devices', async () => {
    serverStore.servers = [
      {id: 's1', name: 'Desktop', url: 'x', homeLinkPc: 'cccc'},
    ];
    const circle = jest.fn(async () => JSON.stringify({ok: true}));
    (NativeModules as any).HomeLink = {circle};
    const {findByTestId} = show();
    fireEvent.press(await findByTestId('your-devices-remove-aaaa'));
    expect(linkForget).not.toHaveBeenCalled();
    expect(circle).not.toHaveBeenCalled();
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)[1]).toContain(
      'Your other devices are told too',
    );
    await pressAlert('Remove here');
    expect(linkForget).toHaveBeenCalledWith('aaaa');
    expect(serverStore.removeServer).not.toHaveBeenCalled();
    // A removal notice signed by this device (only ever a removal).
    expect(JSON.parse((circle.mock.calls[0] as any)[0])).toEqual({
      op: 'remove',
      key: 'aaaa',
      homePcs: ['cccc'],
    });
    expect((await findByTestId('your-devices-message')).props.children).toBe(
      'Removed "Pixel" here. Your other devices are told the next time they talk to this one.',
    );
    fireEvent.press(await findByTestId('your-devices-remove-cccc'));
    await pressAlert('Remove here');
    expect(serverStore.removeServer).toHaveBeenCalledWith('s1');
    expect(linkForget).not.toHaveBeenCalledWith('cccc');
    const removals = circle.mock.calls
      .map((c: any) => JSON.parse(c[0]))
      .filter(r => r.op === 'remove');
    expect(removals.map(r => r.key)).toEqual(['aaaa', 'cccc']);
    delete (NativeModules as any).HomeLink;
  });

  it('a PC with two keys can move to one key, told to pair again by hand', async () => {
    serverStore.servers = [
      {id: 's1', name: 'Desktop', url: 'x', homeLinkPc: 'cccc'},
    ];
    const {findByTestId} = show();
    fireEvent.press(await findByTestId('your-devices-use-one-key'));
    expect(linkUseOneKey).not.toHaveBeenCalled();
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)[1]).toContain(
      'pair with each one again by hand',
    );
    await pressAlert('Use one key');
    expect(linkUseOneKey).toHaveBeenCalled();
  });

  it('a PC with one key offers no move', async () => {
    (linkKeyMode as jest.Mock).mockResolvedValue({
      oneKey: true,
      linkKey: 'l'.repeat(64),
      deviceKey: 'l'.repeat(64),
    });
    const {findByTestId, queryByTestId} = show();
    await findByTestId('your-devices-key-mode');
    expect(queryByTestId('your-devices-use-one-key')).toBeNull();
  });
});
