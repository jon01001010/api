import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Text} from 'react-native-paper';

import {
  LOOP_RECENT_DAYS,
  recentlyDeletedLoops,
  restoreLoop,
  type RecentlyDeletedLoop,
} from '../../services/sync/loopSync';

/**
 * Loops removed here because they were stopped on a paired device (keeping
 * in step), kept 30 days: each can be restored, paused (it then comes back
 * on the other device too, not started there). Shows nothing when there
 * are none. `refresh`: change it to re-read (after a sync).
 */
export const RecentlyDeletedLoops: React.FC<{refresh?: unknown}> = ({
  refresh,
}) => {
  const [list, setList] = useState<RecentlyDeletedLoop[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState('');

  const load = useCallback(() => {
    recentlyDeletedLoops()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  useEffect(load, [load, refresh]);

  if (!list.length) {
    return null;
  }

  const restore = async (id: string) => {
    setBusy(true);
    try {
      const r = await restoreLoop(id);
      setWhy(r === true ? '' : r);
    } catch {
      // Stays in the list; it can be tried again.
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <View testID="recently-deleted-loops">
      <Button
        compact
        mode="text"
        onPress={() => setOpen(!open)}
        testID="recently-deleted-loops-toggle">
        {`Loops recently deleted (from another device): ${list.length}`}
      </Button>
      {open ? (
        <>
          <Text variant="bodySmall" style={styles.note}>
            {`Kept ${LOOP_RECENT_DAYS} days. A restored loop comes back paused, and on the other device too.`}
          </Text>
          {why ? (
            <Text variant="bodySmall" style={styles.note}>
              {why}
            </Text>
          ) : null}
          {list.map(r => (
            <View key={r.loop.id} style={styles.row}>
              <Text variant="bodySmall" style={styles.title} numberOfLines={2}>
                {`${String(r.loop.title || 'Loop')} · stopped on ${r.from}, ${new Date(r.removedAt).toLocaleDateString()}`}
              </Text>
              <Button
                compact
                disabled={busy}
                onPress={() => restore(r.loop.id)}
                testID={`recently-deleted-loop-restore-${r.loop.id}`}>
                Restore
              </Button>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  note: {marginVertical: 4},
  row: {flexDirection: 'row', alignItems: 'center', marginVertical: 2},
  title: {flex: 1, paddingRight: 8},
});
