import {
  PHOSPHOR,
  PHOSPHOR_FONT,
  PHOSPHOR_GLOW,
  parseColor,
  phosphorColors,
  themeColor,
  themeFont,
  themeRadius,
  themeTextGlow,
  toPhosphorColor,
  toPhosphorFont,
  toPhosphorTypography,
} from '../phosphor';
import {typography} from '../tokens';
import {buildTheme, darkTheme, lightTheme} from '../../utils/theme';

const ON = {isPhosphor: true};
const OFF = {isPhosphor: false};

describe('phosphor helpers are the identity in the default style', () => {
  it.each([undefined, OFF, {}, lightTheme, darkTheme])(
    'leaves literals untouched (%#)',
    theme => {
      expect(themeColor(theme, '#1E4DF6')).toBe('#1E4DF6');
      expect(themeColor(theme, 'rgba(0, 0, 0, 0.5)')).toBe(
        'rgba(0, 0, 0, 0.5)',
      );
      expect(themeRadius(theme, 12)).toBe(12);
      expect(themeFont(theme, 'Courier')).toBe('Courier');
      expect(themeTextGlow(theme)).toEqual({});
    },
  );
});

describe('phosphor helpers in the Phosphor style', () => {
  it('squares every corner', () => {
    expect(themeRadius(ON, 16)).toBe(0);
  });

  it('switches fonts to JetBrains Mono', () => {
    expect(themeFont(ON, 'Courier')).toBe(PHOSPHOR_FONT.regular);
    expect(themeFont(ON, 'Inter-SemiBold')).toBe(PHOSPHOR_FONT.medium);
    expect(toPhosphorFont('Inter-Regular', 'bold')).toBe(PHOSPHOR_FONT.medium);
    expect(toPhosphorFont(undefined)).toBeUndefined();
  });

  it('adds the text glow', () => {
    expect(themeTextGlow(ON)).toEqual(PHOSPHOR_GLOW);
  });
});

describe('toPhosphorColor', () => {
  const green = new Set(Object.values(PHOSPHOR).map(c => c.toLowerCase()));

  it('maps dark colours to dark greens and light colours to bright greens', () => {
    expect(toPhosphorColor('#050505')).toBe(PHOSPHOR.bg);
    // Pure black is itself a Phosphor colour (log background) — kept.
    expect(toPhosphorColor('#000000')).toBe(PHOSPHOR.logBg);
    expect(toPhosphorColor('#ffffff')).toBe(PHOSPHOR.emphasis);
    expect(toPhosphorColor('white')).toBe(PHOSPHOR.emphasis);
  });

  it('keeps warnings visible as amber', () => {
    expect(toPhosphorColor('#FF653F')).toBe(PHOSPHOR.warn);
  });

  it('keeps alpha', () => {
    expect(toPhosphorColor('rgba(255, 255, 255, 0.2)')).toBe(
      'rgba(179, 255, 193, 0.2)',
    );
    expect(toPhosphorColor('#05050580')).toBe('rgba(1, 6, 2, 0.502)');
  });

  it('is idempotent on palette colours', () => {
    for (const c of Object.values(PHOSPHOR)) {
      expect(toPhosphorColor(c)).toBe(c);
    }
  });

  it('only ever outputs palette colours (opaque inputs)', () => {
    for (const c of ['#1E4DF6', '#F5DBBC', '#333', '#7c8e8a', 'gray']) {
      expect(green.has(toPhosphorColor(c).toLowerCase())).toBe(true);
    }
  });

  it('passes through transparent and unparseable values', () => {
    expect(toPhosphorColor('transparent')).toBe('transparent');
    expect(toPhosphorColor('url(#grad)')).toBe('url(#grad)');
  });

  it('parses short hex and rgb()', () => {
    expect(parseColor('#fff')).toEqual({r: 255, g: 255, b: 255, a: 1});
    expect(parseColor('rgb(1, 2, 3)')).toEqual({r: 1, g: 2, b: 3, a: 1});
  });
});

describe('toPhosphorTypography', () => {
  it('uses mono everywhere and widens headline spacing', () => {
    const t = toPhosphorTypography(typography);
    for (const style of Object.values(t)) {
      expect([PHOSPHOR_FONT.regular, PHOSPHOR_FONT.medium]).toContain(
        style.fontFamily,
      );
      expect(style.fontStyle).toBe('normal');
    }
    expect(t.headlineH1.letterSpacing).toBe(3);
  });
});

describe('buildTheme', () => {
  it('default style is unchanged and not Phosphor', () => {
    expect(buildTheme({mode: 'light', language: 'en'})).toEqual(lightTheme);
    expect(lightTheme.isPhosphor).toBe(false);
    expect(lightTheme.themeStyle).toBe('default');
    expect(darkTheme.isPhosphor).toBe(false);
  });

  it.each(['light', 'dark'] as const)(
    'phosphor style ignores mode %s and is a dark theme',
    mode => {
      const theme = buildTheme({mode, language: 'en', style: 'phosphor'});
      expect(theme.isPhosphor).toBe(true);
      expect(theme.dark).toBe(true);
      expect(theme.roundness).toBe(0);
      expect(theme.colors.background).toBe(PHOSPHOR.bg);
      expect(theme.colors.primary).toBe(PHOSPHOR.fg);
      expect(theme.colors.outline).toBe(PHOSPHOR.edge);
      expect(Object.values(theme.radius).every(r => r === 0)).toBe(true);
      expect(theme.borders).toEqual({
        inputBorderRadius: 0,
        messageBorderRadius: 0,
        default: 0,
      });
      expect(theme.fonts.bodyMedium.fontFamily).toBe(PHOSPHOR_FONT.regular);
      expect(theme.fonts.bodyMedium).toMatchObject(PHOSPHOR_GLOW);
    },
  );

  it('phosphor colour binding covers every token key', () => {
    expect(Object.keys(phosphorColors).sort()).toEqual(
      Object.keys(lightTheme.colors)
        .filter(k => k in phosphorColors)
        .sort(),
    );
    const light = buildTheme({mode: 'light', language: 'en'});
    const ph = buildTheme({mode: 'light', language: 'en', style: 'phosphor'});
    expect(Object.keys(ph.colors).sort()).toEqual(
      Object.keys(light.colors).sort(),
    );
  });
});
