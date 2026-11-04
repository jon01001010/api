import React from 'react';
import {runInAction} from 'mobx';

import {fireEvent, render} from '../../../../jest/test-utils';
import {voiceStore} from '../../../store';
import * as controller from '../../../services/voice/voiceController';

import {MicButton} from '../MicButton';

describe('MicButton', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(controller, 'startVoiceInput').mockResolvedValue('started');
    jest.spyOn(controller, 'stopVoiceInput').mockImplementation(() => {});
    jest.spyOn(controller, 'cancelVoiceInput').mockImplementation(() => {});
    runInAction(() => {
      voiceStore.state = 'idle';
      voiceStore.isSheetOpen = false;
    });
  });

  it('starts listening on tap', () => {
    const {getByTestId} = render(<MicButton color="#000" />);
    fireEvent.press(getByTestId('mic-button'));
    expect(controller.startVoiceInput).toHaveBeenCalled();
  });

  it('shows it is listening, and a tap stops early', () => {
    runInAction(() => {
      voiceStore.state = 'listening';
    });
    const {getByTestId, getByLabelText} = render(<MicButton color="#000" />);
    expect(getByTestId('mic-listening')).toBeTruthy();
    fireEvent.press(getByLabelText('Stop listening'));
    expect(controller.stopVoiceInput).toHaveBeenCalled();
  });

  it('shows progress while writing down the speech', () => {
    runInAction(() => {
      voiceStore.state = 'transcribing';
    });
    const {getByTestId} = render(<MicButton color="#000" />);
    expect(getByTestId('mic-transcribing')).toBeTruthy();
    fireEvent.press(getByTestId('mic-button'));
    expect(controller.startVoiceInput).not.toHaveBeenCalled();
  });

  it('long-press opens Voice input settings', () => {
    const {getByTestId} = render(<MicButton color="#000" />);
    fireEvent(getByTestId('mic-button'), 'longPress');
    expect(voiceStore.isSheetOpen).toBe(true);
  });
});
