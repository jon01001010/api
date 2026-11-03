/**
 * The PocketAgent logo.
 *
 * Default style: the original picture, exactly as before.
 * Phosphor style: the same robot, with its blue glow (frame, eyes, accents,
 * "Agent") recoloured in the current Phosphor colour, so it follows the
 * R/G/B sliders live. Built from two pre-split layers:
 *   - base: the logo with its blue glow removed
 *   - glow: only the glow, as a white brightness mask, coloured with
 *     `tintColor` (keeps the glow's soft edges, costs nothing per frame)
 */
import React from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
  StyleSheet,
  View,
} from 'react-native';

import {useTheme} from '../../hooks';
import {PHOSPHOR} from '../../theme/phosphor';

const BASE = require('../../assets/pocketagent-logo-base.png');
const GLOW = require('../../assets/pocketagent-logo-glow.png');

interface PocketAgentLogoProps {
  /** Picture used in the default (non-Phosphor) style. */
  source: ImageSourcePropType;
  style?: StyleProp<ImageStyle>;
}

export const PocketAgentLogo: React.FC<PocketAgentLogoProps> = ({
  source,
  style,
}) => {
  const theme = useTheme();
  if (!theme.isPhosphor) {
    return <Image source={source} style={style} resizeMode="contain" />;
  }
  const glowColor = (theme.phosphorPalette ?? PHOSPHOR).fg;
  return (
    <View style={style} testID="pocketagent-logo-phosphor">
      <Image
        source={BASE}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        testID="pocketagent-logo-base"
      />
      <Image
        source={GLOW}
        style={[StyleSheet.absoluteFill, {tintColor: glowColor}]}
        resizeMode="contain"
        testID="pocketagent-logo-glow"
      />
    </View>
  );
};
