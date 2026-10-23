#!/usr/bin/env python3
"""Make native completion notification permission-aware, safe on API 33+."""
from pathlib import Path
p=Path('android/app/src/main/java/com/pocketpalai/BackgroundInferenceModule.kt')
s=p.read_text()
marker='// #21 permission-aware completion notification'
if marker in s:
    print('Already applied');raise SystemExit(0)
old='''            if (completedInBackground && Build.VERSION.SDK_INT >= 26) {'''
new='''            // #21 permission-aware completion notification
            val mayNotify = Build.VERSION.SDK_INT < 33 ||
                context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED
            if (completedInBackground && mayNotify && Build.VERSION.SDK_INT >= 26) {'''
assert s.count(old)==1, 'Unexpected native module source; no change'
s=s.replace(old,new,1)
p.write_text(s)
print('Patched',p)
