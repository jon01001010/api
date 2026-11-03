import {
  DEFAULT_PHOSPHOR_TINT,
  MIN_MUTED_CONTRAST,
  MIN_TEXT_CONTRAST,
  PHOSPHOR,
  buildPhosphorPalette,
  contrastRatio,
  normalizeTint,
  themeColor,
  type RGB,
} from '../phosphor';
import {buildTheme} from '../../utils/theme';

const TINTS: RGB[] = [
  [0, 0, 255],
  [255, 0, 0],
  [255, 0, 255],
  [128, 0, 255],
  [255, 180, 0],
  [0, 255, 255],
  [128, 128, 128],
  [20, 20, 60],
  [0, 0, 0],
  [255, 255, 255],
  [1, 2, 3],
  [134, 255, 155],
];

describe('buildPhosphorPalette', () => {
  it('returns the original palette for the default tint', () => {
    expect(buildPhosphorPalette(DEFAULT_PHOSPHOR_TINT)).toBe(PHOSPHOR);
  });

  it.each(TINTS)('keeps text readable for tint %s,%s,%s', (r, g, b) => {
    const p = buildPhosphorPalette([r, g, b]);
    for (const surface of [p.bg, p.panelBg, p.inputBg]) {
      expect(contrastRatio(p.fg, surface)).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST - 0.05,
      );
      expect(contrastRatio(p.emphasis, surface)).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST - 0.05,
      );
      expect(contrastRatio(p.muted, surface)).toBeGreaterThanOrEqual(
        MIN_MUTED_CONTRAST - 0.05,
      );
    }
    // Background stays dark.
    expect(contrastRatio(p.bg, '#000000')).toBeLessThan(1.2);
  });

  it('follows the chosen hue', () => {
    const blue = buildPhosphorPalette([0, 0, 255]).fg;
    const red = buildPhosphorPalette([255, 0, 0]).fg;
    const [br, , bb] = [1, 3, 5].map(i => parseInt(blue.slice(i, i + 2), 16));
    const [rr, , rb] = [1, 3, 5].map(i => parseInt(red.slice(i, i + 2), 16));
    expect(bb).toBeGreaterThan(br);
    expect(rr).toBeGreaterThan(rb);
  });

  it('greys give a neutral terminal', () => {
    const p = buildPhosphorPalette([128, 128, 128]);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(p.fg.slice(i, i + 2), 16));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
  });

  it('switches errors away from amber when the tint is amber', () => {
    expect(buildPhosphorPalette([0, 0, 255]).warn).toBe(PHOSPHOR.warn);
    expect(buildPhosphorPalette([255, 180, 0]).warn).not.toBe(PHOSPHOR.warn);
  });
});

describe('normalizeTint', () => {
  it('clamps and rounds, falling back to the default', () => {
    expect(normalizeTint([300, -5, 12.6])).toEqual([255, 0, 13]);
    expect(normalizeTint(undefined)).toEqual(DEFAULT_PHOSPHOR_TINT);
    expect(normalizeTint([1, 2])).toEqual(DEFAULT_PHOSPHOR_TINT);
    expect(normalizeTint(['7', null, 'x'])).toEqual([7, 0, 0]);
  });
});

describe('tinted theme', () => {
  it('colours the whole theme from the tint', () => {
    const theme = buildTheme({
      mode: 'light',
      language: 'en',
      style: 'phosphor',
      tint: [0, 0, 255],
    });
    const p = buildPhosphorPalette([0, 0, 255]);
    expect(theme.phosphorPalette).toEqual(p);
    expect(theme.colors.primary).toBe(p.fg);
    expect(theme.colors.background).toBe(p.bg);
    expect(
      (theme.fonts.bodyMedium as {textShadowColor?: string}).textShadowColor,
    ).toBe(p.glow);
    // Literal colours map onto the tinted ramp.
    expect(themeColor(theme, '#ffffff')).toBe(p.emphasis);
  });

  it('ignores the tint outside Phosphor', () => {
    const plain = buildTheme({mode: 'dark', language: 'en'});
    const tinted = buildTheme({
      mode: 'dark',
      language: 'en',
      tint: [0, 0, 255],
    });
    expect(tinted).toEqual(plain);
  });
});
