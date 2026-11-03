import React from 'react';
import {StyleSheet} from 'react-native';

import {render} from '../../../../jest/test-utils';
import {useTheme} from '../../../hooks/useTheme';
import {buildTheme} from '../../../utils/theme';
import {PHOSPHOR, PHOSPHOR_FONT, PHOSPHOR_GLOW} from '../../../theme/phosphor';
import {ScanlineOverlay} from '../../ScanlineOverlay';
import {PhosphorCursor} from '../../PhosphorCursor';
import {Text} from '../ThemedText';

// useTheme is mocked globally (jest/setup.ts); point it at the theme the
// given style would build.
const setStyle = (style: 'default' | 'phosphor') => {
  (useTheme as jest.Mock).mockReturnValue(
    buildTheme({mode: 'light', language: 'en', style}),
  );
};

describe('Phosphor visual layer', () => {
  afterEach(() => setStyle('default'));

  it('Text is unchanged in the default style', () => {
    setStyle('default');
    const style = {color: '#1E4DF6', fontSize: 13};
    const {getByText} = render(<Text style={style}>hello</Text>);
    expect(StyleSheet.flatten(getByText('hello').props.style)).toEqual(style);
  });

  it('Text gets mono, glow and green in the Phosphor style', () => {
    setStyle('phosphor');
    const {getByText} = render(
      <Text style={{color: '#ffffff', fontSize: 13}}>hello</Text>,
    );
    const flat = StyleSheet.flatten(getByText('hello').props.style);
    expect(flat).toMatchObject({
      fontSize: 13,
      fontFamily: PHOSPHOR_FONT.regular,
      color: PHOSPHOR.emphasis,
      ...PHOSPHOR_GLOW,
    });
  });

  it('scanlines and cursor render only in the Phosphor style', () => {
    setStyle('default');
    const off = render(
      <>
        <ScanlineOverlay />
        <PhosphorCursor />
      </>,
    );
    expect(
      off.queryByTestId('phosphor-scanlines', {includeHiddenElements: true}),
    ).toBeNull();
    expect(off.queryByTestId('phosphor-cursor')).toBeNull();
    off.unmount();

    setStyle('phosphor');
    const on = render(
      <>
        <ScanlineOverlay />
        <PhosphorCursor />
      </>,
    );
    expect(
      on.getByTestId('phosphor-scanlines', {includeHiddenElements: true}).props
        .pointerEvents,
    ).toBe('none');
    expect(on.getByTestId('phosphor-cursor')).toBeTruthy();
  });
});
