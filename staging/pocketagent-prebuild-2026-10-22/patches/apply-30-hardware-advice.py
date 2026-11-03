#!/usr/bin/env python3
from pathlib import Path
p = Path('src/screens/ModelsScreen/ModelsScreen.tsx')
s = p.read_text()
if '<ModelHardwareAdvice />' in s:
    print('Already applied'); raise SystemExit(0)
needle = "import {useTheme} from '../../hooks';"
assert s.count(needle) == 1, 'ModelsScreen import location changed'
s = s.replace(needle, needle + "\nimport {ModelHardwareAdvice} from '../../components/ModelHardwareAdvice';")
needle = '      <FlatList\n        testID="flat-list"'
assert s.count(needle) == 1, 'ModelsScreen list location changed'
s = s.replace(needle, '      <ModelHardwareAdvice />\n' + needle)
p.write_text(s)
print('Hardware advice added to Models screen')
