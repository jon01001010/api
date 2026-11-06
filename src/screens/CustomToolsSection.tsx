import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {
  Button,
  Card,
  Chip,
  Dialog,
  Portal,
  SegmentedButtons,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';

import {
  deleteCustomTool,
  describeCustomTool,
  listCustomTools,
  saveCustomTool,
  type CustomTool,
  type ShortcutStep,
} from '../services/talents/customTools';

interface Props {
  enabledTools: string[];
  disabled: boolean;
  onToggle: (name: string, enabled: boolean) => void;
  errorColor: string;
}

interface Draft {
  replacing?: string;
  kind: 'instructions' | 'shortcut';
  name: string;
  description: string;
  instructions: string;
  /** One step per line: `tool {"arg": "value"}`. */
  stepsText: string;
}

const EMPTY: Draft = {
  kind: 'instructions',
  name: '',
  description: '',
  instructions: '',
  stepsText: '',
};

export const stepsToText = (steps: ShortcutStep[]): string =>
  steps
    .map(s =>
      `${s.tool} ${Object.keys(s.args).length ? JSON.stringify(s.args) : ''}`.trim(),
    )
    .join('\n');

/** Lines like `set_alarm {"hour": "{{hour}}"}` → steps, or why not. */
export function textToSteps(text: string): ShortcutStep[] | string {
  const steps: ShortcutStep[] = [];
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const m = /^([a-z][a-z0-9_]*)\s*(\{.*\})?$/i.exec(line);
    if (!m) {
      return `Line ${i + 1}: write the tool name, then optional arguments as JSON, e.g. open_app {"name": "Spotify"}.`;
    }
    let args: Record<string, unknown> = {};
    if (m[2]) {
      try {
        args = JSON.parse(m[2]);
      } catch {
        return `Line ${i + 1}: the arguments are not valid JSON.`;
      }
    }
    steps.push({tool: m[1], args});
  }
  return steps;
}

/**
 * Toolbox → Custom tools: saved instructions and shortcuts, made here or by
 * a model (tool_save). Each is off until its switch is on.
 */
export const CustomToolsSection: React.FC<Props> = ({
  enabledTools,
  disabled,
  onToggle,
  errorColor,
}) => {
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<CustomTool | null>(null);
  // Each opening of the editor gets fresh text boxes. The boxes keep their
  // own text (defaultValue) and the app only reads it: feeding it back on
  // every key press made the cursor jump on Android inside a dialog.
  const [session, setSession] = useState(0);

  const reload = useCallback(() => {
    listCustomTools()
      .then(setTools)
      .catch(() => setTools([]));
  }, []);
  useEffect(reload, [reload]);

  const save = async () => {
    if (!editing) {
      return;
    }
    let steps: ShortcutStep[] | undefined;
    if (editing.kind === 'shortcut') {
      const parsed = textToSteps(editing.stepsText);
      if (typeof parsed === 'string') {
        setError(parsed);
        return;
      }
      steps = parsed;
    }
    const result = await saveCustomTool(
      {
        kind: editing.kind,
        name: editing.name,
        description: editing.description,
        instructions: editing.instructions,
        steps,
        createdBy: 'user',
      },
      editing.replacing,
    );
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    // A changed tool is switched off until turned on again.
    if (editing.replacing && enabledTools.includes(editing.replacing)) {
      onToggle(editing.replacing, false);
    }
    setEditing(null);
    setError('');
    reload();
  };

  const edit = (tool: CustomTool) => {
    setError('');
    setSession(n => n + 1);
    setEditing({
      replacing: tool.name,
      kind: tool.kind,
      name: tool.name,
      description: tool.description,
      instructions: tool.kind === 'instructions' ? tool.instructions : '',
      stepsText: tool.kind === 'shortcut' ? stepsToText(tool.steps) : '',
    });
  };

  const remove = async (tool: CustomTool) => {
    if (enabledTools.includes(tool.name)) {
      onToggle(tool.name, false);
    }
    await deleteCustomTool(tool.name);
    reload();
  };

  return (
    <>
      <Card mode="outlined" testID="toolbox-custom-tools">
        <Card.Content style={{gap: 6}}>
          <Text variant="titleMedium">Custom tools ({tools.length})</Text>
          <Text variant="bodyMedium">
            Saved instructions (a how-to the model reads back) and shortcuts
            (steps using built-in tools, approved once per run). Made here or by
            a model with tool_save; each starts switched off.
          </Text>
          {tools.map(tool => (
            <View
              key={tool.name}
              testID={'custom-tool-' + tool.name}
              style={{paddingVertical: 6, gap: 4}}>
              <View
                style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                <Text variant="titleSmall" style={{flex: 1}}>
                  {tool.name}
                </Text>
                <Chip compact>
                  {tool.kind === 'shortcut' ? 'Shortcut' : 'Instructions'}
                  {tool.createdBy === 'model' ? ' · by model' : ''}
                </Chip>
                <Switch
                  testID={'toolbox-toggle-' + tool.name}
                  disabled={disabled}
                  value={enabledTools.includes(tool.name)}
                  onValueChange={on => onToggle(tool.name, on)}
                />
              </View>
              <Text variant="bodySmall">{tool.description}</Text>
              <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
                <Button compact onPress={() => setViewing(tool)}>
                  View
                </Button>
                <Button compact onPress={() => edit(tool)}>
                  Edit
                </Button>
                <Button
                  compact
                  testID={'custom-tool-delete-' + tool.name}
                  onPress={() => remove(tool)}>
                  Delete
                </Button>
              </View>
            </View>
          ))}
          <Button
            mode="contained"
            testID="custom-tool-new"
            onPress={() => {
              setError('');
              setSession(n => n + 1);
              setEditing({...EMPTY});
            }}>
            New custom tool
          </Button>
        </Card.Content>
      </Card>
      <Portal>
        <Dialog visible={editing !== null} onDismiss={() => setEditing(null)}>
          <Dialog.Title>
            {editing?.replacing ? 'Edit custom tool' : 'New custom tool'}
          </Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView style={{maxHeight: 440}}>
              <SegmentedButtons
                value={editing?.kind ?? 'instructions'}
                onValueChange={kind =>
                  setEditing(d => (d ? {...d, kind: kind as Draft['kind']} : d))
                }
                buttons={[
                  {value: 'instructions', label: 'Instructions'},
                  {value: 'shortcut', label: 'Shortcut'},
                ]}
                style={{marginVertical: 8}}
              />
              <TextInput
                key={`${session}-name`}
                testID="custom-tool-name"
                label="Name (e.g. morning_routine)"
                mode="outlined"
                autoCapitalize="none"
                defaultValue={editing?.name ?? ''}
                onChangeText={name => setEditing(d => (d ? {...d, name} : d))}
              />
              <TextInput
                key={`${session}-description`}
                testID="custom-tool-description"
                label="When should the model use it?"
                placeholder="e.g. when I say good morning"
                mode="outlined"
                multiline
                defaultValue={editing?.description ?? ''}
                onChangeText={description =>
                  setEditing(d => (d ? {...d, description} : d))
                }
                style={{marginTop: 6}}
              />
              <Text variant="bodySmall" testID="custom-tool-no-timer">
                {editing?.kind === 'shortcut'
                  ? 'Runs when you ask for it, never on a timer. An alarm step sets the alarm; it rings at its time.'
                  : 'Instructions are text the model reads and then follows with your other tools. Nothing runs on a timer: for an alarm, use Shortcut with set_alarm.'}
              </Text>
              {editing?.kind === 'shortcut' ? (
                <>
                  <TextInput
                    key={`${session}-steps`}
                    testID="custom-tool-steps"
                    label="Steps, one per line"
                    mode="outlined"
                    multiline
                    autoCapitalize="none"
                    defaultValue={editing.stepsText}
                    onChangeText={stepsText =>
                      setEditing(d => (d ? {...d, stepsText} : d))
                    }
                    style={{marginTop: 6}}
                  />
                  <Text variant="bodySmall">
                    {
                      'Example:\nset_alarm {"hour": "{{hour}}", "minute": 0}\nopen_app {"name": "Spotify"}\n{{hour}} is asked for each time. A step that opens another app must be last.'
                    }
                  </Text>
                </>
              ) : (
                <TextInput
                  key={`${session}-instructions`}
                  testID="custom-tool-instructions"
                  label="Instructions"
                  mode="outlined"
                  multiline
                  defaultValue={editing?.instructions ?? ''}
                  onChangeText={instructions =>
                    setEditing(d => (d ? {...d, instructions} : d))
                  }
                  style={{marginTop: 6}}
                />
              )}
              {error ? <Text style={{color: errorColor}}>{error}</Text> : null}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setEditing(null)}>Cancel</Button>
            <Button testID="custom-tool-save" onPress={save}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={viewing !== null} onDismiss={() => setViewing(null)}>
          <Dialog.Title>{viewing?.name}</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView style={{maxHeight: 420}}>
              <Text selectable variant="bodySmall">
                {viewing ? describeCustomTool(viewing) : ''}
              </Text>
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setViewing(null)}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
};
