import React, {useEffect, useMemo, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ScrollView, View} from 'react-native';
import {Button, Card, Chip, Dialog, Portal, Text, TextInput} from 'react-native-paper';
import {safeMath} from '../services/talents/safeMath';
import {registerDefaultTalents, talentRegistry} from '../services/talents';

type Draft = {id: string; name: string; description: string; parameters: string; kind?: 'text_uppercase' | 'text_lowercase' | 'text_trim' | 'calculator'};
const STORAGE_KEY = '@pocketagent/toolbox/drafts/v1';
let draftCounter = 0;

/**
 * Toolbox editor prototype: custom tool definitions are local screen drafts,
 * NOT executable plugins. Drafts are persisted on-device. Built-ins are protected.
 */
export const ToolboxScreen: React.FC = () => {
  const tools = useMemo(() => {
    registerDefaultTalents();
    return talentRegistry.getAll().map(engine => ({
      name: engine.name,
      description: engine.toToolDefinition().function.description,
      parameters: JSON.stringify(engine.toToolDefinition().function.parameters ?? {}, null, 2),
    }));
  }, []);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [testDraft, setTestDraft] = useState<Draft | null>(null);
  const [testInput, setTestInput] = useState('  Hello PocketAgent  ');
  const [testOutput, setTestOutput] = useState('');

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (!active) return;
        if (raw) {
          const data: unknown = JSON.parse(raw);
          if (!Array.isArray(data) || !data.every(item =>
            item && typeof item.id === 'string' && typeof item.name === 'string' &&
            typeof item.description === 'string' && typeof item.parameters === 'string'
          )) throw new Error('Stored drafts have an invalid format');
          setDrafts(data as Draft[]);
        }
      })
      .catch(e => {if (active) setStorageError('Could not load drafts: ' + String(e));})
      .finally(() => {if (active) setLoaded(true);});
    return () => {active = false;};
  }, []);

  useEffect(() => {
    if (!loaded || storageError) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
      .catch(e => setStorageError('Could not save drafts: ' + String(e)));
  }, [drafts, loaded, storageError]);
  const [error, setError] = useState('');

  const newDraft = (tool?: (typeof tools)[number]) => {
    draftCounter += 1;
    setEditing({
      id: 'draft_' + Date.now() + '_' + draftCounter,
      name: tool ? tool.name + '_copy' : 'my_tool',
      description: tool?.description ?? '',
      parameters: tool?.parameters ?? '{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}',
      kind: 'text_trim',
    });
    setError('');
  };

  const saveDraft = () => {
    if (!editing || !loaded) return;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(editing.name)) {
      setError('Name must be 1–64 letters, numbers or underscores, starting with a letter or underscore.');
      return;
    }
    if (tools.some(t => t.name === editing.name) || drafts.some(t => t.name === editing.name && t.id !== editing.id)) {
      setError('A tool with this name already exists.');
      return;
    }
    try {
      const schema = JSON.parse(editing.parameters);
      if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object') {
        throw new Error('Parameters must be a JSON object schema with type "object".');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid parameter JSON');
      return;
    }
    setDrafts(previous => [...previous.filter(t => t.id !== editing.id), editing]);
    setEditing(null);
  };

  return (
    <>
      <ScrollView contentContainerStyle={{padding: 16, gap: 12}}>
        <Text variant="titleLarge">Toolbox</Text>
        <Text variant="bodyMedium">Installed tools and custom tool drafts. Built-in tools cannot be modified. Custom text tools can be tested locally, but cannot yet be called by the agent.</Text>
        <Button mode="contained" disabled={!loaded} onPress={() => newDraft()}>Create tool draft</Button>
        {!loaded ? <Text>Loading saved drafts…</Text> : null}
        {storageError ? <Text style={{color: 'red'}}>{storageError}</Text> : null}
        {tools.map(tool => (
          <Card key={tool.name} mode="outlined">
            <Card.Content>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
                <Text variant="titleMedium" style={{flex: 1}}>{tool.name}</Text>
                <Chip compact>Built-in</Chip>
              </View>
              <Text variant="bodyMedium">{tool.description}</Text>
              <Button onPress={() => newDraft(tool)}>Duplicate to draft</Button>
            </Card.Content>
          </Card>
        ))}
        {drafts.map(draft => (
          <Card key={draft.id} mode="outlined">
            <Card.Content>
              <Text variant="titleMedium">{draft.name}</Text>
              <Chip compact>Custom · local test only</Chip>
              <Text variant="bodyMedium">{draft.description}</Text>
              <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
                <Button onPress={() => {setEditing({...draft}); setError('');}}>Edit</Button>
                <Button onPress={() => newDraft({name: draft.name, description: draft.description, parameters: draft.parameters})}>Duplicate</Button>
                <Button onPress={() => setDrafts(previous => previous.filter(t => t.id !== draft.id))}>Delete</Button>
                <Button onPress={() => {setTestDraft(draft); setTestOutput('');}}>Test</Button>
              </View>
            </Card.Content>
          </Card>
        ))}
        <Text variant="bodySmall">Drafts are stored on this device. Text tests run only when you tap Test. Agent execution, file access and network permissions are not enabled.</Text>
      </ScrollView>
      <Portal>
        <Dialog visible={editing !== null} onDismiss={() => setEditing(null)}>
          <Dialog.Title>Edit tool draft</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView style={{maxHeight: 420}}>
              <TextInput label="Tool name" mode="outlined" value={editing?.name ?? ''} onChangeText={name => setEditing(d => d ? {...d, name} : d)} style={{marginVertical: 6}} />
              <TextInput label="Description" mode="outlined" multiline value={editing?.description ?? ''} onChangeText={description => setEditing(d => d ? {...d, description} : d)} style={{marginVertical: 6}} />
              <Text variant="bodySmall">Text operation: {editing?.kind ?? 'text_trim'}</Text>
              <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
                <Button onPress={() => setEditing(d => d ? {...d, kind: 'text_trim'} : d)}>Trim</Button>
                <Button onPress={() => setEditing(d => d ? {...d, kind: 'text_uppercase'} : d)}>Uppercase</Button>
                <Button onPress={() => setEditing(d => d ? {...d, kind: 'text_lowercase'} : d)}>Lowercase</Button>
                <Button onPress={() => setEditing(d => d ? {...d, kind: 'calculator'} : d)}>Calculator</Button>
              </View>
              <TextInput label="Parameters (JSON schema)" mode="outlined" multiline value={editing?.parameters ?? ''} onChangeText={parameters => setEditing(d => d ? {...d, parameters} : d)} style={{marginVertical: 6}} />
              {error ? <Text style={{color: 'red'}}>{error}</Text> : null}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setEditing(null)}>Cancel</Button>
            <Button onPress={saveDraft}>Save draft</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={testDraft !== null} onDismiss={() => setTestDraft(null)}>
          <Dialog.Title>Test {testDraft?.name}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodySmall">Local text-only test. No network, files or agent calls.</Text>
            <TextInput label="Input text" mode="outlined" multiline value={testInput} onChangeText={setTestInput} />
            <Text selectable variant="bodyMedium">{testOutput}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setTestDraft(null)}>Close</Button>
            <Button onPress={() => {
              if (!testDraft) return;
              const value = testInput.slice(0, 10000);
              const result = testDraft.kind === 'text_uppercase' ? value.toUpperCase() : testDraft.kind === 'text_lowercase' ? value.toLowerCase() : value.trim();
              setTestOutput('Result: ' + result);
            }}>Run test</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
};
