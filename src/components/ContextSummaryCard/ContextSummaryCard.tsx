import React, {useContext, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {Button, Text, TextInput} from 'react-native-paper';

import {Dialog} from '../Dialog';
import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';
import {t} from '../../locales';
import type {MessageType} from '../../utils/types';
import {
  editSummary,
  removeSummary,
  type SummaryMeta,
} from '../../services/chatSummary';

interface Props {
  message: MessageType.Text;
}

/**
 * A summary marker in the chat: "Earlier messages summarized (N)", with
 * Show/Hide for the text the model now sees, Edit, and Undo.
 */
export const ContextSummaryCard: React.FC<Props> = ({message}) => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const count = (message.metadata as SummaryMeta | undefined)?.summarizedCount;

  const save = () => {
    const text = draft.trim();
    setEditing(false);
    if (text && text !== message.text) {
      editSummary(message.id, text).catch(() => {});
    }
  };

  return (
    <View
      testID="context-summary-card"
      style={[
        styles.card,
        {
          borderColor: theme.colors.outline,
          backgroundColor: theme.colors.surfaceVariant,
        },
      ]}>
      <Text
        style={[styles.title, {color: theme.colors.onSurfaceVariant}]}
        testID="context-summary-title">
        {t(l10n.chat.summaryTitle, {count: String(count ?? 0)})}
      </Text>
      {open ? (
        <Text
          selectable
          testID="context-summary-text"
          style={[styles.body, {color: theme.colors.onSurface}]}>
          {message.text}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          compact
          mode="text"
          testID="context-summary-toggle"
          onPress={() => setOpen(!open)}>
          {open ? l10n.chat.summaryHide : l10n.chat.summaryShow}
        </Button>
        <Button
          compact
          mode="text"
          testID="context-summary-edit"
          onPress={() => {
            setDraft(message.text);
            setEditing(true);
          }}>
          {l10n.chat.summaryEdit}
        </Button>
        <Button
          compact
          mode="text"
          testID="context-summary-undo"
          onPress={() => {
            removeSummary(message.id).catch(() => {});
          }}>
          {l10n.chat.summaryUndo}
        </Button>
      </View>
      <Dialog
        testID="context-summary-edit-dialog"
        visible={editing}
        onDismiss={() => setEditing(false)}
        title={l10n.chat.summaryEditTitle}
        avoidKeyboard
        actions={[
          {
            label: l10n.chat.summaryCancel,
            onPress: () => setEditing(false),
          },
          {
            label: l10n.chat.summarySave,
            onPress: save,
            mode: 'contained',
            testID: 'context-summary-save',
          },
        ]}>
        <TextInput
          testID="context-summary-input"
          multiline
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
        />
      </Dialog>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  title: {fontSize: 13, fontWeight: '600'},
  body: {fontSize: 14, marginTop: 8, lineHeight: 20},
  actions: {flexDirection: 'row', justifyContent: 'flex-end'},
  input: {maxHeight: 320},
});
