import React from 'react';
import {StyleSheet} from 'react-native';

import {render} from '../../../../jest/test-utils';
import {useTheme} from '../../../hooks/useTheme';
import {buildTheme} from '../../../utils/theme';
import {PHOSPHOR, buildPhosphorPalette} from '../../../theme/phosphor';
import {PocketAgentLogo} from '../PocketAgentLogo';

const setTheme = (
  style: 'default' | 'phosphor',
  tint?: [number, number, number],
) =>
  (useTheme as jest.Mock).mockReturnValue(
    buildTheme({mode: 'light', language: 'en', style, tint}),
  );

const glowColor = (getByTestId: (id: string) => any) =>
  StyleSheet.flatten(getByTestId('pocketagent-logo-glow').props.style)
    .tintColor;

describe('PocketAgentLogo', () => {
  afterEach(() => setTheme('default'));

  it('shows the original picture in the default style', () => {
    setTheme('default');
    const {queryByTestId, UNSAFE_getAllByType} = render(
      <PocketAgentLogo source={{uri: 'pocketagent_logo'}} />,
    );
    expect(queryByTestId('pocketagent-logo-phosphor')).toBeNull();
    const {Image} = require('react-native');
    expect(UNSAFE_getAllByType(Image)[0].props.source).toEqual({
      uri: 'pocketagent_logo',
    });
  });

  it('colours the glow layer with the Phosphor colour', () => {
    setTheme('phosphor');
    const {getByTestId} = render(
      <PocketAgentLogo source={{uri: 'pocketagent_logo'}} />,
    );
    expect(getByTestId('pocketagent-logo-base')).toBeTruthy();
    expect(glowColor(getByTestId)).toBe(PHOSPHOR.fg);
  });

  it('follows the R/G/B sliders', () => {
    setTheme('phosphor', [0, 0, 255]);
    const {getByTestId} = render(
      <PocketAgentLogo source={{uri: 'pocketagent_logo'}} />,
    );
    expect(glowColor(getByTestId)).toBe(buildPhosphorPalette([0, 0, 255]).fg);
  });

  it('keeps both layers inside the logo box (explicit size, clipped)', () => {
    setTheme('phosphor');
    const {getByTestId} = render(
      <PocketAgentLogo
        source={{uri: 'pocketagent_logo'}}
        style={{width: 112, height: 112}}
      />,
    );
    const frame = StyleSheet.flatten(
      getByTestId('pocketagent-logo-phosphor').props.style,
    );
    expect(frame).toMatchObject({width: 112, height: 112, overflow: 'hidden'});
    for (const id of ['pocketagent-logo-base', 'pocketagent-logo-glow']) {
      expect(StyleSheet.flatten(getByTestId(id).props.style)).toMatchObject({
        position: 'absolute',
        width: '100%',
        height: '100%',
      });
    }
  });
});
