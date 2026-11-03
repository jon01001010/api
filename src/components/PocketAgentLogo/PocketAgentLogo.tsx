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
    <View style={[style, styles.frame]} testID="pocketagent-logo-phosphor">
      <Image
        source={BASE}
        style={styles.layer}
        resizeMode="contain"
        testID="pocketagent-logo-base"
      />
      <Image
        source={GLOW}
        style={[styles.layer, {tintColor: glowColor}]}
        resizeMode="contain"
        testID="pocketagent-logo-glow"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // Clip to the logo's box: on Android an image positioned only by insets
  // can otherwise draw at its own pixel size and spill over the screen.
  frame: {overflow: 'hidden'},
  // Explicit size so both layers fit the box exactly, one on top of the other.
  layer: {position: 'absolute', top: 0, left: 0, width: '100%', height: '100%'},
});
