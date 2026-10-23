#!/usr/bin/env python3
from pathlib import Path
p=Path('src/store/ModelStore.ts'); s=p.read_text(); old='  wakeListeningEnabled: boolean = false;'; new=old+'\n\n  /** Explicit opt-in preference; not a microphone listener. */\n  setWakeListeningEnabled(enabled: boolean): void {\n    this.wakeListeningEnabled = enabled;\n  }'
if new not in s:
    if old not in s: raise RuntimeError('Apply #26 first')
    p.write_text(s.replace(old,new,1))
p=Path('src/screens/ModelsScreen/ModelsScreen.tsx');s=p.read_text()
changes=[
 ("import {FlatList, RefreshControl, Platform, Alert, View} from 'react-native';", "import {FlatList, RefreshControl, Platform, Alert, View, PermissionsAndroid} from 'react-native';"),
 ("import {Portal, Snackbar, Button, Dialog, TextInput as PaperTextInput} from 'react-native-paper';", "import {Portal, Snackbar, Button, Dialog, Switch, Text, TextInput as PaperTextInput} from 'react-native-paper';"),
 ('  const handleAddRemoteModel = () => {', "  const setWakePreference = async (enabled: boolean) => {\n    if (!enabled) { modelStore.setWakeListeningEnabled(false); return; }\n    if (Platform.OS === 'android') {\n      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);\n      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;\n    }\n    Alert.alert('Wake listening not active', 'The preference is saved, but audio wake recognition is not yet connected.');\n    modelStore.setWakeListeningEnabled(true);\n  };\n\n  const handleAddRemoteModel = () => {"),
 ('      {/* Show Error Snackbar only if no dialog is visible */}', "      <View style={{paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center'}}>\n        <View style={{flex: 1}}><Text>Wake listening preference (OFF by default)</Text><Text>Audio wake detection not connected yet.</Text></View>\n        <Switch value={modelStore.wakeListeningEnabled} onValueChange={value => { void setWakePreference(value); }} />\n      </View>\n      {/* Show Error Snackbar only if no dialog is visible */}")]
for old,new in changes:
    if new in s: continue
    if old not in s: raise RuntimeError('Missing UI anchor: '+old[:60])
    s=s.replace(old,new,1)
p.write_text(s)
print('Applied #27 preference controls')
