#!/usr/bin/env python3
from pathlib import Path
app=Path('android/app/src/main/java/com/pocketpalai/MainApplication.kt')
manifest=Path('android/app/src/main/AndroidManifest.xml')
screen=Path('src/screens/ToolboxScreen.tsx')
a=app.read_text();m=manifest.read_text();s=screen.read_text()
if 'add(AgentTimerPackage())' in a: print('Already applied');raise SystemExit(0)
assert a.count('add(BackgroundInferencePackage())')==1
assert m.count('        <!-- Optional native library for OpenCL')==1
assert s.count("import Slider from '@react-native-community/slider';")==1
assert s.count('  const [agentMaxTurns, setAgentMaxTurns] = useState(20);')==1
assert s.count('        <Text variant="titleMedium">Agent loop limits</Text>')==1
a=a.replace('add(BackgroundInferencePackage())','add(BackgroundInferencePackage())\n              add(AgentTimerPackage())'.replace('\n','\n'))
m=m.replace('        <!-- Optional native library for OpenCL', '        <receiver android:name="com.pocketpal.AgentTimerReceiver" android:exported="false" />\n        <!-- Optional native library for OpenCL'.replace('\n','\n'))
s=s.replace("import Slider from '@react-native-community/slider';", "import Slider from '@react-native-community/slider';\nimport {scheduleAgentTimer, cancelAgentTimer} from '../utils/agentTimer';".replace('\n','\n'))
s=s.replace('  const [agentMaxTurns, setAgentMaxTurns] = useState(20);','''  const [agentMaxTurns, setAgentMaxTurns] = useState(20);
  const [timerMinutes, setTimerMinutes] = useState(5);
  const [timerStatus, setTimerStatus] = useState('');''')
s=s.replace('        <Text variant="titleMedium">Agent loop limits</Text>', '''        <Text variant="titleMedium">Timer notification</Text>
        <Text variant="bodyMedium">Notify me in {timerMinutes} minutes</Text>
        <Slider minimumValue={1} maximumValue={120} step={1} value={timerMinutes}
          onValueChange={setTimerMinutes} />
        <View style={{flexDirection: 'row'}}>
          <Button onPress={() => scheduleAgentTimer(timerMinutes * 60)
            .then(() => setTimerStatus('Timer scheduled (approximate delivery)'))
            .catch(e => setTimerStatus(String(e)))}>Start timer</Button>
          <Button onPress={() => cancelAgentTimer()
            .then(() => setTimerStatus('Timer cancelled'))
            .catch(e => setTimerStatus(String(e)))}>Cancel timer</Button>
        </View>
        <Text variant="bodySmall">{timerStatus}</Text>
        <Text variant="bodySmall">One timer at a time; Android may delay alerts to save battery.</Text>
        <Text variant="titleMedium">Agent loop limits</Text>''')
app.write_text(a);manifest.write_text(m);screen.write_text(s)
print('Integrated native timer, manifest receiver and Toolbox controls')
