/**
 * Blinking block cursor for the Phosphor style (`.cursor` in the Phosphor
 * stylesheet: 9×17 block, `steps(1)` blink once per second). Renders
 * nothing in the default style.
 */
import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, View} from 'react-native';

import {useTheme} from '../../hooks';

export const PhosphorCursor: React.FC<{
  /** Render just the block, without the chat-row padding. */
  inline?: boolean;
}> = ({inline = false}) => {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!theme.isPhosphor) {
      return;
    }
    // Hard on/off blink (no fade), like CSS `steps(1)`.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 0,
          useNativeDriver: true,
        }),
        Animated.delay(500),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, theme.isPhosphor]);

  if (!theme.isPhosphor) {
    return null;
  }
  const block = (
    <Animated.View
      testID={inline ? 'phosphor-cursor' : undefined}
      style={[
        inline ? styles.inlineBlock : styles.block,
        {
          backgroundColor: theme.colors.primary,
          shadowColor: theme.colors.shadow,
          opacity,
        },
      ]}
    />
  );
  if (inline) {
    return block;
  }
  return (
    <View style={styles.row} testID="phosphor-cursor">
      {block}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 16,
  },
  block: {
    width: 9,
    height: 17,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 0},
  },
  inlineBlock: {
    width: 7,
    height: 13,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 0},
  },
});
