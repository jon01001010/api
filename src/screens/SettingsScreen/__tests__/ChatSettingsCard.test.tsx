import React from 'react';

import {render, fireEvent, waitFor} from '../../../../jest/test-utils';

import {ChatSettingsCard} from '../ChatSettingsCard';
import {chatSessionStore} from '../../../store';
import * as exportUtils from '../../../utils/exportUtils';

jest.mock('../../../utils/exportUtils', () => ({
  exportChatSession: jest.fn().mockResolvedValue(undefined),
  exportChatSessionAsMarkdown: jest.fn().mockResolvedValue(undefined),
  exportAllChatSessions: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../utils/importUtils', () => ({
  importChatSessions: jest.fn().mockResolvedValue(0),
}));
jest.mock(
  '../../../components/ChatGenerationSettingsSheet/ChatGenerationSettingsSheet',
  () => ({
    ChatGenerationSettingsSheet: ({isVisible}: {isVisible: boolean}) => {
      const {View} = require('react-native');
      return isVisible ? (
        <View testID="chat-generation-settings-sheet" />
      ) : null;
    },
  }),
);

describe('ChatSettingsCard (moved from the chat ⋮ menu)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatSessionStore.activeSessionId = null;
  });

  it('opens the chat generation settings', () => {
    const {getByTestId, queryByTestId} = render(<ChatSettingsCard />);
    expect(queryByTestId('chat-generation-settings-sheet')).toBeNull();
    fireEvent.press(getByTestId('chat-generation-settings-button'));
    expect(getByTestId('chat-generation-settings-sheet')).toBeTruthy();
  });

  it('exports the open chat, or all chats', async () => {
    chatSessionStore.activeSessionId = 'session-1';
    const {getByTestId} = render(<ChatSettingsCard />);
    fireEvent.press(getByTestId('export-current-chat-button'));
    fireEvent.press(getByTestId('export-current-chat-markdown-button'));
    fireEvent.press(getByTestId('export-all-chats-button'));
    await waitFor(() => {
      expect(exportUtils.exportChatSession).toHaveBeenCalledWith('session-1');
      expect(exportUtils.exportChatSessionAsMarkdown).toHaveBeenCalledWith(
        'session-1',
      );
      expect(exportUtils.exportAllChatSessions).toHaveBeenCalled();
    });
  });

  it('current-chat export is off when no chat is open', () => {
    const {getByTestId} = render(<ChatSettingsCard />);
    fireEvent.press(getByTestId('export-current-chat-button'));
    expect(exportUtils.exportChatSession).not.toHaveBeenCalled();
  });
});
