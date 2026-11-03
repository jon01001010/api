import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';
import {themeFont, themeRadius, themeTextGlow} from '../../theme/phosphor';

// Plain object (not via StyleSheet.create) because react-syntax-highlighter's
// customStyle is merged with Object.assign — a numeric StyleSheet id won't
// flatten the upstream white PreTag fallback. See MarkdownView for the why.
export const codeHighlighterPreOverride = {
  backgroundColor: 'transparent',
} as const;

export const createTagsStyles = (theme: Theme) => ({
  body: {
    color: theme.colors.text,
    fontSize: 16,
    fontFamily: themeFont(
      theme,
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    ),
    ...themeTextGlow(theme),
    padding: 0,
    paddingTop: 0,
    margin: 0,
    backgroundColor: 'transparent',
    // display: 'inline-block',
  },
  a: {
    color: theme.colors.secondary,
    textDecorationLine: 'underline' as const,
  },
  code: {
    fontFamily: themeFont(theme, 'Courier'), // Change the font for code snippets
    ...themeTextGlow(theme),
    backgroundColor: theme.colors.surface, // Custom background for code blocks
    padding: 4,
    borderRadius: themeRadius(theme, 4),
    color: theme.colors.onSurface, // Color for code text
    fontSize: 12,
    whiteSpace: 'pre' as const,
  },
  pre: {
    backgroundColor: theme.colors.surface, // Background for pre blocks
    padding: 8,
    borderRadius: themeRadius(theme, 6),
    marginVertical: 8,
    color: theme.colors.onPrimaryContainer,
    fontFamily: themeFont(theme, 'Courier'),
    fontSize: 14,
    whiteSpace: 'pre' as const,
  },
  // Styles for thinking tags
  thinking: {
    color: theme.colors.thinkingBubbleText,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: themeFont(
      theme,
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    ),
    ...themeTextGlow(theme),
  },
  think: {
    color: theme.colors.thinkingBubbleText,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: themeFont(
      theme,
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    ),
    ...themeTextGlow(theme),
  },
  thought: {
    color: theme.colors.thinkingBubbleText,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: themeFont(
      theme,
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    ),
    ...themeTextGlow(theme),
  },
});

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    markdownContainer: {
      // Dynamic maxWidth will be applied via style prop
    },
    codeHighlighterText: {
      fontFamily: themeFont(theme, 'Courier'),
    },
    codeHighlighterScrollContent: {
      backgroundColor: theme.colors.surface,
      padding: 8,
      borderRadius: themeRadius(theme, 6),
      marginTop: 4,
    },
  });
