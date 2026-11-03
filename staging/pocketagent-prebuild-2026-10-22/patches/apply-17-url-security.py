#!/usr/bin/env python3
# Fail-closed patch
from pathlib import Path
p=Path('src/services/talents/ReadUrlEngine.ts')
s=p.read_text()
if "validatePublicWebUrl" in s:
 print('Already applied');raise SystemExit(0)
anchor="import {allowReadUrls, extractUrls, matchReadUrl} from './readUrlAllowlist';"
replacement=anchor+"\nimport {validatePublicWebUrl} from '../security/safeWebUrl';"
start=s.index('/**\n * Reject non-http(s) schemes')
end=s.index('const MAX_PAGE_LINKS = 100;',start)
old=s[start:end]
new='/** Public URL preflight; network layer must also validate DNS and redirects. */\nconst isAllowedReadUrl = (raw: string): boolean => validatePublicWebUrl(raw) !== null;\n\n'
needle='''    const provider = this.access.getActiveProvider();

    let page: PageContent;'''
replace='''    // The allowlist may contain links from untrusted search/page content.
    // Validate the resolved target too, not just the model-supplied URL.
    if (!isAllowedReadUrl(targetUrl)) {
      const summary = 'read_url: blocked unsafe target URL';
      return {type: 'error', summary, errorMessage: summary};
    }
    const provider = this.access.getActiveProvider();

    let page: PageContent;'''
links='''    const links = extractUrls(bounded.text).slice(0, MAX_PAGE_LINKS);
    allowReadUrls(links);'''
links_new='''    const links = extractUrls(bounded.text)
      .filter(link => validatePublicWebUrl(link) !== null)
      .slice(0, MAX_PAGE_LINKS);
    allowReadUrls(links);'''
for a,b in [(anchor,replacement),(old,new),(needle,replace),(links,links_new)]:
 if s.count(a)!=1:raise SystemExit('Unexpected source; no patch applied: '+a[:70])
 s=s.replace(a,b,1)
p.write_text(s)
print('ReadUrlEngine URL preflight integrated')
