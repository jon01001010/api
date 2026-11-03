/**
 * Phosphor style — green-phosphor CRT terminal look.
 *
 * Visual only. Nothing here changes behaviour; every function is a pure
 * mapping that is the identity unless the Phosphor style is active.
 *
 * Two layers:
 *   1. Theme-level bindings (`phosphorColors`, `phosphorRadius`,
 *      `toPhosphorTypography`) used by the theme builder.
 *   2. Literal-style helpers (`themeColor`, `themeRadius`, `themeFont`,
 *      `themeTextGlow`) for components that hard-code a colour, corner
 *      radius or font family. They return the literal unchanged in the
 *      default style, so the default look is byte-for-byte unchanged.
 *
 * Pure module: no React, no Paper, no MobX imports.
 */
import type {TextStyle} from 'react-native';

import {PHOSPHOR} from './tokens/colors';
import type {
  TokenRadius,
  TokenTypography,
  TypographyStyle,
} from './tokens/types';

export {PHOSPHOR, phosphorColors} from './tokens/colors';

export const PHOSPHOR_FONT = {
  regular: 'JetBrainsMono-Regular',
  medium: 'JetBrainsMono-Medium',
} as const;

/** Square corners everywhere. */
export const phosphorRadius: TokenRadius = {
  none: 0,
  xxs: 0,
  xs: 0,
  s: 0,
  m: 0,
  ml: 0,
  l: 0,
  xl: 0,
  xxl: 0,
};

/** Text glow: `text-shadow: 0 0 2px #3bff65` in the source stylesheet. */
export interface PhosphorGlow {
  textShadowColor: string;
  textShadowOffset: {width: number; height: number};
  textShadowRadius: number;
}

export const PHOSPHOR_GLOW: PhosphorGlow = {
  textShadowColor: PHOSPHOR.glow,
  textShadowOffset: {width: 0, height: 0},
  textShadowRadius: 2,
};

/** Scanline overlay: ~6.5% black line every 4px. */
export const PHOSPHOR_SCANLINE = {
  period: 4,
  lineHeight: 1,
  opacity: 0.065,
} as const;

/**
 * Minimal shape the literal helpers need from a Theme. Any object is
 * accepted (e.g. a plain Paper `MD3Theme`); only `isPhosphor` is read.
 */
export type PhosphorAware = {isPhosphor?: boolean} | object;

const isOn = (theme: PhosphorAware | undefined): boolean =>
  !!theme && (theme as {isPhosphor?: boolean}).isPhosphor === true;

// ---------------------------------------------------------------------------
// Fonts

const MEDIUM_HINTS = /(medium|semibold|bold|extrabold|black|heavy)/i;

/**
 * Map any font family to the Phosphor monospace cut. Heavier cuts map to
 * JetBrains Mono Medium (the only heavier cut bundled); everything else
 * to Regular. `undefined` stays `undefined` so system fallback is kept.
 */
export function toPhosphorFont(
  family: string | undefined,
  weight?: TextStyle['fontWeight'],
): string | undefined {
  if (family === undefined && weight === undefined) {
    return undefined;
  }
  const heavy =
    (family !== undefined && MEDIUM_HINTS.test(family)) ||
    (weight !== undefined &&
      weight !== 'normal' &&
      weight !== '100' &&
      weight !== '200' &&
      weight !== '300' &&
      weight !== '400' &&
      weight !== 100 &&
      weight !== 200 &&
      weight !== 300 &&
      weight !== 400);
  return heavy ? PHOSPHOR_FONT.medium : PHOSPHOR_FONT.regular;
}

/** Phosphor version of one text style: mono family + glow. */
export function toPhosphorTextStyle<T extends TextStyle>(style: T): T {
  const out: T = {
    ...style,
    fontFamily: toPhosphorFont(
      style.fontFamily ?? PHOSPHOR_FONT.regular,
      style.fontWeight,
    ),
    ...PHOSPHOR_GLOW,
  };
  if (style.color !== undefined && typeof style.color === 'string') {
    out.color = toPhosphorColor(style.color);
  }
  return out;
}

/**
 * Phosphor typography: every style becomes JetBrains Mono. Headlines and
 * titles get wide letter spacing (`letter-spacing: 3px` on the source h1).
 */
export function toPhosphorTypography(t: TokenTypography): TokenTypography {
  const map = (s: TypographyStyle, spacing?: number): TypographyStyle => ({
    ...s,
    fontFamily: toPhosphorFont(s.fontFamily, s.fontWeight) as string,
    fontStyle: 'normal',
    ...(spacing !== undefined ? {letterSpacing: spacing} : {}),
  });
  return {
    bodyM: map(t.bodyM),
    bodyS: map(t.bodyS),
    uiM: map(t.uiM),
    uiS: map(t.uiS),
    titleL: map(t.titleL, 2),
    titleM: map(t.titleM, 1.5),
    titleS: map(t.titleS, 1),
    captionM: map(t.captionM),
    captionS: map(t.captionS),
    headlineH1: map(t.headlineH1, 3),
    styledXs: map(t.styledXs),
    codeM: map(t.codeM),
    codeS: map(t.codeS),
  };
}

// ---------------------------------------------------------------------------
// Colors

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, RGBA> = {
  white: {r: 255, g: 255, b: 255, a: 1},
  black: {r: 0, g: 0, b: 0, a: 1},
  red: {r: 255, g: 0, b: 0, a: 1},
  green: {r: 0, g: 128, b: 0, a: 1},
  blue: {r: 0, g: 0, b: 255, a: 1},
  gray: {r: 128, g: 128, b: 128, a: 1},
  grey: {r: 128, g: 128, b: 128, a: 1},
  yellow: {r: 255, g: 255, b: 0, a: 1},
  orange: {r: 255, g: 165, b: 0, a: 1},
  purple: {r: 128, g: 0, b: 128, a: 1},
  pink: {r: 255, g: 192, b: 203, a: 1},
  silver: {r: 192, g: 192, b: 192, a: 1},
  lightgray: {r: 211, g: 211, b: 211, a: 1},
  lightgrey: {r: 211, g: 211, b: 211, a: 1},
  darkgray: {r: 169, g: 169, b: 169, a: 1},
  darkgrey: {r: 169, g: 169, b: 169, a: 1},
};

export function parseColor(input: string): RGBA | null {
  const c = input.trim().toLowerCase();
  if (NAMED[c]) {
    return NAMED[c];
  }
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) {
      h = h
        .split('')
        .map(ch => ch + ch)
        .join('');
    }
    if (h.length !== 6 && h.length !== 8) {
      return null;
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
      c,
    );
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }
  return null;
}

// Green ramp from darkest to brightest, all from the Phosphor palette.
const RAMP: ReadonlyArray<string> = [
  PHOSPHOR.bg,
  PHOSPHOR.inputBg,
  PHOSPHOR.panelBg,
  PHOSPHOR.bannerBg,
  PHOSPHOR.hoverBg,
  PHOSPHOR.edge,
  PHOSPHOR.muted,
  PHOSPHOR.fg,
  PHOSPHOR.emphasis,
];
const PALETTE: ReadonlySet<string> = new Set(
  Object.values(PHOSPHOR).map(c => c.toLowerCase()),
);
// Lightness thresholds (0..1) for each ramp step's upper bound.
const RAMP_STOPS = [0.04, 0.08, 0.12, 0.17, 0.24, 0.38, 0.6, 0.86, 1.01];

function lightness({r, g, b}: RGBA): number {
  // Perceived lightness (Rec. 601 luma) — cheap and good enough to pick
  // a ramp step.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function isWarm({r, g, b}: RGBA): boolean {
  // Strongly red/orange hues keep a warning tint so errors stay visible.
  return r > 150 && r > g * 1.6 && r > b * 1.6;
}

function hexToRgb(hex: string): RGBA {
  return parseColor(hex) as RGBA;
}

function format({r, g, b, a}: RGBA): string {
  if (a >= 1) {
    const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${
    Math.round(a * 1000) / 1000
  })`;
}

/**
 * Map any colour onto the Phosphor green ramp by lightness, keeping its
 * alpha. Dark colours become dark greens, light colours bright greens.
 * Strong reds/oranges map to the Phosphor warning amber. `transparent`
 * and unparseable values are returned unchanged.
 */
export function toPhosphorColor(input: string): string {
  if (input === 'transparent') {
    return input;
  }
  if (PALETTE.has(input.toLowerCase())) {
    // Already a Phosphor colour — keep it (mapping is idempotent).
    return input;
  }
  const rgba = parseColor(input);
  if (rgba === null) {
    return input;
  }
  if (isWarm(rgba)) {
    return format({...hexToRgb(PHOSPHOR.warn), a: rgba.a});
  }
  const l = lightness(rgba);
  const idx = RAMP_STOPS.findIndex(stop => l < stop);
  const step = RAMP[idx === -1 ? RAMP.length - 1 : idx];
  return format({...hexToRgb(step), a: rgba.a});
}

// ---------------------------------------------------------------------------
// Literal-style helpers for components.

/** Colour literal → Phosphor ramp when Phosphor is active, else unchanged. */
export function themeColor<T extends string | undefined>(
  theme: PhosphorAware | undefined,
  color: T,
): T {
  if (!isOn(theme) || color === undefined) {
    return color;
  }
  return toPhosphorColor(color) as T;
}

/** Corner radius literal → 0 when Phosphor is active, else unchanged. */
export function themeRadius<T extends number | undefined>(
  theme: PhosphorAware | undefined,
  value: T,
): T {
  return (isOn(theme) ? 0 : value) as T;
}

/** Font family literal → JetBrains Mono when Phosphor is active. */
export function themeFont<T extends string | undefined>(
  theme: PhosphorAware | undefined,
  family: T,
): T {
  if (!isOn(theme)) {
    return family;
  }
  return (toPhosphorFont(family ?? PHOSPHOR_FONT.regular) ?? family) as T;
}

/** Glow style to spread into a text style; empty in the default style. */
export function themeTextGlow(
  theme: PhosphorAware | undefined,
): Partial<PhosphorGlow> {
  return isOn(theme) ? PHOSPHOR_GLOW : {};
}
