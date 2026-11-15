import React, {useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {observer} from 'mobx-react';
import {Button, Chip, IconButton, RadioButton, Text} from 'react-native-paper';

import {loraStore} from '../../store/LoraStore';
import {
  addAdapterFile,
  chooseAdapter,
  removeAdapter,
} from '../../services/lora';
import {Model} from '../../utils/types';
import {formatBytes} from '../../utils/formatters';

const STRENGTHS = [0.2, 0.4, 0.6, 0.8, 1];

/**
 * A model's LoRA adapters (style add-ons, src/store/LoraStore.ts): Off or one
 * adapter, with a strength. Takes effect at once; "Off" is the plain model.
 */
export const LoraAdapterSection = observer(({model}: {model: Model}) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const adapters = loraStore.adaptersFor(model.id);
  const active = loraStore.activeFor(model.id);
  const problem = loraStore.problems[model.id];

  const run = async (work: () => Promise<unknown>, done = '') => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      setMessage(done);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      const added = await addAdapterFile(model);
      if (added) {
        setMessage(`Added ${added.name}. Choose it below to use it.`);
      }
    });

  const confirmRemove = (id: string, name: string) => {
    const adapter = adapters.find(a => a.id === id);
    if (!adapter) {
      return;
    }
    Alert.alert('Remove adapter?', `${name} is removed from the app.`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => run(() => removeAdapter(adapter), `Removed ${name}.`),
      },
    ]);
  };

  return (
    <View testID="lora-section">
      <Text variant="bodySmall" style={styles.help}>
        A LoRA adapter (.gguf) changes this model's style without changing the
        model. Keep several versions; switching back is instant.
      </Text>
      <RadioButton.Group
        value={active?.adapter.id ?? 'off'}
        onValueChange={value =>
          run(() => chooseAdapter(model.id, value === 'off' ? null : value))
        }>
        <RadioButton.Item
          label="Off (plain model)"
          value="off"
          disabled={busy}
          testID="lora-off"
        />
        {adapters.map(a => (
          <View key={a.id} style={styles.row}>
            <View style={styles.grow}>
              <RadioButton.Item
                label={`${a.name} · ${a.addedAt.slice(0, 10)} · ${formatBytes(
                  a.size,
                  0,
                )}`}
                value={a.id}
                disabled={busy}
                testID={`lora-choice-${a.id}`}
              />
            </View>
            <IconButton
              icon="delete-outline"
              accessibilityLabel={`Remove ${a.name}`}
              disabled={busy}
              onPress={() => confirmRemove(a.id, a.name)}
              testID={`lora-remove-${a.id}`}
            />
          </View>
        ))}
      </RadioButton.Group>
      {active ? (
        <>
          <Text variant="bodySmall" style={styles.help}>
            Strength
          </Text>
          <View style={styles.chips}>
            {STRENGTHS.map(s => (
              <Chip
                key={s}
                selected={Math.abs(active.scale - s) < 0.001}
                showSelectedCheck
                disabled={busy}
                testID={`lora-strength-${s}`}
                onPress={() =>
                  run(() => chooseAdapter(model.id, active.adapter.id, s))
                }>
                {String(s)}
              </Chip>
            ))}
          </View>
        </>
      ) : null}
      <Button
        mode="outlined"
        icon="plus"
        onPress={add}
        disabled={busy}
        loading={busy}
        testID="lora-add">
        Add an adapter file
      </Button>
      {problem ? (
        <Text variant="bodySmall" style={styles.problem} testID="lora-problem">
          {problem}
        </Text>
      ) : null}
      {message ? (
        <Text variant="bodySmall" style={styles.help} testID="lora-message">
          {message}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  help: {marginVertical: 8, opacity: 0.7},
  problem: {marginVertical: 8},
  row: {flexDirection: 'row', alignItems: 'center'},
  grow: {flex: 1},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12},
});
