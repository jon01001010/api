#!/usr/bin/env python3
from pathlib import Path
p=Path('src/screens/ModelsScreen/ModelsScreen.tsx')
s=p.read_text()
if '<AccelerationAdvice />' in s:
    print('Already applied'); raise SystemExit(0)
needle="import {useTheme} from '../../hooks';"
assert s.count(needle)==1, 'ModelsScreen imports changed'
s=s.replace(needle,needle+"\nimport {AccelerationAdvice} from '../../components/AccelerationAdvice';")
needle='      <FlatList\n        testID="flat-list"'
assert s.count(needle)==1, 'ModelsScreen list changed'
s=s.replace(needle,'      <AccelerationAdvice />\n'+needle)
p.write_text(s)
print('Added backend detection panel')
