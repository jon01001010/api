import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';
import {themeRadius} from '../../theme/phosphor';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {},
    row: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: themeRadius(theme, 16),
      backgroundColor: theme.colors.surface,
    },
    text: {
      fontSize: 14,
      color: theme.colors.onSurfaceVariant,
    },
  });
