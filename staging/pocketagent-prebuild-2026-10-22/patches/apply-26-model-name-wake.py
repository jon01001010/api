#!/usr/bin/env python3
# Apply model-bound names and wake matching.
from pathlib import Path

def edit(path, old, new):
    p=Path(path)
    s=p.read_text()
    if new in s:
        print('already applied',path);return
    if old not in s: raise RuntimeError(f'Expected anchor missing: {path}: {old[:75]}')
    p.write_text(s.replace(old,new,1))

store='src/store/ModelStore.ts'
edit(store,"import {localApiState} from '../services/localApi/state';", "import {localApiState} from '../services/localApi/state';\nimport {cleanModelName, matchesWakeName} from '../utils/modelWakeName';".replace('\\n','\n'))
edit(store,'  models: Model[] = [];', '''  models: Model[] = [];
  /** Per-model user names; keyed by stable model ID, not assistant/profile. */
  modelWakeNames: Record<string, string> = {};
  wakeListeningEnabled: boolean = false;

  getModelWakeName(modelId: string): string {
    return this.modelWakeNames[modelId] || this.displayModels.find(m => m.id === modelId)?.name || '';
  }

  setModelWakeName(modelId: string, name: string): void {
    if (!this.displayModels.some(m => m.id === modelId)) throw new Error('Unknown model');
    this.modelWakeNames = {...this.modelWakeNames, [modelId]: cleanModelName(name)};
  }

  /** Called by an explicitly enabled listener, never by a background auto-listener. */
  isActiveModelWakePhrase(transcript: string): boolean {
    return this.wakeListeningEnabled && !!this.activeModelId &&
      matchesWakeName(transcript, this.getModelWakeName(this.activeModelId));
  }
''')
edit(store,"        'models',", "        'models',\n        'modelWakeNames',\n        'wakeListeningEnabled',".replace('\\n','\n'))
screen='src/screens/ModelsScreen/ModelsScreen.tsx'
edit(screen,"import {Portal, Snackbar} from 'react-native-paper';", "import {Portal, Snackbar, Button, Dialog, TextInput as PaperTextInput} from 'react-native-paper';")
edit(screen,'  const [settingsVisible, setSettingsVisible] = useState(false);', '''  const [settingsVisible, setSettingsVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [modelNameDraft, setModelNameDraft] = useState('');''')
edit(screen,'      {/* Show Error Snackbar only if no dialog is visible */}', '''      {modelStore.activeModelId && (
        <Button onPress={() => {
          setModelNameDraft(modelStore.getModelWakeName(modelStore.activeModelId!));
          setRenameVisible(true);
        }}>
          Model name / wake word: {modelStore.getModelWakeName(modelStore.activeModelId)}
        </Button>
      )}
      <Portal>
        <Dialog visible={renameVisible} onDismiss={() => setRenameVisible(false)}>
          <Dialog.Title>Name this model</Dialog.Title>
          <Dialog.Content>
            <PaperTextInput label="Model name (also wake word)" value={modelNameDraft}
              maxLength={32} onChangeText={setModelNameDraft} />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenameVisible(false)}>Cancel</Button>
            <Button onPress={() => {
              try {
                if (modelStore.activeModelId) modelStore.setModelWakeName(modelStore.activeModelId, modelNameDraft);
                setRenameVisible(false);
              } catch (e) { Alert.alert('Invalid model name', String(e)); }
            }}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      {/* Show Error Snackbar only if no dialog is visible */}''')
print('Applied #26 patch')
