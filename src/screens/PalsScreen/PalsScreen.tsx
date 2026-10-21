import React, {useState} from 'react';
import {View, FlatList, useWindowDimensions} from 'react-native';
import {Text} from 'react-native-paper';
import {observer} from 'mobx-react-lite';

import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {palStore, Pal} from '../../store';
import {createNewAssistantPal, createNewRoleplayPal, createNewVideoPal, preparePalForEditing} from '../../utils/pal-templates';
import {PalSheet} from '../../components/PalsSheets';
import {AddPalMenu, PalGridRow} from './components';
import {chunkIntoRows, computePalGridLayout} from './palGridLayout';

export const PalsScreen: React.FC = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const {width} = useWindowDimensions();
  const [currentPal, setCurrentPal] = useState<Partial<Pal> | null>(null);
  const [showPalSheet, setShowPalSheet] = useState(false);
  const {columns, cardWidth} = computePalGridLayout(width);
  const localPals = palStore.getLocalPals();
  const rows = chunkIntoRows(localPals, columns);

  const createPal = (type: 'assistant' | 'roleplay' | 'video') => {
    const pal = type === 'video' ? createNewVideoPal()
      : type === 'roleplay' ? createNewRoleplayPal()
      : createNewAssistantPal();
    setCurrentPal(pal);
    setShowPalSheet(true);
  };

  const editPal = (pal: Pal) => {
    setCurrentPal(preparePalForEditing(pal));
    setShowPalSheet(true);
  };

  return (
    <View style={styles.container}>
      <View style={{paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8}}>
        <Text variant="titleMedium">Local assistants</Text>
        <Text variant="bodySmall">Create and edit assistants on this device. No account or premium library required.</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={row => row.key}
        renderItem={({item}) => (
          <PalGridRow row={item} cardWidth={cardWidth} onPalPress={pal => editPal(pal as Pal)} />
        )}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No local assistants yet. Create one with the + button.</Text>
          </View>
        }
        testID="pals-flat-list"
      />
      <View style={{alignItems: 'center', padding: 12}}>
        <AddPalMenu iconColor={theme.colors.onSurfaceVariant} iconSize={28} onCreatePal={createPal} />
      </View>
      {showPalSheet && currentPal && (
        <PalSheet
          isVisible={showPalSheet}
          onClose={() => {setShowPalSheet(false); setCurrentPal(null);}}
          pal={currentPal}
        />
      )}
    </View>
  );
});

export default PalsScreen;
