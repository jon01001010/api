# PocketAgent offline prebuild checkpoint

This is a consolidated **staging/integration kit**, not a finished app or verified APK. It does not trigger GitHub Actions or require GitHub billing.

## How to use

From a local checkout of `jon01001010/api` on branch `pocketagent-step1-integration`:

```sh
python3 integrate.py /path/to/pocketagent
python3 integrate.py /path/to/pocketagent --apply
```

The first command checks patch compatibility on a temporary copy. The second applies only if all selected patches succeed. Existing staged source files that differ are never overwritten; review these manually. **Back up or commit your own checkout before using --apply.**

## Still requires live integration

- #3 custom Toolbox dispatch and end-to-end permissions
- #19-21 native background execution and notification device tests
- #33 thermal monitoring and inference throttling
- #35 wire fallback policy into model router and preserve privacy approvals
- #36 connect startup policy to navigation, prompt and persisted toggles
- #37 Jest, Android compile, real-phone validation, APK signing/distribution
- #38 test HTML clock in fullscreen and confirm WebView isolation

#32 background downloads and #34 API connectivity were previously confirmed by the user. No commits, GitHub Actions, or APK builds were attempted.

## October 22 source review and offline verification

- GitHub branch `pocketagent-step1-integration` at `8806fad775de91a1eae8492f444715d45772d25d` was readable through the GitHub connector.
- The live `HtmlPreviewBubble.tsx` has `javaScriptEnabled={false}` in both inline and fullscreen WebViews and `script-src 'none'`; this explains the clock's inert JavaScript.
- `patches/apply-38-interactive-preview.py` was inspected and the new `verification/check_html_preview_patch.py` regression fixture passed. It changes fullscreen to JavaScript-enabled with a network-denying CSP while keeping inline static.
- The full private repository was not available as a local checkout, so the integration script could not be executed against the complete app. No APK was built and no repository files were changed.
