import React, {useContext, useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import {Button} from 'react-native-paper';

import {L10nContext} from '../../utils';

interface AddModelBarProps {
  onAddHFModel: () => void;
  onAddLocalModel: () => void;
  onAddRemoteModel: () => void;
  onManageServers?: () => void;
  hasServers?: boolean;
}

const HFIcon = () => (
  <Image source={require('../../assets/icon-hf.png')} style={styles.hfIcon} />
);

/**
 * "+ Add model" at the top of the Models list (it replaces the floating +).
 * Tap to show the same choices in place; picking one closes it. The option
 * testIDs are the old FAB ones, so existing flows keep working.
 */
export const AddModelBar: React.FC<AddModelBarProps> = ({
  onAddHFModel,
  onAddLocalModel,
  onAddRemoteModel,
  onManageServers,
  hasServers,
}) => {
  const l10n = useContext(L10nContext);
  const [open, setOpen] = useState(false);
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <View style={styles.container} testID="add-model-bar">
      <Button
        mode="contained"
        icon={open ? 'close' : 'plus'}
        testID="models-add-button"
        onPress={() => setOpen(o => !o)}>
        {open ? l10n.common.cancel : 'Add model'}
      </Button>
      {open && (
        <View style={styles.options}>
          <Button
            mode="outlined"
            icon={HFIcon}
            testID="hf-fab"
            onPress={pick(onAddHFModel)}>
            {l10n.models.buttons.addFromHuggingFace}
          </Button>
          <Button
            mode="outlined"
            icon="folder-plus"
            testID="local-fab"
            onPress={pick(onAddLocalModel)}>
            {l10n.models.buttons.addLocalModel}
          </Button>
          <Button
            mode="outlined"
            icon="cloud-plus-outline"
            testID="remote-fab"
            onPress={pick(onAddRemoteModel)}>
            {l10n.settings.addRemoteModel}
          </Button>
          {hasServers && onManageServers && (
            <Button
              mode="outlined"
              icon="server-network"
              testID="manage-servers-fab"
              onPress={pick(onManageServers)}>
              {l10n.settings.manageServers}
            </Button>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {marginBottom: 12, gap: 8},
  options: {gap: 8},
  hfIcon: {width: 20, height: 20},
});
