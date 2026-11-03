/**
 * Full-screen CRT scanlines for the Phosphor style.
 *
 * One SVG with a repeating pattern (a faint black line every 4px, as in
 * the Phosphor stylesheet's `repeating-linear-gradient`). It ignores all
 * touches and renders nothing in the default style.
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import Svg, {Defs, Pattern, Rect} from 'react-native-svg';

import {useTheme} from '../../hooks';
import {PHOSPHOR_SCANLINE} from '../../theme/phosphor';

export const ScanlineOverlay: React.FC = () => {
  const theme = useTheme();
  if (!theme.isPhosphor) {
    return null;
  }
  const {period, lineHeight, opacity} = PHOSPHOR_SCANLINE;
  return (
    <View
      pointerEvents="none"
      style={styles.overlay}
      testID="phosphor-scanlines"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern
            id="phosphor-scanline"
            patternUnits="userSpaceOnUse"
            width={period}
            height={period}>
            <Rect
              x={0}
              y={period - lineHeight}
              width={period}
              height={lineHeight}
              fill="#000000"
              fillOpacity={opacity}
            />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#phosphor-scanline)" />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
});
