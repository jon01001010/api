import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Switch, Text} from 'react-native-paper';

import {
  setSyncWithPc,
  syncWithPc,
  syncWithPcOn,
} from '../../services/sync/deviceSync';
import {describeKeys} from '../../services/sync/promptSync';

/**
 * A paired home PC: keep the system prompt, memory, assistants and custom tools in step with it
 * (off until switched on; the PC must allow it too). "Sync now" and the
 * result; it also runs when the PC's model is loaded.
 */
export const HomeLinkSync: React.FC<{pc: string}> = ({pc}) => {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState('');

  useEffect(() => {
    syncWithPcOn(pc).then(setOn);
  }, [pc]);

  const syncNow = async () => {
    setBusy(true);
    setLine('Keeping in step…');
    const r = await syncWithPc(pc);
    setBusy(false);
    if (!r.ok) {
      setLine(`Not in step: ${r.error}`);
      return;
    }
    const parts = [
      r.changedHere.length
        ? `${describeKeys(r.changedHere)} taken from the PC`
        : '',
      r.changedOnPc.length
        ? `${describeKeys(r.changedOnPc)} sent to the PC`
        : '',
    ].filter(Boolean);
    setLine(
      parts.length
        ? `${parts.join('; ')}. Earlier versions are kept in history.`
        : 'Already in step.',
    );
  };

  return (
    <View testID="home-link-sync">
      <View style={styles.row}>
        <Text variant="bodySmall" style={styles.text}>
          Keep the system prompt, memory, assistants and custom tools in step
          with this PC (the newer edit wins; the other is kept in history). The
          PC must allow it too.
        </Text>
        <Switch
          value={on}
          onValueChange={async v => {
            await setSyncWithPc(pc, v);
            setOn(v);
            if (v) {
              syncNow();
            }
          }}
          testID="home-link-sync-switch"
        />
      </View>
      {on ? (
        <Button
          compact
          mode="outlined"
          disabled={busy}
          onPress={syncNow}
          testID="home-link-sync-now">
          Sync now
        </Button>
      ) : null}
      {line ? (
        <Text variant="bodySmall" testID="home-link-sync-result">
          {line}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', marginVertical: 6},
  text: {flex: 1, paddingRight: 12},
});
