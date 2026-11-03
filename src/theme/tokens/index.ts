/**
 * Design tokens entry point (Phase 1).
 *
 * Pure data + types. No React, no Paper, no MobX imports here. The only
 * runtime dependency is `colorUtils` (pure utility — not React/Paper/MobX).
 *
 * Mode is selected by binding (light vs dark), not by mutation. Locale
 * fallback (Fraunces → Inter for non-Latin scripts) lives in the theme
 * builder (`useTheme()`) so components remain locale-agnostic.
 */
import {lightColors, darkColors, phosphorColors} from './colors';
import {radius} from './radius';
import {spacing} from './spacing';
import {stroke} from './stroke';
import {typography} from './typography';

import type {Mode, ThemeStyle, Tokens} from './types';

export const lightTokens: Tokens = {
  colors: lightColors,
  typography,
  spacing,
  radius,
  stroke,
};

export const darkTokens: Tokens = {
  colors: darkColors,
  typography,
  spacing,
  radius,
  stroke,
};

/**
 * Phosphor tokens — green CRT terminal look (visual only). Square corners;
 * typography is swapped to monospace in the theme builder so locale
 * handling stays in one place.
 */
export const phosphorTokens: Tokens = {
  colors: phosphorColors,
  typography,
  spacing,
  radius: {
    none: 0,
    xxs: 0,
    xs: 0,
    s: 0,
    m: 0,
    ml: 0,
    l: 0,
    xl: 0,
    xxl: 0,
  },
  stroke,
};

/**
 * Returns the resolved Tokens for a given mode (and optional style). The
 * returned object is a stable per-module reference — do not mutate.
 * The Phosphor style ignores `mode`: it is always a dark binding.
 */
export function resolveTokens(
  mode: Mode,
  style: ThemeStyle = 'default',
): Tokens {
  if (style === 'phosphor') {
    return phosphorTokens;
  }
  return mode === 'dark' ? darkTokens : lightTokens;
}

export type {
  Mode,
  ThemeStyle,
  Tokens,
  TokenColors,
  TokenTypography,
  TokenSpacing,
  TokenRadius,
  TokenStroke,
  TypographyStyle,
} from './types';

export {
  FONT_FAMILIES,
  NON_LATIN_LOCALES,
  typography,
  typographyForLocale,
  resolveTypographyForLocale,
} from './typography';

export {lightColors, darkColors, phosphorColors, PHOSPHOR} from './colors';
export {spacing} from './spacing';
export {radius} from './radius';
export {stroke} from './stroke';
