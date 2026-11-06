import {neutralizeFrameTags, PREVIEW_GUARD_SCRIPT} from '../sandboxGuard';
import {wrapDocument} from '../HtmlPreviewBubble';

describe('HTML preview lock: no WebRTC, frames or pop-ups', () => {
  it('renames every frame tag, whatever the case', () => {
    const out = neutralizeFrameTags(
      '<iframe src=x></iframe><IFRAME/><frame><frameset></frameset><object></object><embed><portal></portal><fencedframe></fencedframe>',
    );
    expect(out).not.toMatch(
      /<\/?(iframe|frame|frameset|object|embed|portal|fencedframe)[\s/>]/i,
    );
    expect(out).toContain('<blocked-iframe src=x></blocked-iframe>');
  });

  it('leaves look-alike tags and normal markup alone', () => {
    const html =
      '<iframes-list></iframes-list><p>an iframe word</p><div>x</div>';
    expect(neutralizeFrameTags(html)).toBe(html);
  });

  it('runs the guard before any page markup, right after the CSP', () => {
    const doc = wrapDocument('<script>evil()</script><iframe></iframe>');
    const csp = doc.indexOf('Content-Security-Policy');
    const guard = doc.indexOf('data-preview-guard');
    const page = doc.indexOf('evil()');
    expect(csp).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(csp);
    expect(page).toBeGreaterThan(guard);
    expect(doc).not.toContain('<iframe>');
  });

  it('locks WebRTC, pop-ups and frame access', () => {
    expect(PREVIEW_GUARD_SCRIPT).toContain("'RTCPeerConnection'");
    expect(PREVIEW_GUARD_SCRIPT).toContain('configurable: false');
    expect(PREVIEW_GUARD_SCRIPT).toContain("'open'");
    expect(PREVIEW_GUARD_SCRIPT).toContain('contentWindow');
    expect(PREVIEW_GUARD_SCRIPT).toContain('MutationObserver');
  });
});
