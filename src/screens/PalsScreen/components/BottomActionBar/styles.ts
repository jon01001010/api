import {StyleSheet} from 'react-native';
import {Theme} from '../../../../utils/types';
import {EdgeInsets} from 'react-native-safe-area-context';
import {themeRadius} from '../../../../theme/phosphor';

export const createStyles = (theme: Theme, insets: EdgeInsets) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.outline,
    },
    actionBar: {
      flexDirection: 'row',
      paddingHorizontal: 8,
      paddingVertical: 8,
      paddingBottom: Math.max(insets.bottom, 12),
      justifyContent: 'space-around',
      alignItems: 'center',
      minHeight: 70,
    },
    actionButton: {
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
