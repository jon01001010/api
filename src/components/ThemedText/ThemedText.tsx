/**
 * Drop-in replacements for React Native's `Text` and `TextInput`.
 *
 * Default style: renders the React Native component with the exact same
 * props — no visual or behavioural change.
 *
 * Phosphor style: layers the green CRT look on top of whatever the caller
 * passed — JetBrains Mono, text glow, and the caller's colours mapped onto
 * the Phosphor green ramp. Layout, props and behaviour are untouched.
 */
import React from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

import {useTheme} from '../../hooks';
import {
  PHOSPHOR_GLOW,
  toPhosphorColor,
  toPhosphorFont,
} from '../../theme/phosphor';

const phosphorTextOverride = (style: TextProps['style']): TextStyle => {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const override: TextStyle = {
    fontFamily: toPhosphorFont(
      flat.fontFamily ?? 'JetBrainsMono-Regular',
      flat.fontWeight,
    ),
    fontStyle: 'normal',
    ...PHOSPHOR_GLOW,
  };
  // Only remap an explicit colour; leave unset colours to inherit from a
  // parent Text as before.
  if (typeof flat.color === 'string') {
    override.color = toPhosphorColor(flat.color);
  }
  return override;
};

type TextComponentProps = TextProps & {ref?: React.Ref<RNText>};

export const Text = (props: TextComponentProps) => {
  const theme = useTheme();
  if (!theme.isPhosphor) {
    return <RNText {...props} />;
  }
  return (
    <RNText
      {...props}
      style={[props.style, phosphorTextOverride(props.style)]}
    />
  );
};

type TextInputComponentProps = TextInputProps & {
  ref?: React.Ref<RNTextInput>;
};

export const TextInput = (props: TextInputComponentProps) => {
  const theme = useTheme();
  if (!theme.isPhosphor) {
    return <RNTextInput {...props} />;
  }
  const map = (c: TextInputProps['placeholderTextColor'] | null) =>
    typeof c === 'string' ? toPhosphorColor(c) : (c ?? undefined);
  return (
    <RNTextInput
      {...props}
      style={[props.style, phosphorTextOverride(props.style)]}
      placeholderTextColor={
        map(props.placeholderTextColor) ?? theme.colors.placeholder
      }
      selectionColor={map(props.selectionColor) ?? theme.colors.primary}
      cursorColor={map(props.cursorColor) ?? theme.colors.primary}
    />
  );
};
