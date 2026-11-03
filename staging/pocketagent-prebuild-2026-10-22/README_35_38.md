# PocketAgent #35–38 — combined staged checkpoint

This is an **integration preparation package**, not a completed APK. It builds on #33; #32 and #34 were already done per user. No repository changes or builds were made.

## #35 — Local/remote handoff
- Added pure, testable handoff decision policy (`modelHandoffPolicy.ts`).
- Remote transfer requires user approval; private file content requires separate approval.
- Disallows handoff while a tool call is in progress; supports returning to local.
- **Not yet wired** to RouterStore, model selection or live completion engine. No automatic fallback yet.

## #36 — Startup and branding
- Added startup policy with model identity, visible global prompt, model-picker-first when unloaded, and listening OFF on every startup.
- **Not yet wired** to React Navigation or persisted UI settings. Legacy assistant references remain in repo.

## #37 — Integration and security verification
- Added `verification/verify_staged.py` to validate package contents and policy invariants without dependencies.
- Added `verification/PHONE_ACCEPTANCE.md` with concrete Android testing cases.
- **No APK compiled, no end-to-end integration or distribution validation.**

## #38 — Interactive HTML preview
- Reused the existing #38 patch from `PocketAgent_Number_38_Complete` rather than duplicating work.
- Collapsed preview static; fullscreen JS enabled with network/navigation restrictions.
- Patch must be applied and tested against the exact repo checkout. WebView security still needs device verification.

## Applying
- Copy staged `src/` files into repository matching paths.
- Apply patches individually from repository root (inspect each patch and its prerequisites first).
- Run Jest for new tests and `htmlPreviewSecurity` test.
- Then integrate #35 and #36 into live app paths and perform Android acceptance tests.
- **Do not treat this as a finished or buildable standalone source tree.**
