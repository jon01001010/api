import React from 'react';
import {runInAction} from 'mobx';

import {fireEvent, render, waitFor} from '../../../../jest/test-utils';
import {uiStore, voiceStore} from '../../../store';
import * as models from '../../../services/voice/whisperModels';

import {VoiceInputSheet} from '../VoiceInputSheet';

describe('VoiceInputSheet', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    runInAction(() => {
      voiceStore.isSheetOpen = true;
      voiceStore.models = [];
      voiceStore.selectedModelId = null;
      voiceStore.conversationMode = false;
      voiceStore.downloads = {};
    });
  });

  it('offers the recommended model when none is downloaded', () => {
    const {getByText, getByTestId} = render(<VoiceInputSheet />);
    expect(
      getByText('No speech-to-text model yet. Download one below.'),
    ).toBeTruthy();
    expect(getByTestId('voice-download-recommended')).toBeTruthy();
  });

  it('suggests a small model and a more accurate one', () => {
    const {getByText, getByTestId} = render(<VoiceInputSheet />);
    expect(getByText('ggml-tiny.en.bin')).toBeTruthy();
    expect(getByText('ggml-base.en.bin')).toBeTruthy();
    expect(getByTestId('voice-download-accurate')).toBeTruthy();
  });

  it('shows the wake status, its error, and what it last heard', () => {
    runInAction(() => {
      voiceStore.wakeStatus = 'error';
      voiceStore.wakeError = 'Not listening: no native part';
      voiceStore.lastHeard = 'Hey, Asian.';
    });
    const {getByTestId} = render(<VoiceInputSheet />);
    expect(getByTestId('voice-wake-status')).toHaveTextContent(
      'Not listening: no native part',
    );
    expect(getByTestId('voice-last-heard')).toHaveTextContent(
      'Last heard: "Hey, Asian."',
    );
    runInAction(() => {
      voiceStore.wakeStatus = 'off';
      voiceStore.wakeError = null;
      voiceStore.lastHeard = null;
    });
  });

  it('switches conversation mode', () => {
    const {getByTestId} = render(<VoiceInputSheet />);
    fireEvent(getByTestId('voice-conversation-switch'), 'valueChange', true);
    expect(voiceStore.conversationMode).toBe(true);
  });

  it('wake word needs a speech model before it can turn on', async () => {
    const {getByTestId} = render(<VoiceInputSheet />);
    fireEvent(getByTestId('voice-wake-switch'), 'valueChange', true);
    await waitFor(() =>
      expect(uiStore.setChatWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          message: uiStore.l10n.voiceAndSpeech.voiceInput.wakeNeedsModel,
        }),
      ),
    );
    expect(voiceStore.wakeEnabled).toBe(false);
  });

  it('saves the wake phrase', () => {
    const {getByTestId} = render(<VoiceInputSheet />);
    fireEvent.changeText(getByTestId('voice-wake-phrase'), '  Computer ');
    fireEvent(getByTestId('voice-wake-phrase'), 'endEditing');
    expect(voiceStore.wakePhrase).toBe('Computer');
    fireEvent.changeText(getByTestId('voice-wake-phrase'), '   ');
    fireEvent(getByTestId('voice-wake-phrase'), 'endEditing');
    expect(voiceStore.wakePhrase).toBe('Hey Agent');
  });

  it('finds models from any uploader and warns about unknown ones', async () => {
    jest.spyOn(models, 'searchWhisperModels').mockResolvedValue([
      {repo: 'ggerganov/whisper.cpp', file: 'ggml-small.bin', size: 466e6},
      {repo: 'someone/whisper-fr', file: 'ggml-fr.bin'},
    ]);
    const download = jest
      .spyOn(models, 'downloadWhisperModel')
      .mockImplementation(async m => ({...m, path: '/p', size: 1}));
    const {getByTestId, getByText, queryByText} = render(<VoiceInputSheet />);
    fireEvent.changeText(getByTestId('voice-search-input'), 'whisper fr');
    fireEvent.press(getByTestId('voice-search-button'));
    await waitFor(() => expect(getByText('ggml-fr.bin')).toBeTruthy());
    expect(models.searchWhisperModels).toHaveBeenCalledWith(
      'whisper fr',
      expect.anything(),
    );
    expect(getByText('ggerganov/whisper.cpp · 466 MB')).toBeTruthy();
    expect(queryByText(/From ggerganov:/)).toBeNull();
    expect(getByText(/From someone: not a well-known uploader/)).toBeTruthy();
    fireEvent.press(
      getByTestId('voice-download-someone/whisper-fr/ggml-fr.bin'),
    );
    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(
        {repo: 'someone/whisper-fr', file: 'ggml-fr.bin'},
        expect.any(Function),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(voiceStore.models).toHaveLength(1));
  });

  it('lists downloaded models, the one in use, and delete', async () => {
    const m = {repo: 'a/b', file: 'ggml-tiny.bin', path: '/p', size: 75e6};
    runInAction(() => {
      voiceStore.models = [m];
    });
    const remove = jest.spyOn(models, 'deleteWhisperModel').mockResolvedValue();
    const {getByText, getByTestId} = render(<VoiceInputSheet />);
    expect(getByText('In use')).toBeTruthy();
    fireEvent.press(getByTestId('voice-delete-a/b/ggml-tiny.bin'));
    expect(remove).toHaveBeenCalledWith(m);
    await waitFor(() => expect(voiceStore.models).toHaveLength(0));
  });

  it('shows download progress', () => {
    runInAction(() => {
      voiceStore.downloads = {
        [models.whisperModelId(models.RECOMMENDED_WHISPER)]: 0.42,
      };
    });
    const {getByText} = render(<VoiceInputSheet />);
    expect(getByText('Downloading 42%')).toBeTruthy();
  });
});
