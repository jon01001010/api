import React, {useMemo, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {Button, Card, Chip, Dialog, Portal, Text, TextInput} from 'react-native-paper';
import {registerDefaultTalents, talentRegistry} from '../services/talents';

type Draft = {id: string; name: string; description: string; parameters: string};
let draftCounter = 0;

/**
 * Toolbox editor prototype: custom tool definitions are local screen drafts,
 * NOT executable plugins and NOT persisted yet. Built-ins are protected.
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
  const [error, setError] = useState('');

  const newDraft = (tool?: (typeof tools)[number]) => {
    draftCounter += 1;
    setEditing({
      id: 'draft_' + draftCounter,
      name: tool ? tool.name + '_copy' : 'my_tool',
      description: tool?.description ?? '',
      parameters: tool?.parameters ?? '{"type":"object","properties":{}}',
    });
    setError('');
  };

  const saveDraft = () => {
    if (!editing) return;
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
        <Text variant="bodyMedium">Installed tools and custom tool drafts. Built-in tools cannot be modified. Drafts do not execute or grant permissions.</Text>
        <Button mode="contained" onPress={() => newDraft()}>Create tool draft</Button>
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
              <Chip compact>Draft · not executable</Chip>
              <Text variant="bodyMedium">{draft.description}</Text>
              <View style={{flexDirection: 'row', gap: 8, flexWrap: 'wrap'}}>
                <Button onPress={() => {setEditing({...draft}); setError('');}}>Edit</Button>
                <Button onPress={() => newDraft({name: draft.name, description: draft.description, parameters: draft.parameters})}>Duplicate</Button>
                <Button onPress={() => setDrafts(previous => previous.filter(t => t.id !== draft.id))}>Delete</Button>
                <Button disabled>Test (coming later)</Button>
              </View>
            </Card.Content>
          </Card>
        ))}
        <Text variant="bodySmall">Drafts currently last only until this screen unmounts. Saving, execution and permission controls will be added separately.</Text>
      </ScrollView>
      <Portal>
        <Dialog visible={editing !== null} onDismiss={() => setEditing(null)}>
          <Dialog.Title>Edit tool draft</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView style={{maxHeight: 420}}>
              <TextInput label="Tool name" mode="outlined" value={editing?.name ?? ''} onChangeText={name => setEditing(d => d ? {...d, name} : d)} style={{marginVertical: 6}} />
              <TextInput label="Description" mode="outlined" multiline value={editing?.description ?? ''} onChangeText={description => setEditing(d => d ? {...d, description} : d)} style={{marginVertical: 6}} />
              <TextInput label="Parameters (JSON schema)" mode="outlined" multiline value={editing?.parameters ?? ''} onChangeText={parameters => setEditing(d => d ? {...d, parameters} : d)} style={{marginVertical: 6}} />
              {error ? <Text style={{color: 'red'}}>{error}</Text> : null}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setEditing(null)}>Cancel</Button>
            <Button onPress={saveDraft}>Save draft</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
};
