import {StyleSheet} from 'react-native';

import type {Theme} from '../../utils/types';
import {themeRadius} from '../../theme/phosphor';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    checkbox: {
      borderWidth: 2,
      borderRadius: themeRadius(theme, 4),
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkedBox: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    uncheckedBox: {
      borderColor: theme.colors.outline,
      backgroundColor: 'transparent',
    },
  });
