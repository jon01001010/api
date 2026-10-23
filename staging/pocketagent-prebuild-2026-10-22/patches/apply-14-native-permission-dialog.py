#!/usr/bin/env python3
'''Apply #14 human permission dialog integration after agent guards and hook.'''
from pathlib import Path
p=Path('src/hooks/useChatSession.ts')
s=p.read_text()
if 'permissionGate: humanPermissionGate' in s:
    print('Already applied');raise SystemExit(0)
a="import React, {useRef} from 'react';"
b=a+"\nimport {ToolPermissionGate} from '../services/permissions/ToolPermissionGate';\nimport {ToolPermissionPolicy} from '../services/permissions/ToolPermissionPolicy';\nimport {askNativeToolPermission} from '../services/permissions/NativeToolPermissionPrompt';"
c="      const events = runAgent({"
d="      // Per-run policy: permissions never survive a new run or app restart.\n      const humanPermissionGate = new ToolPermissionGate(\n        new ToolPermissionPolicy(), askNativeToolPermission,\n      );\n      const events = runAgent({"
e="        signal: lease.signal,\n      });"
f="        signal: lease.signal,\n        permissionGate: humanPermissionGate,\n      });"
for old,new in [(a,b),(c,d),(e,f)]:
    if s.count(old)!=1:raise SystemExit('Unexpected source anchor; nothing written: '+repr(old[:65]))
    s=s.replace(old,new,1)
p.write_text(s)
print('Connected native approval dialog to agent runs')
