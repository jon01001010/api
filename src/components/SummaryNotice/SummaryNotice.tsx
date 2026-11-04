import React, {useContext} from 'react';
import {Snackbar} from 'react-native-paper';
import {observer} from 'mobx-react';

import {uiStore} from '../../store';
import {removeSummary} from '../../services/chatSummary';
import {L10nContext} from '../../utils';

/**
 * Context summary progress and result: "Summarizing…", then "Earlier
 * messages summarized." with Undo, or why nothing changed.
 */
export const SummaryNotice: React.FC = observer(() => {
  const l10n = useContext(L10nContext);
  const notice = uiStore.summaryNotice;
  const text = !notice
    ? ''
    : notice.kind === 'working'
      ? l10n.chat.summaryWorking
      : notice.kind === 'failed'
        ? l10n.chat.summaryFailed
        : notice.kind === 'nothing'
          ? l10n.chat.summaryNothing
          : notice.automatic
            ? l10n.chat.summaryDoneAuto
            : l10n.chat.summaryDone;
  const messageId = notice?.kind === 'done' ? notice.messageId : undefined;
  return (
    <Snackbar
      testID="summary-notice"
      visible={notice !== null}
      // Stay up while working; the result replaces it.
      duration={notice?.kind === 'working' ? 60000 : 8000}
      onDismiss={() => uiStore.setSummaryNotice(null)}
      action={
        messageId
          ? {
              label: l10n.chat.summaryUndo,
              onPress: () => {
                removeSummary(messageId).catch(() => {});
              },
            }
          : undefined
      }>
      {text}
    </Snackbar>
  );
});
