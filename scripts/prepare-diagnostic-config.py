#!/usr/bin/env python3
"""Create diagnostic service placeholders without overwriting existing configuration."""
import json
from pathlib import Path
repo = Path(__file__).resolve().parents[1]
config = repo / 'android/app/google-services.json'
env = repo / '.env'
if config.exists() or env.exists():
    raise SystemExit('Existing configuration found; preserve it and prepare diagnostic config separately.')
config.write_text(json.dumps({
    'project_info': {'project_number': '000000000000', 'project_id': 'api-helper-diagnostic'},
    'client': [{
        'client_info': {'mobilesdk_app_id': '1:000000000000:android:0000000000000000',
                        'android_client_info': {'package_name': 'org.apihelper.local'}},
        'api_key': [{'current_key': 'diagnostic-placeholder-not-a-service-key'}]
    }]
}))
env.write_text('ENABLE_PALSHUB_INTEGRATION=false\nENABLE_AUTHENTICATION=false\nENABLE_OFFLINE_MODE=true\n')
print('Diagnostic placeholders created; optional cloud services are not configured.')
