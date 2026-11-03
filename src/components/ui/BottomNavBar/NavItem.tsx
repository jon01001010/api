import React from 'react';

import {useTheme} from '../../../hooks';
import {Pressable} from '../primitives/Pressable';

import {createStyles} from './styles';
import {Text} from '../../ThemedText';

export type NavItemProps = {
  value: string;
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onSelect: (value: string) => void;
  testID?: string;
};

export const NavItem: React.FC<NavItemProps> = ({
  value,
  label,
  icon,
  selected,
  onSelect,
  testID,
}) => {
  const theme = useTheme();
  const styles = createStyles(theme, {selected});
  const resolvedTestID = testID ?? `ui-bottom-nav-item-${value}`;
  return (
    <Pressable
      testID={resolvedTestID}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{selected}}
      onPress={() => onSelect(value)}
      style={styles.item}>
      {icon}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
};
