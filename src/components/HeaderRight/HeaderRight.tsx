import React from 'react';
import {View} from 'react-native';

import {observer} from 'mobx-react';
import {IconButton, useTheme} from 'react-native-paper';

import {EditBoxIcon} from '../../assets/icons';

import {styles} from './styles';

import {chatSessionStore, uiStore} from '../../store';

import {UsageStats} from '..';

/**
 * Chat header actions: just "new chat". The old ⋮ menu moved: generation
 * settings and export/import are in Settings → Chat, switching models is the
 * picker in the input bar, and duplicate / rename / delete are on each chat
 * in the side menu.
 */
export const HeaderRight: React.FC = observer(() => {
  const theme = useTheme();

  return (
    <View style={styles.headerRightContainer}>
      {uiStore.displayMemUsage && <UsageStats width={40} height={20} />}
      <IconButton
        icon={() => <EditBoxIcon stroke={theme.colors.primary} />}
        testID="reset-button"
        style={styles.chatBtn}
        onPress={() => {
          chatSessionStore.resetActiveSession();
        }}
      />
    </View>
  );
});
