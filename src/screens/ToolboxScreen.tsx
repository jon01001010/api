import React, {useEffect, useMemo, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ScrollView, View} from 'react-native';
import Slider from '@react-native-community/slider';
import {Button, Card, Chip, Dialog, Portal, Text, TextInput, Switch} from 'react-native-paper';
import {readGlobalTools, writeGlobalTools, readGlobalPrompt, writeGlobalPrompt, generatedToolPrompt, readAgentMaxTurns, writeAgentMaxTurns} from '../utils/globalToolSettings';
import {safeMath} from '../services/talents/safeMath';
import {isBackgroundInferenceEnabled, setBackgroundInferenceEnabled} from '../utils/backgroundInference';
import {registerDefaultTalents, talentRegistry} from '../services/talents';
import {useTheme} from '../hooks';
import {useIsFocused} from '@react-navigation/native';
import {MemorySection} from '../components/PalsSheets/MemorySection';
import {themeColor} from '../theme/phosphor';

type Draft = {id: string; name: string; description: string; parameters: string; kind?: 'text_uppercase' | 'text_lowercase' | 'text_trim' | 'calculator' | 'http_get'};
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
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [globalPrompt, setGlobalPrompt] = useState('');
  // Success messages are shown as normal text, not in the error style.
  const [notice, setNotice] = useState('');
  const theme = useTheme();
  const isFocused = useIsFocused();
  const errorColor = themeColor(theme, 'red');
  const [agentMaxTurns, setAgentMaxTurns] = useState(20);
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [toggleError, setToggleError] = useState('');
  const [savingTool, setSavingTool] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    Promise.all([readGlobalTools(), readGlobalPrompt(), readAgentMaxTurns()])
      .then(([names, prompt, maxTurns]) => {if (mounted) {setEnabledTools(names); setGlobalPrompt(prompt); setAgentMaxTurns(maxTurns); setSettingsLoaded(true);}})
      .catch(e => {if (mounted) setToggleError('Could not load global settings: ' + String(e));});
    return () => {mounted = false;};
  }, []);
  useEffect(() => {isBackgroundInferenceEnabled().then(setBackgroundEnabled).catch(() => {});}, []);
  const toggleBuiltIn = async (name: string, enabled: boolean) => {
    if (!settingsLoaded || savingTool) return;
    const next = enabled ? [...enabledTools.filter(n => n !== name), name] : enabledTools.filter(n => n !== name);
    setSavingTool(name);
    setToggleError('');
    try {
      await writeGlobalTools(next);
      setEnabledTools(next);
    } catch (e) {
      setToggleError('Could not save tool setting: ' + String(e));
    } finally {
      setSavingTool(null);
    }
  };
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [testDraft, setTestDraft] = useState<Draft | null>(null);
  const [testInput, setTestInput] = useState('  Hello PocketAgent  ');
  const [testOutput, setTestOutput] = useState('');
  const [networkConsent, setNetworkConsent] = useState(false);
  const [testing, setTesting] = useState(false);

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
        <Text variant="titleMedium">Background inference (experimental)</Text>
        <Switch value={backgroundEnabled} onValueChange={value => {
          setBackgroundInferenceEnabled(value).then(() => setBackgroundEnabled(value))
            .catch(e => setToggleError(String(e)));
        }} />
        <Text variant="bodySmall">Keep a foreground Android notification while Qwen generates. Android may still interrupt inference; test before relying on it.</Text>
        <Text variant="titleMedium">Agent loop limits</Text>
        <Text variant="bodyMedium">Maximum tool iterations: {agentMaxTurns}</Text>
        <Slider minimumValue={5} maximumValue={500} step={5} value={agentMaxTurns}
          onValueChange={setAgentMaxTurns}
          onSlidingComplete={value => writeAgentMaxTurns(value).catch(e => setToggleError(String(e)))} />
        <Text variant="bodySmall">The agent can stop earlier when its task is complete. Maximum 500 steps.</Text>
        <Text variant="titleMedium">Global tools (off by default)</Text>
        <Text variant="bodySmall">Enabled tools are available in ordinary model chats. All new tools start off.</Text>
        {toggleError ? <Text style={{color: errorColor}}>{toggleError}</Text> : null}
        {notice ? <Text variant="bodySmall">{notice}</Text> : null}
        <Text variant="titleLarge">Memory</Text>
        <MemorySection isVisible={isFocused} />
        <Text variant="titleMedium">Global System Prompt</Text>
        <Text variant="bodySmall">Your instructions are editable. Tool instructions below are generated automatically from enabled tools.</Text>
        <TextInput mode="outlined" label="Your global instructions" multiline value={globalPrompt} onChangeText={setGlobalPrompt} />
        <Button disabled={!settingsLoaded} onPress={async () => {try {await writeGlobalPrompt(globalPrompt); setToggleError(''); setNotice('Global prompt saved');} catch (e) {setNotice(''); setToggleError('Could not save prompt: ' + String(e));}}}>Save global prompt</Button>
        <Text variant="titleSmall">Generated tool instructions (read only)</Text>
        <Text selectable variant="bodySmall">{generatedToolPrompt(enabledTools) || 'No tools enabled.'}</Text>
        <Button mode="contained" disabled={!loaded} onPress={() => newDraft()}>Create tool draft</Button>
        {!loaded ? <Text>Loading saved drafts…</Text> : null}
        {storageError ? <Text style={{color: errorColor}}>{storageError}</Text> : null}
        {tools.map(tool => (
          <Card key={tool.name} mode="outlined">
            <Card.Content>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
                <Text variant="titleMedium" style={{flex: 1}}>{tool.name}</Text>
                <Chip compact>Built-in</Chip>
                <Switch testID={'toolbox-toggle-' + tool.name} disabled={!settingsLoaded || savingTool !== null} value={enabledTools.includes(tool.name)} onValueChange={enabled => toggleBuiltIn(tool.name, enabled)} />
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
                <Button onPress={() => {setTestDraft(draft); setTestOutput(''); setNetworkConsent(false); setTestInput(draft.kind === 'http_get' ? 'https://api.github.com/zen' : '  Hello PocketAgent  ');}}>Test</Button>
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
                <Button onPress={() => setEditing(d => d ? {...d, kind: 'http_get'} : d)}>HTTP GET</Button>
              </View>
              <TextInput label="Parameters (JSON schema)" mode="outlined" multiline value={editing?.parameters ?? ''} onChangeText={parameters => setEditing(d => d ? {...d, parameters} : d)} style={{marginVertical: 6}} />
              {error ? <Text style={{color: errorColor}}>{error}</Text> : null}
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
            <Text variant="bodySmall">Tests are manual only. HTTP GET sends a request to the selected public HTTPS endpoint; no agent or file access.</Text>
            <TextInput label={testDraft?.kind === 'http_get' ? 'HTTPS URL' : 'Input text'} mode="outlined" multiline value={testInput} onChangeText={setTestInput} />
            {testDraft?.kind === 'http_get' ? <Button mode={networkConsent ? 'contained' : 'outlined'} onPress={() => setNetworkConsent(v => !v)}>{networkConsent ? 'Network request approved' : 'Approve this network request'}</Button> : null}
            <Text selectable variant="bodyMedium">{testOutput}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button disabled={testing} onPress={() => setTestDraft(null)}>Close</Button>
            <Button disabled={testing || (testDraft?.kind === 'http_get' && !networkConsent)} onPress={async () => {
              if (!testDraft) return;
              const value = testInput.slice(0, 10000);
              try {
                if (testDraft.kind === 'http_get') {
                  const parsed = new URL(value.trim());
                  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hostname !== 'api.github.com') {
                    throw new Error('Only public https://api.github.com endpoints are allowed in this initial test.');
                  }
                  setTesting(true);
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 8000);
                  try {
                    const response = await fetch(parsed.toString(), {method: 'GET', redirect: 'error', headers: {Accept: 'application/json'}, signal: controller.signal});
                    const declaredLength = Number(response.headers.get('content-length') ?? '0');
                    if (declaredLength > 32768) throw new Error('Response exceeds 32 KB limit');
                    const reader = response.body?.getReader();
                    if (!reader) throw new Error('Streaming response unavailable; refusing unbounded download');
                    const chunks: Uint8Array[] = [];
                    let size = 0;
                    while (true) {
                      const next = await reader.read();
                      if (next.done) break;
                      size += next.value.byteLength;
                      if (size > 32768) {await reader.cancel(); throw new Error('Response exceeds 32 KB limit');}
                      chunks.push(next.value);
                    }
                    const bytes = new Uint8Array(size);
                    let offset = 0;
                    chunks.forEach(chunk => {bytes.set(chunk, offset); offset += chunk.length;});
                    const output = new TextDecoder().decode(bytes);
                    setTestOutput('HTTP ' + response.status + ': ' + output.slice(0, 4000));
                  } finally {
                    clearTimeout(timeout);
                    setTesting(false);
                    setNetworkConsent(false);
                  }
                  return;
                }
                const result = testDraft.kind === 'calculator' ? String(safeMath(value)) : testDraft.kind === 'text_uppercase' ? value.toUpperCase() : testDraft.kind === 'text_lowercase' ? value.toLowerCase() : value.trim();
                setTestOutput('Result: ' + result);
              } catch (error) {
                setTestOutput('Error: ' + (error instanceof Error ? error.message : String(error)));
              }
            }}>{testing ? 'Running…' : 'Run test'}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
};
