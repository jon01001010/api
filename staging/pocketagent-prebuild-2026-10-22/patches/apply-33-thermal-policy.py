#!/usr/bin/env python3
from pathlib import Path
import shutil
root=Path(__file__).resolve().parent.parent
for rel in ['src/utils/inferenceThermalPolicy.ts','src/utils/__tests__/inferenceThermalPolicy.test.ts']:
    target=Path.cwd()/rel
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(root/rel,target)
    print('Installed',rel)
