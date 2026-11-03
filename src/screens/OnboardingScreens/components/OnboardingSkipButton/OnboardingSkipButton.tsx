import React from 'react';
import {Pressable} from 'react-native';

import {useTheme} from '../../../../hooks';
import {createStyles} from './styles';
import {Text} from '../../../../components/ThemedText';

export type OnboardingSkipButtonProps = {
  label: string;
  onPress: () => void;
};

export const OnboardingSkipButton: React.FC<OnboardingSkipButtonProps> = ({
  label,
  onPress,
}) => {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <Pressable
      testID="onboarding-skip"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.root}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
};
