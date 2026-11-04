import React from 'react';
import {fireEvent} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';
import {uiStore} from '../../../store';
import {undoVisionSwitch} from '../../../services/visionSwitch';
import {VisionSwitchNotice} from '../VisionSwitchNotice';

jest.mock('../../../services/visionSwitch', () => ({
  undoVisionSwitch: jest.fn(() => Promise.resolve()),
}));

describe('VisionSwitchNotice', () => {
  afterEach(() => uiStore.setVisionSwitchNotice(null));

  it('says which model is now used and offers Undo', () => {
    uiStore.setVisionSwitchNotice({
      previousModelId: 'qwen',
      modelId: 'smolvlm',
      modelName: 'SmolVLM2',
    });
    const {getByText} = render(<VisionSwitchNotice />);
    expect(
      getByText(
        'Switched to SmolVLM2 to see your picture. Your model comes back after the answer.',
      ),
    ).toBeTruthy();
    fireEvent.press(getByText('Undo'));
    expect(undoVisionSwitch).toHaveBeenCalled();
  });

  it('shows nothing without a switch', () => {
    uiStore.setVisionSwitchNotice(null);
    const {queryByText} = render(<VisionSwitchNotice />);
    expect(queryByText('Undo')).toBeNull();
  });
});
