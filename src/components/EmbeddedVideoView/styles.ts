import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';
import {themeColor, themeRadius} from '../../theme/phosphor';

export const createStyles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: themeColor(theme, '#000'),
      overflow: 'hidden',
      zIndex: 1,
    },
    camera: {
      flex: 1,
    },
    controlsContainer: {
      position: 'absolute',
      bottom: '5%', // Lower position, below the interval controls
      alignSelf: 'center', // Center horizontally
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 20, // Space between close and flip buttons
    },
    closeButton: {
      width: 40,
      height: 40,
      borderRadius: themeRadius(theme, 20),
      backgroundColor: themeColor(theme, 'rgba(0, 0, 0, 0.5)'),
      borderWidth: 1,
      borderColor: themeColor(theme, 'rgba(255, 255, 255, 0.2)'),
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeButtonIcon: {
      color: themeColor(theme, '#fff'),
      fontSize: 20,
    },
    flipButton: {
      width: 40,
      height: 40,
      borderRadius: themeRadius(theme, 20),
      backgroundColor: themeColor(theme, 'rgba(0, 0, 0, 0.5)'),
      borderWidth: 1,
      borderColor: themeColor(theme, 'rgba(255, 255, 255, 0.2)'),
      justifyContent: 'center',
      alignItems: 'center',
    },
    flipButtonIcon: {
      color: themeColor(theme, '#fff'),
      fontSize: 20,
    },
    permissionContainer: {
      height: 250,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
      borderRadius: themeRadius(theme, 12),
      marginHorizontal: 16,
      marginVertical: 8,
      zIndex: 1,
    },
    permissionText: {
      color: theme.colors.onBackground,
      fontSize: 16,
      marginBottom: 20,
      textAlign: 'center',
      paddingHorizontal: 20,
    },
    intervalControlsContainer: {
      position: 'absolute',
      bottom: '11%', // Position above the camera controls
      alignSelf: 'center', // Center horizontally
      width: '50%', // Take up 50% of screen width
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: themeColor(theme, 'rgba(0, 0, 0, 0.5)'),
      borderRadius: themeRadius(theme, 25), // Make it oval-shaped
      borderWidth: 1,
      borderColor: themeColor(theme, 'rgba(255, 255, 255, 0.2)'),
    },
    intervalLabel: {
      color: themeColor(theme, '#fff'),
      fontSize: 11,
      marginRight: 4,
      fontWeight: '500',
      textShadowColor: themeColor(theme, 'rgba(0, 0, 0, 0.5)'),
      textShadowOffset: {width: 0, height: 1},
      textShadowRadius: 1,
    },
    intervalValue: {
      color: themeColor(theme, '#fff'),
      fontSize: 12,
      marginHorizontal: 8,
      minWidth: 40,
      textAlign: 'center',
      fontWeight: '600',
      textShadowColor: themeColor(theme, 'rgba(0, 0, 0, 0.5)'),
      textShadowOffset: {width: 0, height: 1},
      textShadowRadius: 1,
    },
    intervalButton: {
      width: 26,
      height: 26,
      borderRadius: themeRadius(theme, 13),
      backgroundColor: themeColor(theme, 'rgba(0, 0, 0, 0.5)'),
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: themeColor(theme, 'rgba(255, 255, 255, 0.2)'),
    },
    intervalButtonText: {
      color: themeColor(theme, '#fff'),
      fontSize: 14,
      fontWeight: 'bold',
    },
    responseOverlayContainer: {
      position: 'absolute',
      bottom: 180,
      left: 16,
      right: 16,
      maxHeight: '40%',
    },
    responseText: {
      color: themeColor(theme, '#fff'),
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '400',
    },
  });
