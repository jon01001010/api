import {StyleSheet} from 'react-native';
import {Theme} from '../../../utils/types';
import {themeColor, themeRadius} from '../../../theme/phosphor';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    pickerContainer: {
      flexDirection: 'row',
      paddingVertical: 8,
      gap: 12,
    },
    colorButtonContainer: {
      width: 28,
      height: 28,
      borderRadius: themeRadius(theme, 100),
      borderWidth: 1,
      borderColor: themeColor(theme, '#222222'),
      padding: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: themeColor(theme, 'white'),
    },
    colorButton: {
      width: 24,
      height: 24,
      borderRadius: themeRadius(theme, 12),
      overflow: 'hidden',
      flexDirection: 'row',
      transform: [{rotate: '45deg'}],
    },
    colorHalf: {
      width: '50%',
      height: '100%',
    },
    rightHalf: {
      borderLeftWidth: 0.5,
      borderLeftColor: themeColor(theme, '#E0E0E0'),
    },
    selectedColorButtonContainer: {
      width: 30,
      height: 30,
      borderColor: theme.colors.onBackground,
      borderWidth: 2.5,
      shadowColor: theme.colors.onBackground,
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.3,
      shadowRadius: 2,
      elevation: 3,
    },
  });
