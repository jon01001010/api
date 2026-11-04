import {fireEvent, waitFor} from '@testing-library/react-native';
import * as React from 'react';
import {runInAction} from 'mobx';

import {user} from '../../../../jest/fixtures';
import {l10n} from '../../../locales';
import {UserContext} from '../../../utils';
import {ChatInput} from '../ChatInput';
import {render} from '../../../../jest/test-utils';
import {modelStore, uiStore} from '../../../store';
import {
  ensureVisionForPictures,
  returnFromVision,
} from '../../../services/visionSwitch';

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
jest.mock('../../../services/visionSwitch', () => ({
  ensureVisionForPictures: jest.fn(),
  returnFromVision: jest.fn().mockResolvedValue(undefined),
}));

const visionModel = {
  id: 'smolvlm',
  name: 'SmolVLM2',
  isDownloaded: true,
  supportsMultimodal: true,
  origin: 'local',
};

const renderInput = (props: Record<string, unknown> = {}) => {
  const onSendPress = jest.fn();
  const utils = render(
    <UserContext.Provider value={user}>
      <ChatInput
        onSendPress={onSendPress}
        isVisionEnabled={false}
        showImageUpload
        sendButtonVisibilityMode="editing"
        textInputProps={{defaultValue: 'What is this?'}}
        {...props}
      />
    </UserContext.Provider>,
  );
  return {...utils, onSendPress};
};

const pressSend = (getByLabelText: any) =>
  fireEvent.press(
    getByLabelText(l10n.en.components.sendButton.accessibilityLabel),
  );

describe('ChatInput: picture sent to a text model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runInAction(() => {
      modelStore.activeModelId = 'qwen';
      (modelStore as any).models = [visionModel];
    });
  });

  afterEach(() =>
    runInAction(() => {
      (modelStore as any).models = [];
    }),
  );

  it('offers Camera and Gallery when a downloaded model can see', () => {
    const {getByLabelText, getByText} = renderInput();
    fireEvent.press(getByLabelText('Add attachment'));
    expect(getByText('Gallery')).toBeTruthy();
  });

  it('switches to the vision model before sending the picture', async () => {
    (ensureVisionForPictures as jest.Mock).mockResolvedValue('switched');
    const {getByLabelText, onSendPress} = renderInput({
      defaultImages: ['file:///photo.jpg'],
    });
    pressSend(getByLabelText);
    await waitFor(() => expect(onSendPress).toHaveBeenCalled());
    expect(ensureVisionForPictures).toHaveBeenCalledTimes(1);
    expect(onSendPress).toHaveBeenCalledWith(
      expect.objectContaining({imageUris: ['file:///photo.jpg']}),
    );
  });

  it('goes back to the original model once the reply has finished', async () => {
    (ensureVisionForPictures as jest.Mock).mockResolvedValue('switched');
    let finishReply: () => void = () => {};
    const reply = new Promise<void>(resolve => {
      finishReply = resolve;
    });
    const {getByLabelText, onSendPress} = renderInput({
      defaultImages: ['file:///photo.jpg'],
    });
    onSendPress.mockReturnValue(reply);
    pressSend(getByLabelText);
    await waitFor(() => expect(onSendPress).toHaveBeenCalled());
    expect(returnFromVision).not.toHaveBeenCalled();
    finishReply();
    await waitFor(() => expect(returnFromVision).toHaveBeenCalledTimes(1));
  });

  it('does not switch back when no switch was needed', async () => {
    (ensureVisionForPictures as jest.Mock).mockResolvedValue('ready');
    const {getByLabelText, onSendPress} = renderInput({
      defaultImages: ['file:///photo.jpg'],
    });
    pressSend(getByLabelText);
    await waitFor(() => expect(onSendPress).toHaveBeenCalled());
    await new Promise(resolve => setImmediate(resolve));
    expect(returnFromVision).not.toHaveBeenCalled();
  });

  it('keeps the draft when the switch is cancelled', async () => {
    (ensureVisionForPictures as jest.Mock).mockResolvedValue('cancelled');
    const {getByLabelText, getByDisplayValue, onSendPress} = renderInput({
      defaultImages: ['file:///photo.jpg'],
    });
    pressSend(getByLabelText);
    await waitFor(() => expect(ensureVisionForPictures).toHaveBeenCalled());
    expect(onSendPress).not.toHaveBeenCalled();
    expect(getByDisplayValue('What is this?')).toBeTruthy();
  });

  it('explains when no downloaded model can see, and keeps the draft', async () => {
    (ensureVisionForPictures as jest.Mock).mockResolvedValue('none');
    const {getByLabelText, onSendPress} = renderInput({
      defaultImages: ['file:///photo.jpg'],
    });
    pressSend(getByLabelText);
    await waitFor(() =>
      expect(uiStore.setChatWarning).toHaveBeenCalledWith(
        expect.objectContaining({message: l10n.en.chat.noVisionModel}),
      ),
    );
    expect(onSendPress).not.toHaveBeenCalled();
  });

  it('sends text-only messages straight away (no switch)', async () => {
    const {getByLabelText, onSendPress} = renderInput();
    pressSend(getByLabelText);
    await waitFor(() => expect(onSendPress).toHaveBeenCalled());
    expect(ensureVisionForPictures).not.toHaveBeenCalled();
  });
});
