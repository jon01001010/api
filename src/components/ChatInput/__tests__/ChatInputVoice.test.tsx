import * as React from 'react';
import {waitFor} from '@testing-library/react-native';
import {runInAction} from 'mobx';

import {user} from '../../../../jest/fixtures';
import {render} from '../../../../jest/test-utils';
import {UserContext} from '../../../utils';
import {modelStore} from '../../../store';
import {setVoiceSender} from '../../../services/voice/voiceController';

import {ChatInput} from '../ChatInput';

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
jest.mock('../../../services/voice/voiceController', () => ({
  setVoiceSender: jest.fn(),
  startVoiceInput: jest.fn(),
  stopVoiceInput: jest.fn(),
  cancelVoiceInput: jest.fn(),
  watchConversation: jest.fn(() => () => {}),
  sendSpoken: jest.fn(),
  setBeforeListen: jest.fn(),
}));

describe('ChatInput: voice input', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runInAction(() => {
      modelStore.activeModelId = 'model-1';
    });
  });

  const renderInput = () => {
    const onSendPress = jest.fn();
    const utils = render(
      <UserContext.Provider value={user}>
        <ChatInput
          onSendPress={onSendPress}
          isVisionEnabled={false}
          sendButtonVisibilityMode="editing"
        />
      </UserContext.Provider>,
    );
    return {...utils, onSendPress};
  };

  it('shows the mic and sends spoken text like a typed message', async () => {
    const {getByTestId, onSendPress} = renderInput();
    expect(getByTestId('mic-button')).toBeTruthy();
    const send = (setVoiceSender as jest.Mock).mock.calls.at(-1)[0];
    send('  set a timer for five minutes ');
    await waitFor(() =>
      expect(onSendPress).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'set a timer for five minutes',
          type: 'text',
        }),
      ),
    );
  });

  it('unregisters when the input goes away', () => {
    const {unmount} = renderInput();
    unmount();
    expect(setVoiceSender).toHaveBeenLastCalledWith(null);
  });
});
