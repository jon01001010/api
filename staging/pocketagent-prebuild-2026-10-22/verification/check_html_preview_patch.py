#!/usr/bin/env python3
"""Offline regression check for the HTML preview patch against a source fixture."""
from pathlib import Path
import subprocess, sys, tempfile
patch = Path(__file__).resolve().parents[1] / 'patches/apply-38-interactive-preview.py'
fixture = '''// Generated HTML is untrusted. Both previews are static; no model-authored JS.
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
const HEAD_INJECTION = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />
export function wrapDocument(html: string): string {
return `${HEAD_INJECTION}${FRAGMENT_STYLES}`;
}
  const wrappedHtml = useMemo(() => wrapDocument(html), [html]);
source={{html: wrappedHtml, baseUrl: 'about:blank'}}
            javaScriptEnabled={false}
source={{html: wrappedHtml, baseUrl: 'about:blank'}}
                javaScriptEnabled={false}
'''
with tempfile.TemporaryDirectory() as d:
    root=Path(d); dest=root/'src/components/HtmlPreviewBubble/HtmlPreviewBubble.tsx'; dest.parent.mkdir(parents=True); dest.write_text(fixture)
    result=subprocess.run([sys.executable,str(patch)],cwd=root,capture_output=True,text=True)
    assert result.returncode == 0, result.stdout+result.stderr
    out=dest.read_text()
    assert "script-src 'none'" in out and "script-src 'unsafe-inline'" in out
    assert "connect-src 'none'" in out and "default-src 'none'" in out
    assert "source={{html: wrappedHtml, baseUrl: 'about:blank'}}\n            javaScriptEnabled={false}" in out
    assert "source={{html: interactiveHtml, baseUrl: 'about:blank'}}\n                javaScriptEnabled={true}" in out
    assert 'wrapDocument(html, true)' in out
    print('PASS: #38 patch enables fullscreen JS while keeping inline JS disabled and CSP network blocked')
