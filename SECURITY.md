# PocketAgent security rules

These rules keep the app safe as it grows: new tools, downloaded assistants and mods. Each rule has a test in `src/__tests__/securityRules.test.ts` (and the Windows app's native side has Rust tests in `src-tauri`), which fails if a change weakens it. **If one of those tests fails, don't just update the test.** Read the rule, decide on purpose, and update this file in the same change.

Audit of 2026-11-06: every place where untrusted input (model output, downloaded assistants, web pages, links from other apps, stored data) meets something powerful was checked. Findings and fixes are in `TODO.md` ("Off means off", "HTML preview lock").

## 1. Tools run in two places only

- Only the chat loop (`src/services/agent/AgentRunner.ts`) and a shortcut run (`src/services/talents/customTools.ts`) call a tool.
- The chat loop refuses any tool that is not on the allowed list for that turn, even if the model names it.
- Only a shortcut run skips the per-step question, and only after the user approved the whole shortcut, with every step shown.

## 2. Off unless the user turns it on

- Every tool starts switched off. Missing or broken settings mean no tools (fail closed).
- An assistant, including a downloaded one, may add only `calculate`, `datetime` and `render_html` by itself. Every other tool needs its Toolbox switch.
- Tools the model saves, and tools imported later (QR, file, mods), are saved switched off and re-checked every time they load.
- Phone actions ask every time. Nothing calls, sends or pays by itself.

## 3. The HTML preview is a closed box

- There is one WebView, and it has no bridge into the app (`onMessage` is never set) and no file access. It can't navigate, open pop-ups or keep anything between previews.
- Every page starts with a CSP that blocks all network use, then a guard script that removes WebRTC (which a CSP can't block), blocks `window.open` and removes frames. Frame tags in the page text are renamed before the page is built.
- A saved `.html` file opened in another browser is outside this box.
- On the desktop (Windows / Linux app) the box is a frame instead of a WebView: the native side serves the page from its own address (`pa-preview`) with the same no-network policy plus `sandbox allow-scripts`, and the frame is sandboxed to scripts only (no origin, pop-ups, forms, downloads or storage). It gets no bridge: Tauri gives its secret call key to the app's own page only. The app window allows frames from `pa-preview` only, so a preview can't navigate itself anywhere else.

## 4. Data is never run as code

- No `eval` or `new Function` anywhere in the app, except inside the preview sandbox.
- Values are put into data, never into text that is then parsed. For example, shortcut fill-ins replace text inside a value and can't add fields.
- Each phone action builds the Android request from its own named fields. Model arguments are never passed through as they are.
- File names must match a strict pattern: no folders and no `..`.

## 5. The phone side stays small

- The app asks for a fixed list of Android permissions. Adding one means updating the test and this file.
- Only the main screen can be opened by other apps. Links from outside only fill in the chat box or offer a model download; they never send or run anything.
- The local API listens on the phone itself (127.0.0.1) only. It checks the Host header and a random password, compared in constant time, and accepts text only, with no tools.
- Home link, phone side (`native/homelink`, `HomeLinkModule.kt`): pairing starts only from the PC's QR code (`PA1:P:` tag; anything else is refused), the phone asks first and the PC asks its user too. The phone's tunnel to the PC listens on 127.0.0.1 only and turns away anything else; it reaches only the PC's model server, and needs that server's password. The phone's own key stays in the app's no-backup folder (never in a cloud backup). No new Android permission.

## 6. The Windows app opens doors only on purpose, and asks

The Windows app (`src-tauri`, branch `windows`) is the same app in Windows' web view. Rule: broad access, never automatic.

- The window has no internet access of its own (its content security policy). Its only frames are HTML previews from `pa-preview` (rule 3).
- Network, files, keys, previews and the model server are commands on the native side, each listed in `src-tauri/build.rs` and allowed in `src-tauri/capabilities/default.json`. Nothing else is allowed.
- Every native command runs off the window's main thread (`async`), so a slow one can't freeze the window.
- Files: the app's own folder (AppData) needs no prompt. Anywhere else, every read, write, list or delete shows an "Allow?" dialog **from the native side**, so the web screens can't skip it. `..` is refused everywhere.
- Models: the bundled llama.cpp server (pinned release, checksum checked) listens on this PC only with a random password. Running a model file from outside the app folder asks first: Allow once, Always allow this file, or Don't allow (closing the dialog is Don't allow). "Always" is only ever set by that button, and is kept in Windows Credential Manager under names the screens can't write (their key command always adds "PocketAgent:"). It covers that exact file (path, size, last-changed time): a changed or replaced file is asked about again. A model the app downloaded itself is named by its own path (`/pocketagent/…`, inside the app folder) and runs without a question; its vision part (`--mmproj`) is only ever a file the app downloaded.
- Keys: Windows Credential Manager, never plain files. In a plain browser, saving keys is not available.
- HTML previews give the page a storage that lives only while it is open (`localStorage` / `sessionStorage` in memory; the real one throws in the no-origin preview and stopped pages' scripts). Nothing is saved or shared with the app.
- Network from the native side is http and https only, never the app's own internal addresses (`*.localhost`: the native bridge `ipc.localhost`, the app, previews), and never with the bridge's per-start key (`Tauri-Invoke-Key`). The page's network layer leaves those addresses alone too (`web/tauriNet.js`). Before 2026-11-09 the page sent the bridge's own Windows address through the native side, so each native call called itself until the page gave up (the 40 s Windows start); the requests that then reached the native side were for `ipc.localhost`, a name Windows does not resolve, so nothing left the PC. Both sides now refuse it, with tests.
- Publishing test builds uses the owner's own token (repository secret `RELEASE_TOKEN`: this repository only, Contents + Workflows, with an expiry), only in the "Publish pre-release" steps, which run nothing but `gh`. A test fails if it shows up anywhere else. Forks never receive it.
- Home link ("Use this PC's model from your phone", `src-tauri/src/link.rs`): off until the user switches it on. Devices dial each other by public key (iroh); the connection is encrypted from the PC to the phone, and a relay (used when no direct path is found) passes it on without being able to read it. Pairing: a QR code with the PC's key and a one-time code (10 minutes, one try), then a native "Pair with the phone …?" dialog; only then is the phone's key saved. A paired phone can do exactly three things: ask whether a model is running, start the model this PC last ran (the PC picks it, the phone names nothing; never one that would need an "Allow?" on the PC: a file outside the app folder that isn't "always allowed" is refused, since nobody may be at the PC), and pass HTTP requests to this PC's own model server on 127.0.0.1. Nothing else is reachable (no files, tools or other ports). Paired phones and the link key live in the credential store under names the screens can't write. Remove a phone and it is shut out at once. Pairing history: every code made, phone paired and phone removed is recorded on the PC and sent to the paired phones with each status, so a code made while you're away shows up on your phone ("Pairing activity on your PC").
- Downloads (models) stream straight to disk through the native side: http/https only, the app's own folder needs no prompt, anywhere else asks; a half-finished download stays a `.part` file and never looks like a model.
- The desktop app makes no network calls at start-up (the phone's device-rules fetch from PocketPal's CDN is off on the desktop).
- Tauri's script nonces stay on; its style nonces are off (`dangerousDisableAssetCspModification: ["style-src"]`), because the app's styles are added at run time. Styles can't run code, and the policy stops them loading anything from outside.

## 7. No outside connection the user didn't ask for

Audit 2026-11-09 (every outside address in the code, plus the desktop app's actual traffic in its first minute: none).

- Nothing contacts an outside service on its own: no reports, no analytics, no crash reporting, no Google. `src/config/outside.ts` keeps PocketPal's original senders in the code but off: feedback, content reports, model error reports and shared benchmarks (PocketPal's Firebase / Google App Check, after a google.com probe) are refused before any connection (the error report is copied instead); the device-rules download from cdn.jsdelivr.net at every phone start is off (built-in rules are used). A test pins both off.
- Not built in: Firebase (no project; its JS modules unlinked, its Android libraries commented out). Built in but never started: Google Sign-In and PalsHub accounts (only with a Supabase address, which PocketAgent builds don't have), Google Play billing (`NO_PURCHASES`).
- Connections that happen because the user asked: model search and downloads (Hugging Face; a downloaded model's checksum is fetched from there to check the file), cloud models and servers the user added, web search / page reading tools (when switched on), custom tool tests (after a yes), the home link (when switched on: iroh's public relay and discovery servers by number0 see which keys connect, never the content).
- New outside connections need this file updated and their switch or consent; reviewed in the security audit before release.

## For mods (planned)

A mod is data, never code. It lists every tool it uses, its full contents are shown before install, and it installs switched off. It goes through the same checks as a tool the model saves (rule 2).
