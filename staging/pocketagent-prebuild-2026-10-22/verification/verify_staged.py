#!/usr/bin/env python3
from pathlib import Path
p=Path(__file__).resolve().parent.parent
required=['src/services/agent/modelHandoffPolicy.ts','src/utils/startupExperiencePolicy.ts',
'src/services/agent/__tests__/modelHandoffPolicy.test.ts','src/utils/__tests__/startupExperiencePolicy.test.ts',
'patches/apply-38-interactive-preview.py','verification/PHONE_ACCEPTANCE.md']
for item in required:
 assert (p/item).is_file(), item
handoff=(p/required[0]).read_text();startup=(p/required[1]).read_text()
assert 'userApprovedRemote' in handoff and 'fileSharingApproved' in handoff and 'activeToolCall' in handoff
assert 'listening: false' in startup and "'model-picker'" in startup
print('PASS: staged content and safety invariants present (not Android integration tests)')
