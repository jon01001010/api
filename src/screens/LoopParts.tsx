/**
 * Pieces shared by Toolbox → Loops (LoopsSection) and "Make a loop"
 * (MakeLoopSheet): the battery guard picker and the dry run shown before
 * Start. The dry run only shows; it sends nothing and runs nothing.
 */
import React, {useState} from 'react';
import {View} from 'react-native';
import {Button, Chip, Text} from 'react-native-paper';

import {
  type BatteryGuard,
  batteryText,
  cleanBattery,
  dryRunOf,
  type Loop,
} from '../services/loops/loops';

const CHOICES: {key: string; guard: BatteryGuard; label: string}[] = [
  {key: 'above20', guard: {kind: 'above', percent: 20}, label: 'Above 20%'},
  {key: 'above50', guard: {kind: 'above', percent: 50}, label: 'Above 50%'},
  {key: 'charger', guard: {kind: 'charger'}, label: 'Only on the charger'},
  {key: 'any', guard: {kind: 'any'}, label: 'Any level'},
];

const same = (a: BatteryGuard, b: BatteryGuard) =>
  a.kind === b.kind &&
  (a.kind !== 'above' || b.kind !== 'above' || a.percent === b.percent);

/** "Only when charging or battery above N%" (phone; the PC ignores it). */
export const BatteryPicker: React.FC<{
  value: BatteryGuard | undefined;
  onChange: (guard: BatteryGuard) => void;
}> = ({value, onChange}) => {
  const current = cleanBattery(value);
  const known = CHOICES.some(c => same(c.guard, current));
  return (
    <View style={{gap: 4}}>
      <Text variant="bodySmall">
        Battery (phone): {batteryText(current)}. When it isn't, the loop waits
        and looks again in 30 minutes.
      </Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
        {CHOICES.map(c => (
          <Chip
            key={c.key}
            compact
            selected={same(c.guard, current)}
            onPress={() => onChange(c.guard)}
            testID={`loop-battery-${c.key}`}>
            {c.label}
          </Chip>
        ))}
        {!known ? (
          <Chip compact selected>
            {batteryText(current)}
          </Chip>
        ) : null}
      </View>
    </View>
  );
};

const whenText = (t: number, now: number) =>
  t <= now + 90_000
    ? 'Right after Start (it asks first)'
    : new Date(t).toLocaleString();

/**
 * The dry run: what the first run's message will be (word for word), the
 * next 3 run times, the limits and guards, and what it may use. Nothing is
 * sent to the model.
 */
export const LoopDryRun: React.FC<{
  loop: Loop;
  uses: string;
  onBack: () => void;
  onStart: () => Promise<string | undefined>;
}> = ({loop, uses, onBack, onStart}) => {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dry = dryRunOf(loop, uses);
  const now = Date.now();
  return (
    <View style={{gap: 6}} testID="loop-dry-run">
      <Text variant="titleSmall">Dry run: {loop.title}</Text>
      <Text variant="bodySmall">
        Nothing has been sent to the model. If you start it, this is what
        happens.
      </Text>
      <Text variant="labelLarge">The first run sends this message</Text>
      <Text variant="bodySmall" selectable testID="loop-dry-run-message">
        {dry.message}
      </Text>
      <Text variant="labelLarge">When</Text>
      {dry.times.map((t, i) => (
        <Text key={t} variant="bodySmall">
          Run {i + 1}: {whenText(t, now)}
        </Text>
      ))}
      <Text variant="labelLarge">Limits and guards</Text>
      {dry.limits.map(l => (
        <Text key={l} variant="bodySmall">
          {l}
        </Text>
      ))}
      <Text variant="labelLarge">May use</Text>
      <Text variant="bodySmall">{dry.uses}</Text>
      {error ? <Text variant="bodySmall">{error}</Text> : null}
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 4}}>
        <Button onPress={onBack} disabled={busy} testID="loop-dry-run-back">
          Back
        </Button>
        <Button
          mode="contained"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError('');
            try {
              const e = await onStart();
              if (e) {
                setError(e);
              }
            } finally {
              setBusy(false);
            }
          }}
          testID="loop-dry-run-start">
          Looks right, start
        </Button>
      </View>
    </View>
  );
};
