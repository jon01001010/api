/**
 * R/G/B sliders that pick the Phosphor colour (Settings → App Settings,
 * under the Phosphor Style switch). The live swatch follows the sliders
 * while dragging; the app recolours on release so every screen doesn't
 * rebuild on each tick. Reset returns to the original green.
 */
import React, {useContext, useEffect, useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import Slider from '@react-native-community/slider';
import {Button, Text} from 'react-native-paper';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {uiStore} from '../../store';
import {L10nContext} from '../../utils';
import {
  DEFAULT_PHOSPHOR_TINT,
  buildPhosphorPalette,
  normalizeTint,
  type RGB,
} from '../../theme/phosphor';

const CHANNELS = [
  {key: 0, label: 'R'},
  {key: 1, label: 'G'},
  {key: 2, label: 'B'},
] as const;

export const PhosphorTintControls: React.FC = observer(() => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const saved = normalizeTint(uiStore.phosphorTint);
  const [draft, setDraft] = useState<RGB>(saved);

  // Follow external changes (e.g. Reset, or the store hydrating).
  const savedKey = saved.join(',');
  useEffect(() => {
    setDraft(normalizeTint(savedKey.split(',')));
  }, [savedKey]);

  const preview = useMemo(() => buildPhosphorPalette(draft), [draft]);

  const setChannel = (index: 0 | 1 | 2, value: number) =>
    setDraft(prev => {
      const next = [...prev] as [number, number, number];
      next[index] = Math.round(value);
      return next;
    });

  const commit = (next: RGB) =>
    uiStore.setPhosphorTint([next[0], next[1], next[2]]);

  const isDefault =
    draft[0] === DEFAULT_PHOSPHOR_TINT[0] &&
    draft[1] === DEFAULT_PHOSPHOR_TINT[1] &&
    draft[2] === DEFAULT_PHOSPHOR_TINT[2];

  return (
    <View style={styles.container} testID="phosphor-tint-controls">
      <View style={styles.header}>
        <Text variant="titleSmall" style={{color: theme.colors.onSurface}}>
          {l10n.settings.phosphorColor}
        </Text>
        <View
          testID="phosphor-tint-swatch"
          accessibilityLabel={`rgb(${draft.join(', ')})`}
          style={[
            styles.swatch,
            {backgroundColor: preview.bg, borderColor: preview.edge},
          ]}>
          <Text style={[styles.swatchText, {color: preview.fg}]}>Aa_</Text>
        </View>
      </View>
      {CHANNELS.map(({key, label}) => (
        <View key={label} style={styles.row}>
          <Text style={[styles.label, {color: theme.colors.onSurface}]}>
            {label}
          </Text>
          <Slider
            testID={`phosphor-tint-${label.toLowerCase()}`}
            accessibilityLabel={`${label} ${draft[key]}`}
            style={styles.slider}
            minimumValue={0}
            maximumValue={255}
            step={1}
            value={draft[key]}
            minimumTrackTintColor={preview.fg}
            maximumTrackTintColor={theme.colors.outline}
            thumbTintColor={preview.fg}
            onValueChange={v => setChannel(key, v)}
            onSlidingComplete={v => {
              const next = [...draft] as [number, number, number];
              next[key] = Math.round(v);
              commit(next);
            }}
          />
          <Text style={[styles.value, {color: theme.colors.onSurface}]}>
            {draft[key]}
          </Text>
        </View>
      ))}
      <Button
        testID="phosphor-tint-reset"
        compact
        disabled={isDefault}
        style={styles.reset}
        onPress={() => {
          setDraft(DEFAULT_PHOSPHOR_TINT);
          commit(DEFAULT_PHOSPHOR_TINT);
        }}>
        {l10n.settings.phosphorColorReset}
      </Button>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  swatch: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  swatchText: {
    fontFamily: 'JetBrainsMono-Regular',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    width: 16,
    fontFamily: 'JetBrainsMono-Medium',
  },
  slider: {
    flex: 1,
    height: 36,
  },
  value: {
    width: 36,
    textAlign: 'right',
    fontFamily: 'JetBrainsMono-Regular',
  },
  reset: {
    alignSelf: 'flex-end',
  },
});
