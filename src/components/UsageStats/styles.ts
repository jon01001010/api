import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';
import {themeRadius} from '../../theme/phosphor';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      position: 'relative',
    },
    tooltip: {
      position: 'absolute',
      padding: 8,
      borderRadius: themeRadius(theme, 4),
      backgroundColor: theme.colors.surface,
      elevation: 4,
      width: 120,
    },
    tooltipTitle: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    tooltipText: {
      color: theme.colors.onSurface,
      fontSize: 10,
      marginBottom: 2,
    },
  });
