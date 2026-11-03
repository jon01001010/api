import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';
import {themeRadius} from '../../theme/phosphor';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: themeRadius(theme, 10),
      borderTopStartRadius: themeRadius(theme, 10),
      borderTopEndRadius: themeRadius(theme, 10),
      alignSelf: 'stretch',
      backgroundColor: 'transparent',
    },
    input: {
      backgroundColor: 'transparent',
    },
    placeholder: {
      opacity: 0.3,
    },
    divider: {
      width: 330,
      height: 0.33,
      backgroundColor: theme.colors.outlineVariant,
      marginLeft: 20,
    },
  });
