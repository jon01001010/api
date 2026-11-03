#!/usr/bin/env python3
from pathlib import Path
files={
'android/app/src/main/java/com/pocketpal/MainApplication.kt': [('add(BackgroundInferencePackage())','add(BackgroundInferencePackage())\n              add(VoiceInputPackage())')],
'android/app/src/main/AndroidManifest.xml': [('<uses-permission android:name="android.permission.CAMERA" />','<uses-permission android:name="android.permission.CAMERA" />\n    <uses-permission android:name="android.permission.RECORD_AUDIO" />')],
'src/components/ChatInput/ChatInput.tsx': [
("import {SendButton, StopButton, Menu, VoiceChip} from '..';", "import {SendButton, StopButton, Menu, VoiceChip} from '..';\nimport {transcribeOnce} from '../../utils/voiceInput';"),
("    const handleSend = () => {", "    const [voiceBusy, setVoiceBusy] = React.useState(false);\n    const handleVoiceInput = async () => {\n      if (voiceBusy) return;\n      setVoiceBusy(true);\n      try {\n        const words = await transcribeOnce();\n        if (words) handleChangeText(value ? `${value} ${words}` : words);\n      } catch (e) {\n        Alert.alert('Voice input', e instanceof Error ? e.message : String(e));\n      } finally {\n        setVoiceBusy(false);\n      }\n    };\n\n    const handleSend = () => {"),
("    // Handle plus button press to show image upload menu", "    // Voice input is deliberately push-to-talk and never auto-sends.\n    // Handle plus button press to show image upload menu")
]
}
# Add mic button alongside the already existing VoiceChip so placement is stable.
p=Path('src/components/ChatInput/ChatInput.tsx');s=p.read_text()
if 'onPress={handleVoiceInput}' not in s:
    needle='<VoiceChip'
    if needle not in s: raise SystemExit('VoiceChip anchor missing')
    files[str(p)].append((needle, '<IconButton icon="microphone" accessibilityLabel="Dictate message" disabled={voiceBusy} onPress={handleVoiceInput} />\n          '+needle))
updated={}
for path,changes in files.items():
 p=Path(path);s=p.read_text()
 for old,new in changes:
  new=new.replace('\n','\n')
  if new in s: continue
  if s.count(old)!=1: raise SystemExit(f'Unexpected anchor in {path}: {old[:65]}')
  s=s.replace(old,new,1)
 updated[p]=s
for p,s in updated.items():p.write_text(s)
print('Applied voice input wiring')
