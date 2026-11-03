import {buildNavigationTheme} from '../navigationTheme';
import {PHOSPHOR} from '../phosphor';
import {buildTheme, darkTheme, lightTheme} from '../../utils/theme';

describe('buildNavigationTheme', () => {
  it('leaves Light Mode on the navigator default', () => {
    expect(buildNavigationTheme(lightTheme)).toBeUndefined();
  });

  it('uses the app background in Dark Mode (no light-grey screens)', () => {
    const nav = buildNavigationTheme(darkTheme)!;
    expect(nav.dark).toBe(true);
    expect(nav.colors.background).toBe(darkTheme.colors.background);
    expect(nav.colors.text).toBe(darkTheme.colors.onSurface);
  });

  it('uses the Phosphor palette and mono font in Phosphor', () => {
    const theme = buildTheme({
      mode: 'light',
      language: 'en',
      style: 'phosphor',
    });
    const nav = buildNavigationTheme(theme)!;
    expect(nav.colors.background).toBe(PHOSPHOR.bg);
    expect(nav.colors.text).toBe(PHOSPHOR.fg);
    expect(nav.fonts.regular.fontFamily).toBe('JetBrainsMono-Regular');
  });
});
