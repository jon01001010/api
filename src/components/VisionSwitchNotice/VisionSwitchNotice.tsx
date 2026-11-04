import React, {useContext} from 'react';
import {Snackbar} from 'react-native-paper';
import {observer} from 'mobx-react';

import {uiStore} from '../../store';
import {undoVisionSwitch} from '../../services/visionSwitch';
import {L10nContext} from '../../utils';

/**
 * "Switched to <model> to see your picture." with Undo, shown after a
 * picture made the app switch from a text model to a vision model.
 */
export const VisionSwitchNotice: React.FC = observer(() => {
  const l10n = useContext(L10nContext);
  const notice = uiStore.visionSwitchNotice;
  return (
    <Snackbar
      testID="vision-switch-notice"
      visible={notice !== null}
      duration={8000}
      onDismiss={() => uiStore.setVisionSwitchNotice(null)}
      action={
        notice?.previousModelId
          ? {
              label: l10n.chat.undo,
              onPress: () => {
                undoVisionSwitch().catch(() => {});
              },
            }
          : undefined
      }>
      {notice
        ? l10n.chat.switchedToVision.replace('{{model}}', notice.modelName)
        : ''}
    </Snackbar>
  );
});
