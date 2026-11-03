import React, {useCallback, useEffect, useState} from 'react';
import {Alert, View} from 'react-native';
import {Button, Text, TextInput} from 'react-native-paper';
import {
  memoryGet, memoryReplace, memoryHistory, memoryReadSnapshot,
  userMemoryGet, userMemoryReplace, userMemoryHistory, userMemoryReadSnapshot,
} from '../../services/talents/agentMemory';

type Section = 'user' | 'model';

/** Private, persistent memory editor; model writes never target user memory. */
export function MemorySection({isVisible}: {isVisible: boolean}) {
  const [user, setUser] = useState('');
  const [model, setModel] = useState('');
  const [savedUser, setSavedUser] = useState('');
  const [savedModel, setSavedModel] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [u, m] = await Promise.all([userMemoryGet(), memoryGet()]);
      setUser(u); setSavedUser(u);
      setModel(m); setSavedModel(m);
    } catch (error) {
      Alert.alert('Memory unavailable', String(error));
    }
  }, []);

  useEffect(() => {
    if (isVisible) { void reload(); }
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

  const history = async (section: Section) => {
    try {
      const entries = section === 'user' ? await userMemoryHistory() : await memoryHistory();
      if (!entries.length) {
        Alert.alert('Memory history', 'No snapshots yet.');
        return;
      }
      Alert.alert('Restore memory snapshot?', entries[0], [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Restore latest', onPress: () => { void restore(section, entries[0]); }},
      ]);
    } catch (error) {
      Alert.alert('History unavailable', String(error));
    }
  };

  const restore = async (section: Section, name: string) => {
    setBusy(true);
    try {
      if (section === 'user') {
        const snapshot = await userMemoryReadSnapshot(name);
        await userMemoryReplace(snapshot, savedUser);
      } else {
        const snapshot = await memoryReadSnapshot(name);
        await memoryReplace(snapshot, savedModel);
      }
      await reload();
    } catch (error) {
      Alert.alert('Could not restore memory', String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{gap: 12, paddingVertical: 12}}>
      <Text variant="titleMedium">User Memory</Text>
      <Text variant="bodySmall">Only you can edit this. The assistant may read it.</Text>
      <TextInput testID="user-memory-editor" mode="outlined" multiline
        value={user} onChangeText={setUser} placeholder="Your preferences and personal context"
        accessibilityLabel="User Memory" />
      <View style={{flexDirection: 'row', gap: 8}}>
        <Button mode="contained" disabled={busy || user === savedUser}
          onPress={() => { void save('user'); }}>Save User Memory</Button>
        <Button disabled={busy} onPress={() => { void history('user'); }}>History</Button>
      </View>
      <Text variant="titleMedium">Model Memory</Text>
      <Text variant="bodySmall">You can edit this; model changes require your approval.</Text>
      <TextInput testID="model-memory-editor" mode="outlined" multiline
        value={model} onChangeText={setModel} placeholder="Model-maintained project context"
        accessibilityLabel="Model Memory" />
      <View style={{flexDirection: 'row', gap: 8}}>
        <Button mode="contained" disabled={busy || model === savedModel}
          onPress={() => { void save('model'); }}>Save Model Memory</Button>
        <Button disabled={busy} onPress={() => { void history('model'); }}>History</Button>
      </View>
    </View>
  );
}
