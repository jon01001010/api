import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Text} from 'react-native-paper';

import {
  recentlyDeleted,
  restoreDeleted,
  RECENT_DAYS,
  type RecentlyDeleted,
} from '../../services/sync/chatDeletes';

/**
 * Chats removed here because they were deleted on a mirrored device, kept
 * 30 days: each can be restored (it then comes back on the other device
 * too). Shows nothing when there are none. `refresh`: change it to re-read
 * (after a sync).
 */
export const RecentlyDeletedChats: React.FC<{refresh?: unknown}> = ({
  refresh,
}) => {
  const [list, setList] = useState<RecentlyDeleted[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    recentlyDeleted()
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
      if (await restoreDeleted(id)) {
        await require('../../store').chatSessionStore.loadSessionList();
      }
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <View testID="recently-deleted-chats">
      <Button
        compact
        mode="text"
        onPress={() => setOpen(!open)}
        testID="recently-deleted-toggle">
        {`Recently deleted (from another device): ${list.length}`}
      </Button>
      {open ? (
        <>
          <Text variant="bodySmall" style={styles.note}>
            {`Kept ${RECENT_DAYS} days. Restoring a chat brings it back on the other device too.`}
          </Text>
          {list.map(r => (
            <View key={r.chat.session.id} style={styles.row}>
              <Text variant="bodySmall" style={styles.title} numberOfLines={2}>
                {`${String(r.chat.session.title || 'Chat')} · deleted on ${r.from}, ${new Date(r.removedAt).toLocaleDateString()}`}
              </Text>
              <Button
                compact
                disabled={busy}
                onPress={() => restore(r.chat.session.id)}
                testID={`recently-deleted-restore-${r.chat.session.id}`}>
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
