import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleProp,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {WebView} from 'react-native-webview';
import {useIsFocused} from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import CodeHighlighter from 'react-native-code-highlighter';
import {atomOneDark} from 'react-syntax-highlighter/dist/esm/styles/hljs';

import {
  BrowserIcon,
  CloseIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  ExpandIcon,
} from '../../assets/icons';
import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';

import {codeHighlighterPreOverride, createStyles} from './styles';
import {htmlFilename, saveHtmlToWorkspace, shareHtmlFile} from './saveHtml';
import {Text} from '../ThemedText';

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

interface HtmlPreviewBubbleProps {
  html: string;
  title?: string;
}

/**
 * Generated HTML is untrusted, but it is allowed to run its own inline
 * JavaScript so clocks, timers, games and buttons work. The sandbox:
 *   - CSP: only inline scripts/styles and data:/blob: media. Every network
 *     path is closed (`default-src 'none'`, `connect-src 'none'`, no
 *     external script/style/img/font/media), plus no frames, forms,
 *     workers, plugins or <base> rewriting. The policy is the first thing
 *     in the document, before any model markup, so a page cannot loosen it.
 *   - Navigation pinned to about:blank; no popups; no file access.
 *   - No native bridge: `onMessage` is never set, so the page has no
 *     `window.ReactNativeWebView` and cannot call into the app.
 *   - Incognito + no cache, so nothing persists between previews.
 *   - The WebView is unmounted when the chat screen loses focus, so scripts
 *     never keep running off-screen.
 */
export const CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; child-src 'none'; object-src 'none'";

/** If the page has not finished loading by then, show the error state. */
export const LOAD_TIMEOUT_MS = 10000;

/**
 * True when the markup references remote resources (e.g. a CDN script).
 * Those are blocked by the CSP; the preview shows a short note so the user
 * knows why part of the page may not work. Heuristic only — enforcement is
 * the CSP, not this check.
 */
export function referencesRemoteResources(html: string): boolean {
  return (
    /\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i.test(html)
  );
}

const HEAD_INJECTION = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style data-preview-override>
  /* Override common desktop-first CSS that breaks in a small preview
     viewport. Models often set body { height: 100vh } + flex-centering,
     which pushes content off-screen when intrinsic content height exceeds
     the bubble height. Force body to grow with content instead. */
  html, body { height: auto !important; min-height: 100% !important; }
  /* Constrain content to the viewport width. Models often emit fixed
     pixel widths (e.g. 1024px containers, full-bleed images, wide
     tables) that would otherwise overflow horizontally inside the
     chat bubble — and horizontal scroll in a chat row reads as broken.
     Cap top-level children and common wide elements; let tables/pre
     scroll internally so their content is still reachable. */
  body > * { max-width: 100vw; box-sizing: border-box; }
  img, video, iframe, svg, canvas { max-width: 100%; height: auto; }
  table, pre, code { max-width: 100%; overflow-x: auto; }
</style>
<script data-preview-fit>
  /* Fit the page in the preview: a page up to twice the window's height is
     scaled down so nothing is cut off at the bottom; a longer page keeps
     its size and scrolls. Runs inside the page only (no bridge). */
  (function () {
    function fit() {
      var b = document.body;
      if (!b) { return; }
      b.style.zoom = '';
      var h = document.documentElement.scrollHeight;
      var v = window.innerHeight;
      if (v > 0 && h > v) {
        var s = v / h;
        if (s >= 0.5) { b.style.zoom = String(s); }
      }
    }
    window.addEventListener('load', function () { fit(); setTimeout(fit, 400); });
    window.addEventListener('resize', fit);
  })();
</script>`;

// Generated pages are written for a normal white browser page, so the
// preview always starts from one (white background, dark text), whatever
// the app theme. The page's own CSS comes later and still wins.
export const PAGE_BACKGROUND = '#ffffff';
const FRAGMENT_STYLES = `<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 12px; background: ${PAGE_BACKGROUND}; color: #111111; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  a { color: #0b57d0; }
</style>`;

/** Policy-first envelope: untrusted markup can never precede the CSP. */
export function wrapDocument(html: string): string {
  // Policy must precede every byte of untrusted markup. Never locate a head
  // with a regex: an attacker can put the first match inside a comment.
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
${HEAD_INJECTION}${FRAGMENT_STYLES}</head><body>${html}</body></html>`;
}

interface SandboxedHtmlViewProps {
  document: string;
  style: StyleProp<ViewStyle>;
  testID: string;
  errorStyle: StyleProp<ViewStyle>;
  errorTextStyle: StyleProp<TextStyle>;
  errorButtonStyle: StyleProp<ViewStyle>;
  errorButtonTextStyle: StyleProp<TextStyle>;
  onViewCode: () => void;
}

/**
 * The locked-down WebView shared by the in-chat preview and fullscreen.
 * Shows an error panel (with a "View code" escape hatch) if the page fails
 * to load, its renderer crashes, or it does not finish within
 * LOAD_TIMEOUT_MS.
 */
const SandboxedHtmlView: React.FC<SandboxedHtmlViewProps> = ({
  document,
  style,
  testID,
  errorStyle,
  errorTextStyle,
  errorButtonStyle,
  errorButtonTextStyle,
  onViewCode,
}) => {
  const l10n = useContext(L10nContext);
  const [failed, setFailed] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    loaded.current = false;
    setFailed(false);
    const timer = setTimeout(() => {
      if (!loaded.current) {
        setFailed(true);
      }
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [document]);

  const fail = useCallback(() => setFailed(true), []);

  if (failed) {
    return (
      <View style={[style, errorStyle]} testID={`${testID}-error`}>
        <Text style={errorTextStyle}>{l10n.htmlPreview.loadFailed}</Text>
        <TouchableOpacity
          onPress={onViewCode}
          accessibilityRole="button"
          testID={`${testID}-error-view-code`}
          style={errorButtonStyle}>
          <Text style={errorButtonTextStyle}>{l10n.htmlPreview.viewCode}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <WebView
      source={{html: document, baseUrl: 'about:blank'}}
      // Model-authored inline JS runs so live pages work; the CSP in the
      // document blocks all network access. See the CSP doc above.
      javaScriptEnabled={true}
      javaScriptCanOpenWindowsAutomatically={false}
      // No onMessage => no window.ReactNativeWebView bridge.
      // Navigation is enforced by onShouldStartLoadWithRequest below.
      originWhitelist={['*']}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      geolocationEnabled={false}
      mediaPlaybackRequiresUserAction={true}
      mixedContentMode="never"
      incognito={true}
      cacheEnabled={false}
      onShouldStartLoadWithRequest={req => req.url === 'about:blank'}
      onOpenWindow={() => {}}
      setSupportMultipleWindows={false}
      onLoadEnd={() => {
        loaded.current = true;
      }}
      onError={fail}
      onRenderProcessGone={fail}
      onContentProcessDidTerminate={fail}
      scrollEnabled={true}
      // Android: let the page scroll inside the chat list instead of the
      // list taking the gesture (which left the bottom unreachable).
      nestedScrollEnabled={true}
      // White behind the page too, so there is no dark flash while it loads.
      style={[style, {backgroundColor: PAGE_BACKGROUND}]}
      testID={testID}
    />
  );
};

export const HtmlPreviewBubble: React.FC<HtmlPreviewBubbleProps> = ({
  html,
  title,
}) => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const isFocused = useIsFocused();
  const [fullscreen, setFullscreen] = useState(false);
  const [showCode, setShowCode] = useState(false);

  // Auto-dismiss the fullscreen modal when the user navigates away from the
  // chat screen so model-generated JS cannot keep running off-screen. The
  // in-row preview is unmounted while unfocused (see `renderLive`).
  useEffect(() => {
    if (!isFocused && fullscreen) {
      setFullscreen(false);
    }
  }, [isFocused, fullscreen]);

  const styles = useMemo(
    () =>
      createStyles(
        {
          background: theme.colors.surface,
          border: theme.colors.outline,
          text: theme.colors.onSurface,
          headerBg: theme.colors.surfaceVariant,
          modalOverlay: theme.colors.background,
        },
        theme,
      ),
    [theme],
  );

  const wrappedHtml = useMemo(() => wrapDocument(html), [html]);
  const hasRemoteResources = useMemo(
    () => referencesRemoteResources(html),
    [html],
  );
  const showCodeView = useCallback(() => setShowCode(true), []);
  // Only one live copy of the page at a time, and none while the chat
  // screen is not focused: scripts never run off-screen.
  const renderLive = isFocused && !fullscreen;
  const displayTitle =
    title && title.length > 0 ? title : l10n.htmlPreview.defaultTitle;

  const saveHtml = useCallback(() => {
    const name = htmlFilename(title);
    const fail = (error: unknown) =>
      Alert.alert(
        l10n.htmlPreview.saveFailed,
        error instanceof Error ? error.message : String(error),
      );
    Alert.alert(l10n.htmlPreview.saveTitle, name, [
      {
        text: l10n.htmlPreview.saveToWorkspace,
        onPress: () => {
          saveHtmlToWorkspace(html, title)
            .then(saved =>
              Alert.alert(
                l10n.htmlPreview.savedTitle,
                l10n.htmlPreview.savedToWorkspace.replace('{{name}}', saved),
              ),
            )
            .catch(fail);
        },
      },
      {
        text: l10n.htmlPreview.shareFile,
        onPress: () => {
          shareHtmlFile(html, title).catch(fail);
        },
      },
      {text: l10n.common.cancel, style: 'cancel'},
    ]);
  }, [html, title, l10n]);

  const copyHtml = useCallback(() => {
    ReactNativeHapticFeedback.trigger('impactLight', hapticOptions);
    Clipboard.setString(html);
  }, [html]);

  return (
    <View testID="html-preview-bubble">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayTitle}
          </Text>
          <TouchableOpacity
            onPress={() => setShowCode(s => !s)}
            accessibilityRole="button"
            accessibilityLabel={
              showCode
                ? l10n.htmlPreview.showPreview
                : l10n.htmlPreview.showCode
            }
            testID="html-preview-toggle-code"
            hitSlop={8}
            style={styles.headerButton}>
            {showCode ? (
              <BrowserIcon
                stroke={theme.colors.onSurfaceVariant}
                width={18}
                height={18}
              />
            ) : (
              <CodeIcon
                stroke={theme.colors.onSurfaceVariant}
                width={18}
                height={18}
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={saveHtml}
            accessibilityRole="button"
            accessibilityLabel={l10n.htmlPreview.saveHtml}
            testID="html-preview-save"
            hitSlop={8}
            style={styles.headerButton}>
            <DownloadIcon
              stroke={theme.colors.onSurfaceVariant}
              width={18}
              height={18}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={copyHtml}
            accessibilityRole="button"
            accessibilityLabel={l10n.htmlPreview.copyHtml}
            testID="html-preview-copy"
            hitSlop={8}
            style={styles.headerButton}>
            <CopyIcon
              stroke={theme.colors.onSurfaceVariant}
              width={18}
              height={18}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setFullscreen(true)}
            accessibilityRole="button"
            accessibilityLabel={l10n.htmlPreview.openFullscreen.replace(
              '{{title}}',
              displayTitle,
            )}
            testID="html-preview-bubble-collapsed"
            hitSlop={8}
            style={styles.headerButton}>
            <ExpandIcon
              stroke={theme.colors.onSurfaceVariant}
              width={18}
              height={18}
            />
          </TouchableOpacity>
        </View>
        {showCode ? (
          <ScrollView
            style={[styles.collapsedWebView, styles.codeSurface]}
            testID="html-preview-code">
            <CodeHighlighter
              hljsStyle={atomOneDark}
              language="html"
              textStyle={styles.codeText}
              scrollViewProps={{
                style: styles.codeInnerScroll,
                contentContainerStyle: styles.codeContent,
              }}
              customStyle={codeHighlighterPreOverride}>
              {html}
            </CodeHighlighter>
          </ScrollView>
        ) : (
          renderLive && (
            <SandboxedHtmlView
              document={wrappedHtml}
              style={styles.collapsedWebView}
              testID="html-preview-webview"
              errorStyle={styles.errorPanel}
              errorTextStyle={styles.errorText}
              errorButtonStyle={styles.errorButton}
              errorButtonTextStyle={styles.errorButtonText}
              onViewCode={showCodeView}
            />
          )
        )}
        {!renderLive && !showCode && (
          // Chat screen not focused (or fullscreen open): keep the row's
          // height but stop the page and its scripts.
          <View style={styles.collapsedWebView} testID="html-preview-paused" />
        )}
        {hasRemoteResources && (
          <Text style={styles.remoteNote} testID="html-preview-remote-note">
            {l10n.htmlPreview.remoteBlocked}
          </Text>
        )}
      </View>

      <Modal
        visible={fullscreen}
        animationType="slide"
        onRequestClose={() => setFullscreen(false)}
        // iOS Modal's default is portrait-only, which would lock the
        // fullscreen view to portrait even when the parent app is
        // already rotated. Mirror Info.plist (Portrait + Landscape on
        // iPhone, plus portrait-upside-down on iPad).
        supportedOrientations={[
          'portrait',
          'portrait-upside-down',
          'landscape',
        ]}
        testID="html-preview-modal">
        {/* Re-provide SafeAreaProvider: Modal renders in a separate view
            hierarchy on iOS and does not inherit insets from the app-level
            provider, so the top safe area would otherwise collapse to 0 and
            hide the Close button behind the notch/status bar. */}
        <SafeAreaProvider>
          <SafeAreaView
            style={styles.modalRoot}
            edges={['top', 'bottom', 'left', 'right']}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {displayTitle}
              </Text>
              <TouchableOpacity
                onPress={() => setShowCode(s => !s)}
                accessibilityRole="button"
                accessibilityLabel={
                  showCode
                    ? l10n.htmlPreview.showPreview
                    : l10n.htmlPreview.showCode
                }
                testID="html-preview-modal-toggle-code"
                hitSlop={8}
                style={styles.modalHeaderButton}>
                {showCode ? (
                  <BrowserIcon
                    stroke={theme.colors.onSurface}
                    width={22}
                    height={22}
                  />
                ) : (
                  <CodeIcon
                    stroke={theme.colors.onSurface}
                    width={22}
                    height={22}
                  />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveHtml}
                accessibilityRole="button"
                accessibilityLabel={l10n.htmlPreview.saveHtml}
                testID="html-preview-modal-save"
                hitSlop={8}
                style={styles.modalHeaderButton}>
                <DownloadIcon
                  stroke={theme.colors.onSurface}
                  width={22}
                  height={22}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={copyHtml}
                accessibilityRole="button"
                accessibilityLabel={l10n.htmlPreview.copyHtml}
                testID="html-preview-modal-copy"
                hitSlop={8}
                style={styles.modalHeaderButton}>
                <CopyIcon
                  stroke={theme.colors.onSurface}
                  width={22}
                  height={22}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setFullscreen(false)}
                accessibilityRole="button"
                accessibilityLabel={l10n.htmlPreview.closePreview}
                testID="html-preview-modal-close"
                hitSlop={8}
                style={styles.modalHeaderButton}>
                <CloseIcon
                  stroke={theme.colors.onSurface}
                  width={22}
                  height={22}
                />
              </TouchableOpacity>
            </View>
            {showCode ? (
              <ScrollView
                style={[styles.modalWebView, styles.codeSurface]}
                testID="html-preview-modal-code">
                <CodeHighlighter
                  hljsStyle={atomOneDark}
                  language="html"
                  textStyle={styles.codeText}
                  scrollViewProps={{
                    style: styles.codeInnerScroll,
                    contentContainerStyle: styles.codeContent,
                  }}
                  customStyle={codeHighlighterPreOverride}>
                  {html}
                </CodeHighlighter>
              </ScrollView>
            ) : (
              <SandboxedHtmlView
                document={wrappedHtml}
                style={styles.modalWebView}
                testID="html-preview-modal-webview"
                errorStyle={styles.errorPanel}
                errorTextStyle={styles.errorText}
                errorButtonStyle={styles.errorButton}
                errorButtonTextStyle={styles.errorButtonText}
                onViewCode={showCodeView}
              />
            )}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
};
