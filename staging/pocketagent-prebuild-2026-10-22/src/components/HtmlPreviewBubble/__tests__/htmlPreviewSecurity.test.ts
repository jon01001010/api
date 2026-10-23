import {readFileSync} from 'fs';
import {join} from 'path';

const source = readFileSync(join(__dirname, '../HtmlPreviewBubble.tsx'), 'utf8');

describe('generated HTML preview boundaries', () => {
  it('does not run scripts in collapsed previews', () => {
    expect(source).toMatch(/source=\{\{html: wrappedHtml, baseUrl: 'about:blank'\}\}[\s\S]*?javaScriptEnabled=\{false\}/);
  });
  it('runs scripts only in expanded previews', () => {
    expect(source).toMatch(/source=\{\{html: interactiveHtml, baseUrl: 'about:blank'\}\}[\s\S]*?javaScriptEnabled=\{true\}/);
  });
  it('uses separate static and interactive policies', () => {
    expect(source).toContain('STATIC_CSP');
    expect(source).toContain('INTERACTIVE_CSP');
    expect(source).toContain("script-src 'none'");
    expect(source).toContain("script-src 'unsafe-inline'");
  });
  it('blocks network, navigation, and privileged access', () => {
    expect(source).toContain("connect-src 'none'");
    expect(source).toContain("frame-src 'none'");
    expect(source).toContain("form-action 'none'");
    expect(source).toContain('allowFileAccess={false}');
    expect(source).toContain("onShouldStartLoadWithRequest={req => req.url === 'about:blank'}");
    expect(source).toContain('setSupportMultipleWindows={false}');
  });
});
