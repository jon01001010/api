#!/usr/bin/env python3
"""Apply PocketAgent HTML fullscreen JS fix; fail on unexpected source."""
from pathlib import Path
p=Path('src/components/HtmlPreviewBubble/HtmlPreviewBubble.tsx')
s=p.read_text()
old='// Generated HTML is untrusted. Both previews are static; no model-authored JS.\nconst CSP =\n  "default-src \'none\'; style-src \'unsafe-inline\'; script-src \'none\'; img-src data:; font-src data:; base-uri \'none\'; form-action \'none\'; frame-src \'none\'; object-src \'none\'";'
new='// Generated HTML is untrusted. Inline previews are static; fullscreen is interactive.\nconst STATIC_CSP =\n  "default-src \'none\'; style-src \'unsafe-inline\'; script-src \'none\'; img-src data:; font-src data:; base-uri \'none\'; form-action \'none\'; frame-src \'none\'; object-src \'none\'";\nconst INTERACTIVE_CSP =\n  "default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-src \'none\'; object-src \'none\'";'
if old not in s and 'const INTERACTIVE_CSP' not in s: raise SystemExit('Unexpected CSP source; no changes made')
s=s.replace(old,new)
s=s.replace('const HEAD_INJECTION = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />','const headInjection = (interactive: boolean) => `<meta http-equiv="Content-Security-Policy" content="${interactive ? INTERACTIVE_CSP : STATIC_CSP}" />')
s=s.replace('export function wrapDocument(html: string): string {','export function wrapDocument(html: string, interactive = false): string {')
s=s.replace('${HEAD_INJECTION}${FRAGMENT_STYLES}', '${headInjection(interactive)}${FRAGMENT_STYLES}')
s=s.replace('  const wrappedHtml = useMemo(() => wrapDocument(html), [html]);','  const wrappedHtml = useMemo(() => wrapDocument(html), [html]);\n  const interactiveHtml = useMemo(() => wrapDocument(html, true), [html]);')
old="source={{html: wrappedHtml, baseUrl: 'about:blank'}}\n                javaScriptEnabled={false}"
new="source={{html: interactiveHtml, baseUrl: 'about:blank'}}\n                javaScriptEnabled={true}"
if old not in s and new not in s: raise SystemExit('Unexpected fullscreen WebView; no changes made')
s=s.replace(old,new)
if 'const INTERACTIVE_CSP' not in s or 'source={{html: interactiveHtml' not in s: raise SystemExit('Patch failed validation')
p.write_text(s)
print('HTML preview fix applied')
