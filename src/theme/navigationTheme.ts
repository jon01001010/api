/**
 * React Navigation theme derived from the app theme.
 *
 * Screens that don't paint their own background (e.g. Toolbox, PocketAgent
 * Hardware) show the navigator's background. Its built-in default is light
 * grey, which made those screens unreadable in Dark Mode and Phosphor.
 *
 * - Light (default style): returns `undefined` so the navigator keeps its
 *   built-in theme — Light Mode looks exactly as before.
 * - Dark and Phosphor: the navigator uses the app's own colours.
 */
import {
  DarkTheme,
  type Theme as NavigationTheme,
} from '@react-navigation/native';

import type {Theme} from '../utils/types';
import {PHOSPHOR_FONT} from './phosphor';

export function buildNavigationTheme(
  theme: Theme,
): NavigationTheme | undefined {
  if (!theme.dark && !theme.isPhosphor) {
    return undefined;
  }
  const fonts = theme.isPhosphor
    ? {
        regular: {
          fontFamily: PHOSPHOR_FONT.regular,
          fontWeight: '400' as const,
        },
        medium: {fontFamily: PHOSPHOR_FONT.medium, fontWeight: '500' as const},
        bold: {fontFamily: PHOSPHOR_FONT.medium, fontWeight: '600' as const},
        heavy: {fontFamily: PHOSPHOR_FONT.medium, fontWeight: '700' as const},
      }
    : DarkTheme.fonts;
  return {
    ...DarkTheme,
    dark: true,
    colors: {
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.onSurface,
      border: theme.colors.outline,
      notification: theme.colors.error,
    },
    fonts,
  };
}
