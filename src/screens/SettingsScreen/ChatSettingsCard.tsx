import React, {useContext, useState} from 'react';
import {Alert} from 'react-native';
import {observer} from 'mobx-react-lite';
import {Button, Card, Text} from 'react-native-paper';

import {ChatGenerationSettingsSheet} from '../../components';
import {chatSessionStore} from '../../store';
import {L10nContext} from '../../utils';
import {t} from '../../locales';
import {
  exportAllChatSessions,
  exportChatSession,
  exportChatSessionAsMarkdown,
} from '../../utils/exportUtils';
import {importChatSessions} from '../../utils/importUtils';

/**
 * Chat settings and chat export/import, moved here from the chat screen's
 * top-right menu so every setting lives in Settings. "Current chat" is the
 * chat open in the Chat screen.
 */
export const ChatSettingsCard: React.FC<{cardStyle?: object}> = observer(
  ({cardStyle}) => {
    const l10n = useContext(L10nContext);
    const [showGeneration, setShowGeneration] = useState(false);
    const sessionId = chatSessionStore.activeSessionId;
    const headerRight = l10n.components.headerRight;

    const run = async (task: () => Promise<unknown>, failure: string) => {
      try {
        await task();
      } catch (error) {
        console.error(failure, error);
        Alert.alert('Export Error', failure);
      }
    };

    const onImport = async () => {
      try {
        const count = await importChatSessions();
        if (count > 0) {
          Alert.alert(
            'Import Success',
            t(l10n.settings.importSuccess, {count: count.toString()}),
          );
          await chatSessionStore.loadSessionList();
        }
      } catch (error) {
        console.error('Error importing sessions:', error);
        Alert.alert('Import Error', l10n.settings.importError);
      }
    };

    return (
      <Card elevation={0} style={cardStyle} testID="chat-settings-card">
        <Card.Title title="Chat" />
        <Card.Content style={{gap: 8}}>
          <Button
            mode="outlined"
            icon="tune-variant"
            testID="chat-generation-settings-button"
            onPress={() => setShowGeneration(true)}>
            {headerRight.generationSettings}
          </Button>
          <Text variant="labelSmall">
            Export applies to the chat open in the Chat screen.
          </Text>
          <Button
            mode="outlined"
            disabled={!sessionId}
            testID="export-current-chat-button"
            onPress={() =>
              sessionId &&
              run(
                () => exportChatSession(sessionId),
                'Failed to export the current session.',
              )
            }>
            {headerRight.exportCurrentSession}
          </Button>
          <Button
            mode="outlined"
            disabled={!sessionId}
            testID="export-current-chat-markdown-button"
            onPress={() =>
              sessionId &&
              run(
                () => exportChatSessionAsMarkdown(sessionId),
                'Failed to export the current session.',
              )
            }>
            {headerRight.exportCurrentSessionMarkdown}
          </Button>
          <Button
            mode="outlined"
            testID="export-all-chats-button"
            onPress={() =>
              run(exportAllChatSessions, 'Failed to export all sessions.')
            }>
            {headerRight.exportAllSessions}
          </Button>
          <Button
            mode="outlined"
            testID="import-chats-button"
            onPress={onImport}>
            {headerRight.importSessions}
          </Button>
        </Card.Content>
        <ChatGenerationSettingsSheet
          isVisible={showGeneration}
          onClose={() => setShowGeneration(false)}
        />
      </Card>
    );
  },
);
