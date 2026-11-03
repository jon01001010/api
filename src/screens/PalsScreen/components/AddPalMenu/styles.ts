import {StyleSheet} from 'react-native';
import {Theme} from '../../../../utils/types';
import {themeRadius} from '../../../../theme/phosphor';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    addButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderRadius: themeRadius(theme, 12),
    },
    iconContainer: {
      marginBottom: 4,
      padding: 4,
    },
    actionLabel: {
      fontSize: 11,
      fontWeight: '500',
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
    },
  });
