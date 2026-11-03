import {StyleSheet} from 'react-native';

import {Theme} from '../../../../utils/types';
import {themeFont, themeRadius} from '../../../../theme/phosphor';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollView: {
      flex: 1,
    },
    card: {
      margin: 16,
      backgroundColor: theme.colors.surface,
    },
    title: {
      marginBottom: 16,
      textAlign: 'center',
    },
    modelSelectorContent: {
      width: '100%',
      justifyContent: 'flex-start',
      marginBottom: 16,
    },
    loadingContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    loadingText: {
      marginTop: 10,
      color: theme.colors.onSurfaceVariant,
    },
    warning: {
      color: theme.colors.error,
      textAlign: 'center',
      marginVertical: 20,
    },
    optionsHeader: {
      fontWeight: 'bold',
      marginTop: 16,
      marginBottom: 8,
    },
    radioItem: {
      paddingVertical: 0,
    },
    radioLabel: {
      textAlign: 'left',
    },
    testDescription: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 13,
      marginBottom: 12,
    },
    optionsCard: {
      marginVertical: 12,
      padding: 12,
      backgroundColor: theme.colors.surfaceVariant,
      borderRadius: themeRadius(theme, 8),
    },
    optionBlock: {
      marginBottom: 12,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    nPredictInput: {
      width: 100,
      height: 40,
    },
    runButton: {
      marginTop: 8,
    },
    resultsContainer: {
      marginTop: 16,
    },
    resultCard: {
      marginBottom: 16,
    },
    resultText: {
      fontFamily: themeFont(theme, 'monospace'),
      fontSize: 14,
      lineHeight: 20,
    },
    streamingText: {
      fontFamily: themeFont(theme, 'monospace'),
      fontSize: 14,
      lineHeight: 20,
      marginTop: 10,
    },
    errorText: {
      color: theme.colors.error,
      fontFamily: themeFont(theme, 'monospace'),
      fontSize: 14,
    },
    divider: {
      marginVertical: 12,
    },
    sectionTitle: {
      fontWeight: 'bold',
      marginBottom: 8,
    },
    codeBlock: {
      fontFamily: themeFont(theme, 'monospace'),
      fontSize: 12,
      backgroundColor: theme.colors.surfaceVariant,
      padding: 8,
      borderRadius: themeRadius(theme, 4),
    },
    testOptionsContainer: {
      marginVertical: 12,
      padding: 8,
      backgroundColor: theme.colors.surfaceVariant,
      borderRadius: themeRadius(theme, 8),
    },
    optionLabel: {
      marginBottom: 8,
      fontWeight: 'bold',
    },
    jinjaOption: {
      marginTop: 12,
    },
  });
