import React, {useCallback, useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet, View} from 'react-native';
import {
  Button,
  Dialog,
  List,
  Portal,
  Text,
  TextInput,
} from 'react-native-paper';

import {
  memoryGet,
  memoryReplace,
  memoryHistory,
  memoryReadSnapshot,
  snapshotDate,
  userMemoryGet,
  userMemoryReplace,
  userMemoryHistory,
  userMemoryReadSnapshot,
} from '../../services/talents/agentMemory';

type Section = 'user' | 'model';

interface HistoryState {
  section: Section;
  entries: string[];
  /** Snapshot being previewed, with its text. */
  selected?: {name: string; content: string};
}

const formatSnapshot = (name: string) =>
  snapshotDate(name)?.toLocaleString() ?? name;

/**
 * Private, persistent memory editor (Toolbox screen and the Pal sheet).
 * User Memory: only the user can edit it; the model can read it.
 * Model Memory: the user can edit it; model changes need approval.
 * History lists every saved snapshot; pick one to preview and restore.
 */
export function MemorySection({isVisible}: {isVisible: boolean}) {
  const [user, setUser] = useState('');
  const [model, setModel] = useState('');
  const [savedUser, setSavedUser] = useState('');
  const [savedModel, setSavedModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryState | null>(null);

  const reload = useCallback(async () => {
    try {
      const [u, m] = await Promise.all([userMemoryGet(), memoryGet()]);
      setUser(u);
      setSavedUser(u);
      setModel(m);
      setSavedModel(m);
    } catch (error) {
      Alert.alert('Memory unavailable', String(error));
    }
  }, []);

  useEffect(() => {
    if (isVisible) {
      reload().catch(() => {});
    }
  }, [isVisible, reload]);

  const save = async (section: Section) => {
    setBusy(true);
    try {
      if (section === 'user') {
        await userMemoryReplace(user, savedUser);
        setSavedUser(user);
      } else {
        await memoryReplace(model, savedModel);
        setSavedModel(model);
      }
      Alert.alert('Memory saved', 'A previous-version snapshot was saved.');
    } catch (error) {
      Alert.alert('Could not save memory', String(error));
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (section: Section) => {
    try {
      const entries =
        section === 'user' ? await userMemoryHistory() : await memoryHistory();
      setHistory({section, entries});
    } catch (error) {
      Alert.alert('History unavailable', String(error));
    }
  };

  const preview = async (name: string) => {
    if (!history) {
      return;
    }
    try {
      const content =
        history.section === 'user'
          ? await userMemoryReadSnapshot(name)
          : await memoryReadSnapshot(name);
      setHistory({...history, selected: {name, content}});
    } catch (error) {
      Alert.alert('Could not open snapshot', String(error));
    }
  };

  const restore = async () => {
    if (!history?.selected) {
      return;
    }
    const {section, selected} = history;
    setBusy(true);
    try {
      // Restoring is itself a save, so the current text is snapshotted
      // first and the restore can be undone from History.
      if (section === 'user') {
        await userMemoryReplace(selected.content, savedUser);
      } else {
        await memoryReplace(selected.content, savedModel);
      }
      setHistory(null);
      await reload();
    } catch (error) {
      Alert.alert('Could not restore memory', String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container} testID="memory-section">
      <Text variant="titleMedium">User Memory</Text>
      <Text variant="bodySmall">
        Only you can edit this. The assistant may read it.
      </Text>
      <TextInput
        testID="user-memory-editor"
        mode="outlined"
        multiline
        value={user}
        onChangeText={setUser}
        placeholder="Your preferences and personal context"
        accessibilityLabel="User Memory"
      />
      <View style={styles.row}>
        <Button
          testID="user-memory-save"
          mode="contained"
          disabled={busy || user === savedUser}
          onPress={() => {
            save('user').catch(() => {});
          }}>
          Save User Memory
        </Button>
        <Button
          testID="user-memory-history"
          disabled={busy}
          onPress={() => {
            openHistory('user').catch(() => {});
          }}>
          History
        </Button>
      </View>
      <Text variant="titleMedium">Model Memory</Text>
      <Text variant="bodySmall">
        You can edit this; model changes require your approval.
      </Text>
      <TextInput
        testID="model-memory-editor"
        mode="outlined"
        multiline
        value={model}
        onChangeText={setModel}
        placeholder="Model-maintained project context"
        accessibilityLabel="Model Memory"
      />
      <View style={styles.row}>
        <Button
          testID="model-memory-save"
          mode="contained"
          disabled={busy || model === savedModel}
          onPress={() => {
            save('model').catch(() => {});
          }}>
          Save Model Memory
        </Button>
        <Button
          testID="model-memory-history"
          disabled={busy}
          onPress={() => {
            openHistory('model').catch(() => {});
          }}>
          History
        </Button>
      </View>

      <Portal>
        <Dialog
          visible={history !== null}
          onDismiss={() => setHistory(null)}
          testID="memory-history-dialog">
          <Dialog.Title>
            {history?.section === 'user' ? 'User' : 'Model'} Memory history
          </Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView style={styles.historyList}>
              {history && history.entries.length === 0 ? (
                <Text style={styles.empty}>No snapshots yet.</Text>
              ) : null}
              {history && !history.selected
                ? history.entries.map(name => (
                    <List.Item
                      key={name}
                      testID={`memory-snapshot-${name}`}
                      title={formatSnapshot(name)}
                      onPress={() => {
                        preview(name).catch(() => {});
                      }}
                    />
                  ))
                : null}
              {history?.selected ? (
                <View testID="memory-snapshot-preview">
                  <Text variant="labelMedium" style={styles.previewTitle}>
                    {formatSnapshot(history.selected.name)}
                  </Text>
                  <Text selectable variant="bodySmall">
                    {history.selected.content || '(empty)'}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            {history?.selected ? (
              <>
                <Button
                  onPress={() =>
                    setHistory(h => (h ? {...h, selected: undefined} : h))
                  }>
                  Back
                </Button>
                <Button
                  testID="memory-snapshot-restore"
                  disabled={busy}
                  onPress={() => {
                    restore().catch(() => {});
                  }}>
                  Restore this version
                </Button>
              </>
            ) : (
              <Button onPress={() => setHistory(null)}>Close</Button>
            )}
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    paddingVertical: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  historyList: {
    maxHeight: 360,
  },
  empty: {
    paddingVertical: 12,
  },
  previewTitle: {
    marginVertical: 8,
  },
});
