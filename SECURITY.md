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

## 4. Data is never run as code

- No `eval` or `new Function` anywhere in the app, except inside the preview sandbox.
- Values are put into data, never into text that is then parsed. For example, shortcut fill-ins replace text inside a value and can't add fields.
- Each phone action builds the Android request from its own named fields. Model arguments are never passed through as they are.
- File names must match a strict pattern: no folders and no `..`.

## 5. The phone side stays small

- The app asks for a fixed list of Android permissions. Adding one means updating the test and this file.
- Only the main screen can be opened by other apps. Links from outside only fill in the chat box or offer a model download; they never send or run anything.
- The local API listens on the phone itself (127.0.0.1) only. It checks the Host header and a random password, compared in constant time, and accepts text only, with no tools.

## 6. The Windows app opens doors only on purpose, and asks

The Windows app (`src-tauri`, branch `windows`) is the same app in Windows' web view. Rule: broad access, never automatic.

- The window has no internet access of its own and no frames (its content security policy). Network, files, keys and the model server are commands on the native side, each listed in `src-tauri/build.rs` and allowed in `src-tauri/capabilities/default.json`. Nothing else is allowed.
- Files: the app's own folder (AppData) needs no prompt. Anywhere else, every read, write, list or delete shows an "Allow?" dialog **from the native side**, so the web screens can't skip it. `..` is refused everywhere.
- Models: the bundled llama.cpp server (pinned release, checksum checked) listens on this PC only with a random password. Running a model file from outside the app folder asks first.
- Keys: Windows Credential Manager, never plain files. In a plain browser, saving keys is not available.
- Network from the native side is http and https only.
- Tauri's script nonces stay on; its style nonces are off (`dangerousDisableAssetCspModification: ["style-src"]`), because the app's styles are added at run time. Styles can't run code, and the policy stops them loading anything from outside.

## For mods (planned)

A mod is data, never code. It lists every tool it uses, its full contents are shown before install, and it installs switched off. It goes through the same checks as a tool the model saves (rule 2).
