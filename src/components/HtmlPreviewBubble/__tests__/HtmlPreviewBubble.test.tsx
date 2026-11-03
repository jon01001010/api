import React from 'react';
import Clipboard from '@react-native-clipboard/clipboard';

import {act, fireEvent, render} from '../../../../jest/test-utils';
import {
  CSP,
  HtmlPreviewBubble,
  LOAD_TIMEOUT_MS,
  referencesRemoteResources,
  wrapDocument,
} from '../HtmlPreviewBubble';

let mockIsFocused = true;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => mockIsFocused,
}));

describe('HtmlPreviewBubble', () => {
  const html = '<p>hello</p>';

  it('renders the collapsed bubble with the provided title', () => {
    const {getByText, getByTestId} = render(
      <HtmlPreviewBubble html={html} title="My Preview" />,
      {withNavigation: true},
    );
    expect(getByTestId('html-preview-bubble')).toBeTruthy();
    expect(getByTestId('html-preview-bubble-collapsed')).toBeTruthy();
    expect(getByText('My Preview')).toBeTruthy();
  });

  it('falls back to "Preview" when title is missing or empty', () => {
    const {getByText, rerender} = render(<HtmlPreviewBubble html={html} />, {
      withNavigation: true,
    });
    expect(getByText('Preview')).toBeTruthy();

    rerender(<HtmlPreviewBubble html={html} title="" />);
    expect(getByText('Preview')).toBeTruthy();
  });

  it('wraps html in a CSP document and runs it sandboxed in the in-row preview', () => {
    const {getByTestId} = render(
      <HtmlPreviewBubble html={html} title="CSP Test" />,
      {withNavigation: true},
    );
    const webview = getByTestId('html-preview-webview');
    // The mock WebView (see __mocks__/external/react-native-webview.ts) forwards
    // all props onto the underlying View, so we can inspect them directly.
    const source = webview.props.source;
    expect(source.baseUrl).toBe('about:blank');
    expect(typeof source.html).toBe('string');
    expect(source.html).toContain('http-equiv="Content-Security-Policy"');
    expect(source.html).toContain("default-src 'none'");
    expect(source.html).toContain('img-src data:');
    expect(source.html).toContain(html);
    expect(source.html).toContain("connect-src 'none'");
    // Model-authored scripts run so clocks/timers/games work...
    expect(webview.props.javaScriptEnabled).toBe(true);
    // ...but with no bridge into the app, no popups, no file access and
    // nothing persisted between previews.
    expect(webview.props.onMessage).toBeUndefined();
    expect(webview.props.injectedJavaScript).toBeUndefined();
    expect(webview.props.injectedJavaScriptBeforeContentLoaded).toBeUndefined();
    expect(webview.props.javaScriptCanOpenWindowsAutomatically).toBe(false);
    expect(webview.props.setSupportMultipleWindows).toBe(false);
    expect(webview.props.originWhitelist).toEqual(['*']);
    expect(webview.props.allowFileAccess).toBe(false);
    expect(webview.props.allowFileAccessFromFileURLs).toBe(false);
    expect(webview.props.allowUniversalAccessFromFileURLs).toBe(false);
    expect(webview.props.geolocationEnabled).toBe(false);
    expect(webview.props.incognito).toBe(true);
    expect(webview.props.cacheEnabled).toBe(false);
    expect(webview.props.mixedContentMode).toBe('never');
    // Initial about:blank load is allowed; any other navigation is blocked.
    expect(
      webview.props.onShouldStartLoadWithRequest({url: 'about:blank'}),
    ).toBe(true);
    expect(
      webview.props.onShouldStartLoadWithRequest({url: 'https://evil.com'}),
    ).toBe(false);
  });

  it('opens the fullscreen modal on press and closes it via the close button', () => {
    // In the jest RN mock, <Modal> renders its children only while visible.
    const {getByTestId, queryByTestId} = render(
      <HtmlPreviewBubble html={html} title="Modal Test" />,
      {withNavigation: true},
    );

    // Modal content is not visible initially.
    expect(queryByTestId('html-preview-modal-close')).toBeNull();
    expect(queryByTestId('html-preview-modal-webview')).toBeNull();

    fireEvent.press(getByTestId('html-preview-bubble-collapsed'));

    const closeBtn = getByTestId('html-preview-modal-close');
    expect(closeBtn).toBeTruthy();
    const modalWebView = getByTestId('html-preview-modal-webview');
    expect(modalWebView.props.javaScriptEnabled).toBe(true);
    expect(modalWebView.props.onMessage).toBeUndefined();
    expect(modalWebView.props.source.baseUrl).toBe('about:blank');
    expect(
      modalWebView.props.onShouldStartLoadWithRequest({url: 'https://x.test'}),
    ).toBe(false);
    // Only one live copy: the in-row page is stopped while fullscreen.
    expect(queryByTestId('html-preview-webview')).toBeNull();
    expect(getByTestId('html-preview-paused')).toBeTruthy();

    fireEvent.press(closeBtn);
    expect(queryByTestId('html-preview-modal-close')).toBeNull();
    expect(getByTestId('html-preview-webview')).toBeTruthy();
  });

  it('stops the page while the chat screen is not focused', () => {
    mockIsFocused = false;
    const {getByTestId, queryByTestId} = render(
      <HtmlPreviewBubble html={html} />,
      {withNavigation: true},
    );
    expect(queryByTestId('html-preview-webview')).toBeNull();
    expect(getByTestId('html-preview-paused')).toBeTruthy();
    mockIsFocused = true;
  });

  it('shows an error with a View code button when the page fails', () => {
    const {getByTestId, queryByTestId} = render(
      <HtmlPreviewBubble html={html} />,
      {withNavigation: true},
    );
    act(() => {
      getByTestId('html-preview-webview').props.onError();
    });
    expect(queryByTestId('html-preview-webview')).toBeNull();
    expect(getByTestId('html-preview-webview-error')).toBeTruthy();
    fireEvent.press(getByTestId('html-preview-webview-error-view-code'));
    expect(getByTestId('html-preview-code')).toBeTruthy();
    // Back to preview retries the page.
    fireEvent.press(getByTestId('html-preview-toggle-code'));
    expect(getByTestId('html-preview-webview')).toBeTruthy();
  });

  it('shows the error state if the renderer crashes', () => {
    const {getByTestId} = render(<HtmlPreviewBubble html={html} />, {
      withNavigation: true,
    });
    act(() => {
      getByTestId('html-preview-webview').props.onRenderProcessGone();
    });
    expect(getByTestId('html-preview-webview-error')).toBeTruthy();
  });

  describe('load timeout', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('shows the error state when the page never finishes loading', () => {
      const {getByTestId, queryByTestId} = render(
        <HtmlPreviewBubble html={html} />,
        {withNavigation: true},
      );
      act(() => {
        jest.advanceTimersByTime(LOAD_TIMEOUT_MS + 1);
      });
      expect(queryByTestId('html-preview-webview')).toBeNull();
      expect(getByTestId('html-preview-webview-error')).toBeTruthy();
    });

    it('does not time out once the page has loaded', () => {
      const {getByTestId, queryByTestId} = render(
        <HtmlPreviewBubble html={html} />,
        {withNavigation: true},
      );
      act(() => {
        getByTestId('html-preview-webview').props.onLoadEnd();
        jest.advanceTimersByTime(LOAD_TIMEOUT_MS + 1);
      });
      expect(getByTestId('html-preview-webview')).toBeTruthy();
      expect(queryByTestId('html-preview-webview-error')).toBeNull();
    });
  });

  it('notes when the page references blocked internet resources', () => {
    const {queryByTestId, rerender} = render(
      <HtmlPreviewBubble html={html} />,
      {withNavigation: true},
    );
    expect(queryByTestId('html-preview-remote-note')).toBeNull();
    rerender(
      <HtmlPreviewBubble html='<script src="https://cdn.example/x.js"></script>' />,
    );
    expect(queryByTestId('html-preview-remote-note')).toBeTruthy();
  });

  it('copies the raw HTML (not the wrapped document) on copy press', () => {
    const setStringSpy = jest.spyOn(Clipboard, 'setString');
    const {getByTestId} = render(
      <HtmlPreviewBubble html={html} title="Copy Test" />,
      {withNavigation: true},
    );

    // Collapsed-header copy button
    fireEvent.press(getByTestId('html-preview-copy'));
    expect(setStringSpy).toHaveBeenLastCalledWith(html);

    // Fullscreen-modal copy button copies the same raw html
    fireEvent.press(getByTestId('html-preview-bubble-collapsed'));
    fireEvent.press(getByTestId('html-preview-modal-copy'));
    expect(setStringSpy).toHaveBeenLastCalledWith(html);
    expect(setStringSpy).toHaveBeenCalledTimes(2);

    setStringSpy.mockRestore();
  });

  it('toggles between rendered preview and raw HTML code', () => {
    const {getByTestId, queryByTestId} = render(
      <HtmlPreviewBubble html={html} title="Toggle Test" />,
      {withNavigation: true},
    );

    // Preview is shown by default.
    expect(getByTestId('html-preview-webview')).toBeTruthy();
    expect(queryByTestId('html-preview-code')).toBeNull();

    fireEvent.press(getByTestId('html-preview-toggle-code'));

    expect(getByTestId('html-preview-code')).toBeTruthy();
    expect(queryByTestId('html-preview-webview')).toBeNull();

    fireEvent.press(getByTestId('html-preview-toggle-code'));

    expect(getByTestId('html-preview-webview')).toBeTruthy();
    expect(queryByTestId('html-preview-code')).toBeNull();
  });
});

it('installs the CSP before hostile comment and document markup', () => {
  const hostile =
    '<!-- <head> --><html><head></head><script>fetch("https://example.invalid")</script>';
  const document = wrapDocument(hostile);
  expect(document.indexOf('Content-Security-Policy')).toBeLessThan(
    document.indexOf(hostile),
  );
  expect(document).toContain("connect-src 'none'");
  expect(document).toContain("form-action 'none'");
});

describe('preview sandbox policy', () => {
  const directives = Object.fromEntries(
    CSP.split(';').map(d => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );

  it('allows only inline scripts and styles', () => {
    expect(directives['script-src']).toEqual([
      "'unsafe-inline'",
      "'unsafe-eval'",
    ]);
    expect(directives['style-src']).toEqual(["'unsafe-inline'"]);
  });

  it('closes every network path', () => {
    expect(directives['default-src']).toEqual(["'none'"]);
    for (const name of [
      'connect-src',
      'frame-src',
      'child-src',
      'worker-src',
      'object-src',
      'form-action',
      'base-uri',
      'manifest-src',
    ]) {
      expect(directives[name]).toEqual(["'none'"]);
    }
    // No source anywhere may name a scheme that reaches the network.
    expect(CSP).not.toMatch(/https?:|wss?:|\*/);
  });
});

describe('referencesRemoteResources', () => {
  it.each([
    '<script src="https://cdn.example/a.js"></script>',
    "<link href='//fonts.example/css' rel=stylesheet>",
    '<img src=http://x.example/a.png>',
    '<style>@import url("https://x.example/a.css")</style>',
  ])('flags %s', h => expect(referencesRemoteResources(h)).toBe(true));

  it.each([
    '<p>hi</p>',
    '<img src="data:image/png;base64,AAAA">',
    '<a href="#top">top</a>',
    '<script>const u = "https://not-a-src";</script>',
  ])('ignores %s', h => expect(referencesRemoteResources(h)).toBe(false));
});

describe('preview page colours', () => {
  it('starts every page white with dark text, like a browser', () => {
    const doc = wrapDocument('<p>hi</p>');
    expect(doc).toMatch(
      /html, body \{[^}]*background: #ffffff;[^}]*color: #111111;/,
    );
    expect(doc).toContain('color-scheme: light');
    expect(doc).not.toContain('prefers-color-scheme: dark');
  });

  it("lets the page's own CSS win (it comes after the defaults)", () => {
    const page = '<style>body{background:#000;color:#0f0}</style>';
    const doc = wrapDocument(page);
    expect(doc.indexOf('background: #ffffff')).toBeLessThan(doc.indexOf(page));
  });

  it('paints the WebView white too, so there is no dark flash', () => {
    const {getByTestId} = render(<HtmlPreviewBubble html="<p>x</p>" />, {
      withNavigation: true,
    });
    const style = getByTestId('html-preview-webview').props.style;
    const flat = [style]
      .flat(Infinity)
      .reduce((a: object, b: object) => ({...a, ...b}), {});
    expect(flat).toMatchObject({backgroundColor: '#ffffff'});
  });
});
