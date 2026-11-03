#!/usr/bin/env python3
# Run after guard patch; optional UI permission callback.
from pathlib import Path
p=Path('src/services/agent/AgentRunner.ts');s=p.read_text()
if 'permissionGate?: ToolPermissionGate' in s: print('Already applied');raise SystemExit(0)
changes=[
("import {validateToolArguments} from './ToolArgumentValidator';", "import {validateToolArguments} from './ToolArgumentValidator';\nimport type {ToolPermissionGate} from '../permissions/ToolPermissionGate';"),
('  guard?: GuardedToolExecution,\n): Promise<AgentToolOutcome> {','  guard?: GuardedToolExecution,\n  permissionGate?: ToolPermissionGate,\n): Promise<AgentToolOutcome> {'),
('  try {\n    const action = () => signal', '''  if (permissionGate && !(await permissionGate.authorize(fnName, signal))) {
    const summary = `Permission denied for ${fnName}`;
    const result: TalentResult = {type: 'error', summary, errorMessage: summary};
    return {callId, toolName: fnName, result, responseContent: summary};
  }

  try {
    const action = () => signal'''),
('          guardedExecution,\n        );','          guardedExecution,\n          options.permissionGate,\n        );'),
]
for old,new in changes:
 old=old.replace('\\n','\n');new=new.replace('\\n','\n')
 if s.count(old)!=1:raise SystemExit(f'Unexpected source anchor: {old[:80]!r}; no changes written')
 s=s.replace(old,new,1)
p.write_text(s)
t=Path('src/services/agent/AgentRunner.types.ts');v=t.read_text()
if 'permissionGate?: ToolPermissionGate' not in v:
 anchor="import type {TalentEngine} from '../talents/types';"
 if v.count(anchor)!=1:raise SystemExit('Unexpected types source')
 v=v.replace(anchor,anchor+"\nimport type {ToolPermissionGate} from '../permissions/ToolPermissionGate';")
 anchor='  signal?: AbortSignal;'
 if v.count(anchor)!=1:raise SystemExit('Unexpected options signal')
 v=v.replace(anchor,anchor+"\n  /** Optional user-facing permission gate; supply only with a real UI prompt. */\n  permissionGate?: ToolPermissionGate;")
 t.write_text(v)
print('Added optional human permission hook; UI wiring remains required')
