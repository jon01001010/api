import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Text} from 'react-native-paper';

import {
  recentlyDeletedAssistants,
  restoreAssistant,
  RECENT_DAYS,
  type RecentlyDeletedAssistant,
} from '../../services/sync/assistantDeletes';

/**
 * Your own assistants removed here because they were deleted on a paired
 * device (keeping in step), kept 30 days: each can be restored (it then
 * comes back on the other device too). Shows nothing when there are none.
 * `refresh`: change it to re-read (after a sync).
 */
export const RecentlyDeletedAssistants: React.FC<{refresh?: unknown}> = ({
  refresh,
}) => {
  const [list, setList] = useState<RecentlyDeletedAssistant[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    recentlyDeletedAssistants()
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
      await restoreAssistant(id);
    } catch {
      // Stays in the list; it can be tried again.
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <View testID="recently-deleted-assistants">
      <Button
        compact
        mode="text"
        onPress={() => setOpen(!open)}
        testID="recently-deleted-assistants-toggle">
        {`Assistants recently deleted (from another device): ${list.length}`}
      </Button>
      {open ? (
        <>
          <Text variant="bodySmall" style={styles.note}>
            {`Kept ${RECENT_DAYS} days. Restoring an assistant brings it back on the other device too.`}
          </Text>
          {list.map(r => (
            <View key={r.pal.id} style={styles.row}>
              <Text variant="bodySmall" style={styles.title} numberOfLines={2}>
                {`${String(r.pal.name || 'Assistant')} · deleted on ${r.from}, ${new Date(r.removedAt).toLocaleDateString()}`}
              </Text>
              <Button
                compact
                disabled={busy}
                onPress={() => restore(r.pal.id)}
                testID={`recently-deleted-assistant-restore-${r.pal.id}`}>
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
