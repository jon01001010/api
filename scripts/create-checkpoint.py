#!/usr/bin/env python3
"""Create an immutable source/report pair named in Vancouver local time."""
import argparse
from datetime import datetime
import hashlib
from pathlib import Path
import subprocess
import zipfile
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
out = args.output.resolve()
if out == repo or repo in out.parents:
    parser.error('Output must be outside the source tree')
out.mkdir(parents=True, exist_ok=True)
now = datetime.now(ZoneInfo('America/Vancouver'))
stem = now.strftime('api-helper_%Y-%m-%d_%H-%M-%S_PT')
archive = out / (stem + '_source.zip')
report = out / (stem + '_progress.md')
if archive.exists() or report.exists():
    parser.error('Checkpoint already exists; wait one second and retry')
files = subprocess.check_output(
    ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=repo
).decode().split('\0')
required = {'.github/workflows/api-helper-diagnostic.yml',
            'scripts/build-api-helper-npu.sh', 'scripts/prepare-diagnostic-config.py'}
missing = required - set(files)
if missing:
    parser.error('Required build files excluded from checkpoint: ' + ', '.join(sorted(missing)))
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(set(filter(None, files))):
        path = repo / name
        if path.is_symlink():
            raise RuntimeError(f'Review symlink before archiving: {name}')
        if path.is_file():
            z.write(path, 'api-helper/' + name)
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
with report.open('x') as f:
    f.write(f'# Checkpoint {stem}\n\nCreated: {now.isoformat()} (America/Vancouver).\n\n')
    f.write(f'Source: `{archive.name}`\n\nSHA-256: `{sha}`\n\n')
    f.write((repo / 'docs' / 'security-notes.md').read_text())
print(archive)
print(report)
