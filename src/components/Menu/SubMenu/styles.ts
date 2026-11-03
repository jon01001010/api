import {StyleSheet} from 'react-native';

import {Theme} from '../../../utils/types';
import {themeRadius} from '../../../theme/phosphor';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    menu: {
      maxWidth: '90%',
      marginTop: 0,
      marginLeft: 0,
    },
    content: {
      paddingVertical: 0,
      backgroundColor: theme.colors.menuBackground,
      borderRadius: themeRadius(theme, 12),
      //overflow: 'hidden', This removes shadow
    },
  });
