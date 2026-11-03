#!/usr/bin/env python3
"""Dry-run-first PocketAgent staged integration; never commits or starts paid Actions.
Usage: python3 integrate.py /path/to/repo [--apply]
"""
import argparse, pathlib, shutil, subprocess, tempfile, json, sys
p=argparse.ArgumentParser();p.add_argument('repo');p.add_argument('--apply',action='store_true');a=p.parse_args()
repo=pathlib.Path(a.repo).resolve();kit=pathlib.Path(__file__).resolve().parent
if not (repo/'package.json').is_file() or not (repo/'android').is_dir():sys.exit('Not a PocketAgent checkout: package.json and android/ required')
patches=sorted((kit/'patches').glob('apply-*.py'))
# Do not auto-apply conflicting UI/native patches; use explicit allowlist after review.
allow=['apply-17-url-security.py','apply-18-tool-audit.py','apply-21-native-completion-notification.py','apply-22-loop-limits.py','apply-23-agent-timers.py','apply-24-agent-pause.py','apply-27-wake-listening-controls.py','apply-29-single-recommendation.py','apply-30-hardware-advice.py','apply-31-acceleration-advice.py','apply-33-thermal-policy.py','apply-38-interactive-preview.py']
report={'mode':'apply' if a.apply else 'dry-run','copied':[],'patches':[],'errors':[],'warnings':[]}
with tempfile.TemporaryDirectory() as td:
 work=pathlib.Path(td)/'repo'
 # Only copy files referenced by patchers plus minimal source tree; copy repo in full for correctness.
 shutil.copytree(repo,work,ignore=shutil.ignore_patterns('.git','node_modules','build','.gradle','.cxx'))
 for f in sorted((kit/'src').rglob('*')):
  if not f.is_file():continue
  dest=work/f.relative_to(kit)
  if dest.exists():
   if dest.read_bytes()!=f.read_bytes():
    report['warnings'].append('Existing source differs; NOT overwritten: '+str(f.relative_to(kit)))
   continue
  dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,dest);report['copied'].append(str(f.relative_to(kit)))
 for name in allow:
  patch=kit/'patches'/name
  if not patch.exists():continue
  r=subprocess.run([sys.executable,str(patch)],cwd=work,text=True,capture_output=True,timeout=25)
  report['patches'].append({'name':name,'ok':r.returncode==0,'detail':(r.stdout+r.stderr)[-350:]})
  if r.returncode:report['errors'].append(name)
 if a.apply:
  if report['errors']:
   report['warnings'].append('Not applying: one or more patches failed in dry-run checkout')
  else:
   # Copy only staged additions and files modified by the allowlisted patchers.
   changed=[]
   for f in work.rglob('*'):
    if not f.is_file():continue
    rel=f.relative_to(work);original=repo/rel
    if not original.exists() or original.read_bytes()!=f.read_bytes():changed.append((f,original))
   for f,dest in changed:dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,dest)
   report['applied_file_count']=len(changed)
print(json.dumps(report,indent=2))
if report['errors']:sys.exit(2)
