# PocketAgent TODO and Future Roadmap

**Target: future phones and models.** The current test phone (Motorola Razr 2023) and small models (e.g. Qwen 3.5 2B) are a development stand-in; don't tune features or prompts for them.

Updated: 2026-11-03. This document tracks planned work. Items marked done are done in code (with tests) on the open PR stack (#3 → #4 → #5 → todo-batch); anything that still needs checking on the phone is listed under **Phone checks**.

## Pre-release: can't release until (decided 2026-11-12)

Nothing goes to other people (testers included, beyond the owner) until every box here is ticked. Details are in the sections they point to.

**Security**
- [ ] Full security audit of both apps and the link: every door, approval, stored secret and way in (see "Before releasing to people").
- [x] Model server password off the command line (2026-11-12: by environment, `LLAMA_API_KEY`; tested).
- [x] Phone tunnel: only model requests, password required for everything (2026-11-12: the PC checks the first request on each connection; 403 otherwise; tested).
- [x] Security review 2026-11-15, PC side (Rust), all tested:
  - [x] Tunnel: every request checked, not just the first: one request per stream (plain Content-Length body ≤ 16 MB, no Transfer-Encoding, nothing pipelined), sent on with `Connection: close`; the phone closes its local connection after each answer. llama-server runs with `--no-slots` (its `/slots` handed out the PC's last conversation). **Check on real devices:** chats (streamed and not) through the tunnel from the phone and from a second PC; the app's clients reconnect after each answer.
  - [x] Tunnel: pictures, sound and video in chat / completion requests must be `data:`; an address the PC would fetch from its home network is refused (403).
  - [x] `run_command`: no carriage returns, controls or invisible / bidi characters, at most 20 lines; the dialog says how many lines and characters.
  - [x] Answers given on devices: the whole question logged (one line, escaped), out of the screens' file space (settings folder on Linux, local AppData on Windows); a notification on the PC when a device answers; the PC's still-open dialog then says it was already answered. **Check on Windows:** the notification and the follow-up note.
  - [x] Second PC's link key in Credential Manager (Linux: owner-only file in the settings folder); the old `client.key` is moved there. The phone's key file is owner-only (0600).
  - [x] Removing a device closes its open connections at once and keeps it from pairing again for an hour; a paired or lately removed device can't use up a pairing code; request line within 10 s; one sync at a time per device.
  - [x] Media keys ask natively too.
  - [x] Per-device "may answer this PC's questions" choice: off for each device (and for devices paired before), a "May answer" switch per device in the PC's list (shown while answering is on); switching it on asks in a native dialog on the PC and shows in the pairing history on paired devices; any other device's "questions" / "answer" is refused. **Check on Windows:** the dialog, the switch, and a device without it being refused.
  - [ ] Decide: rotate the model password (restart the model) when a device is removed. Low value now: the server listens on the PC only, and a removed device is cut off and can't reach it any more.
- [x] Security review 2 (2026-11-15), app code, all tested:
  - [x] "Recently deleted" chats: up to 3 versions per chat (the first kept one never dropped), so two syncs in a row can't push the original out; stored in parts counted in UTF-8 bytes (at most 900 KB each, 1.5 MB in all, under Android's 2 MB read window); a list that can't be read is never saved over (nothing removed or replaced then). Assistants and loops use the same safe read (`keptStore.ts`). The chats' list moved to new keys (`…/v2`), read from the old one until the next save.
  - [x] Home PC PIN wait: the wait left is kept and counts down only by time the app measured (the smaller of the wall clock's and `performance.now`'s), so setting the date forward, back or restarting doesn't shorten it. The wait counts only while PocketAgent is open (the message says so).
  - [x] Searching earlier chats: only messages typed on this device; a sync marks the messages it writes from another device (`mirroredFrom` in their metadata, local only), except ones typed here that came back unchanged. Chats mirrored before this change aren't marked until they change again.
  - [x] Phone's hidden characters match the PC's (`remote_ask::hidden_char`), pinned by a test.
  - [x] A synced change to a running loop pauses it ("Changed on <device>; press Resume to run the new version").
  - [x] Shortcuts refuse a step whose tool is switched off in the Toolbox (before the approval and before each step).
  - [x] PC: a pairing code survives 3 wrong tries (all device keys together); the 4th, the right one or 10 minutes use it up.
  - [x] PC: at most 3 chats per device allowed to read the workspace (a new one ends the oldest); the question and each read notification show the count. A device may still answer its own read question (owner decision 1c).
  - [x] PC: errors sent to a device (sd-cli's last lines, file errors) without the PC's paths (`<home>`, `<app folder>`, `<path>`).
  - [x] PC: no PDFs for devices (a damaged PDF could overflow the reader's stack and stop the app); other documents read in their own thread with a 64 MB stack, one at a time, within 30 s.
  - [x] PC: the clipboard's text is not written to the answers log ("clipboard (N characters, not logged)"); the log moves to `answers.log.1` past 1 MB.
  - [ ] **Check on the phone:** after updating, "Recently deleted" (chats, assistants, loops) still lists what was there; mirror a chat, change it on the PC twice, and the first version is still under Recently deleted; 5 wrong PINs, set the date a day ahead in Android settings: the wait is still there; a loop running on the phone and edited on the PC is paused with the note; a shortcut with a step switched off says so; with "Also search earlier chats" on, words from a chat typed on the PC aren't used.
  - [ ] **Check on Windows:** pair with a wrong code first (from a fresh device), then the right one: pairing still works; a device's 4th chat asking to read the workspace says the oldest ends, and read notifications show "(n of at most 3 chats allowed to read)"; a PDF asked by a device is refused with the note; a failed picture for a device shows no `C:\Users\…` path; answer a clipboard question from a device and check `answers.log` has no clipboard text.
  - [ ] **Owner decision (finding 6, chosen 1c):** a device that may read and may answer can still allow its own reads; only the cap of 3 chats per device and the count were added.
- [x] Optional PIN / fingerprint before the Home PC is used (2026-11-15): per PC in its server sheet, "Ask for a PIN before using this PC" (4-8 digits, off by default; phone and a second PC alike). Every home link request is refused while locked (`homePcLock.ts`, checked in `homeLink.ts`); a chat message, Load, Sync now, a picture or an answer opens the PIN window first. Asked again after the app was in the background longer than the chosen minutes (1 / 5 / 15 / 30 / 60, default 5) and after a restart; the tunnel is closed then. Salted PBKDF2-SHA256 hash only (30,000 rounds: 100,000 measured at 3.4 s without a JIT, too slow on a phone; see `pinHash.ts`), in the key store. 5 wrong tries, then 5 minutes, doubling (at most a day), kept across restarts. Forgot PIN: pair again (the PC approves); changing or turning it off needs the PIN. Fingerprint: optional on Android through react-native-keychain's biometry (androidx.biometric, already in the app; no Google Play services), PIN as the fallback; none on the desktop. Tests: `src/services/homeLink/__tests__/pinHash.test.ts`, `homePcLock.test.ts`, `homePcLockUse.test.ts`, `src/components/HomePcLock/__tests__`.
  - [ ] **Check on the phone:** turn the PIN on in the Home PC server sheet; leave the app for over 5 minutes, come back, send a message: the PIN window shows first, the message goes after the PIN; Cancel stops it. How long the PIN check takes (expect about 1-2 s; if much longer, lower `PIN_ITERATIONS`). 5 wrong PINs → a 5-minute wait, also after closing and reopening the app. Fingerprint: switch it on (needs the current PIN), then unlock with it; add a new fingerprint in Android settings → it falls back to the PIN.
  - [ ] **Check on Windows (second PC as the client):** the same PIN window and wait (minimise the window for longer than the minutes chosen); no fingerprint option.
- [ ] Keys at rest and metadata written down plainly for users; PC link key sealed to the PC considered.
  - [x] Written down (2026-11-15): `docs/privacy.md`, what is kept where on each device, what the link sends, what the ISP and number0's relays can see (metadata), what never leaves the device.
  - [ ] **Owner decision:** seal the PC's link key to the PC (DPAPI / TPM) or not.
- [x] Old / reused pairing codes refused (test) (2026-11-15: `src-tauri/src/link.rs` tests: a used code is gone and replays fail, an expired code is refused and used up, a new code replaces the old one, codes compared whole in constant time).
- [ ] Every outside connection checked on the phone too (its real traffic at start-up; SECURITY.md rule 7); Google Sign-In and Play billing unlinked on Android.
  - [x] Code audit (2026-11-15): every outside address the phone app can contact, when, and its switch, listed in SECURITY.md rule 7. Nothing at start-up with nothing set up; servers you added (cloud ones too) have their model list read at start-up and when the app comes back (at most once a minute), and a paired Home PC opens the link then.
  - [x] Google Sign-In and Play billing unlinked on Android (2026-11-15): `react-native.config.js` (android: null), JS stand-ins in `stubs/android` ("not available"), test `stubs/android/__tests__/androidStubs.test.js`. **Check:** the next APK builds and starts, and Settings / Pals open as before.
  - [ ] **On the phone:** watch the real traffic for the first minute after a fresh install and after a normal start (e.g. PCAPdroid, no root): expect none with nothing set up.
  - [ ] **Owner decision:** cloud servers' model lists are read at every start / return to the app. Keep, or read them only when their model is used or the list is opened (needs a check that cloud models' abilities still show right).
- [x] Report / feedback / share-benchmark buttons copy the text instead of sending (2026-11-12).
- [x] Public security policy (how to report a problem privately, scope, response times) and a changelog of security fixes (2026-11-15: `.github/SECURITY.md`, which GitHub shows as the policy; `docs/security-changelog.md`). **Owner:** switch on Settings → Code security → Private vulnerability reporting on GitHub, so the "Report a vulnerability" button exists.

**Builds and installs**
- [ ] Run Android lint on the release build on its own (`./gradlew lintProdRelease`) and fix what it reports; release builds skip "lint vital" since 2026-11-15 (it never ran on the old debug builds).
- [ ] Signed builds: Windows installer and APK signed with our own keys; checksums published for every download. Today the APK is signed with React Native's public debug key (committed), so updates install in place but anyone could sign a look-alike update: a private release key (kept as a GitHub secret) before release; that one change means one reinstall.
  - [x] Checksums (2026-11-15): every release (APK, Windows setup.exe, Linux AppImage / deb) publishes a `SHA256SUMS` file; a test checks each publish step. **Check** on the next build that the file is there and matches.
  - [x] APK signing prepared (2026-11-15): the APK workflow's "Sign the APK with our release key" step signs with `apksigner` when the secrets below are set, and changes nothing without them. A test keeps the secrets in that step only.
  - [x] Release build, signed apart from the build (2026-11-15, security review 2, findings 1 and 2): the published APK is now `prodRelease`, not `prodDebug`: not debuggable (so `adb run-as` can't read its keys and chats on an unlocked phone) and without dev support (so it never loads JavaScript from a "Metro" another app could run on the phone); the Hermes bundle is built in as before. R8/minify stays off (never tried for this app). Without the owner's key it is still signed with React Native's public debug key, the same as the earlier test APKs, so **it installs over the current app with no reinstall**. Signing moved out of the build job: the build uploads the APK, and a separate `sign` job (fresh runner, no repository rights, no checkout, nothing of the build run) checks it is not debuggable, signs it with the runner's own `apksigner` (build-tools 36.0.0) when the key's secrets are set, verifies it, removes the key file and hands it to the release job, which adds `SHA256SUMS`; the release notes say which key signed it. Tests: `securityRules.test.ts` ("the published APK is the release build…", "the APK signing key is used only by the signing step…").
    - [ ] **Check on the next APK build** (not built yet; Gradle can't run where this was made): `assembleProdRelease` succeeds within the step's 110 minutes (the native cache key changed, so llama.rn's native code builds from scratch once, now optimised); the payload check passes on `app-prod-release.apk` (stripped libraries keep `.dynsym`); "Check the APK is a release build" passes in both jobs (no `application-debuggable`, Hermes bundle); the sign job finds build-tools 36.0.0 (or installs it); the release notes say "signed with React Native's public debug key"; **on the phone**: the new APK installs over the current one without uninstalling, chats and settings are kept, the app starts without Metro, models load (llama.rn, NPU/OpenCL), the home link and local API work, and Developer options no longer list it as debuggable (`adb shell run-as org.apihelper.local` says "package not debuggable").
  - [ ] **Owner: make the APK key and add the secrets** (never commit the key or paste it anywhere else):
    1. On your own computer (Java's `keytool`): `keytool -genkeypair -v -keystore pocketagent-release.p12 -storetype PKCS12 -alias pocketagent -keyalg RSA -keysize 4096 -validity 10000` (choose a long password; use the same one when it asks for the key password).
    2. Keep `pocketagent-release.p12` and its password safe, offline, in two places: losing it means no more updates over the installed app; anyone who has it can sign updates as us.
    3. `base64 -w0 pocketagent-release.p12 > keystore.b64` (Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("pocketagent-release.p12")) > keystore.b64`).
    4. GitHub → the repository → Settings → Secrets and variables → Actions → New repository secret: `ANDROID_KEYSTORE_BASE64` (the contents of keystore.b64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`pocketagent`), `ANDROID_KEY_PASSWORD` (same as the store password for a PKCS12 key; may be left out). Then delete keystore.b64.
    5. The next APK is signed with it: uninstall the old (debug-signed) app once, install the new one (export chats first if needed). Updates after that install in place. Check: the workflow log shows "Signer #1 certificate DN" with your name, not "Android Debug". Only this switch to your own key needs the reinstall; the move from the debug build to the release build (above) does not.
  - [ ] **Owner decision: Windows code signing** (not built in; today SmartScreen says "unknown publisher"). Needs a code-signing certificate in the owner's (or a company's) name: (a) Azure Trusted Signing (about $10 a month, identity checked, signs in CI with no key file; only some countries / organisations so far), (b) an OV or EV certificate from a certificate authority (about $200–600 a year; since 2023 the key must live on a hardware token or a cloud HSM, so CI signing needs the CA's cloud signing service), or (c) SignPath.io's free signing for open-source projects (they hold the key, signing on their side after review). Tauri signs the installer and the .exe through `bundle.windows.signCommand` once one is chosen. Linux packages: checksums only for now (a GPG-signed SHA256SUMS could come later).
- [x] A version per build (2026-11-12): 1.21.<commit count>, the same on the phone and the PC from one commit, higher for every later commit; Android version code 1000 + count (above PocketPal's 151); shown in App Info.
- [ ] Clean installs and updates checked on devices: the Windows installer upgrades in place with chats and models kept; the APK updates over the last one.
- [ ] Phone and PC builds always match (done: one build request starts all three) and the app says when they differ (done).
- [x] Licences screen up to date (a test enforces it) and llama.cpp's licence updated with each llama.cpp update (2026-11-15: checked up to date, iroh and the desktop / home link crates credited; a new test fails when the llama.cpp the desktop builds download (`LLAMA_TAG`) differs from the credited one). Image generation (stable-diffusion.cpp) must be credited when it ships.

**Checked on real devices** (not just tests here)
- [ ] Windows: every desktop tool once (the "Check on Windows" items in "DesktopAgent tools"), downloaded models, the start-up time, the preview game.
- [ ] Phone: remote start of the PC's model, the route line, the thinking limit, the memory fix.
- [ ] The home link away from home on mobile data (relay), at least once.
- [ ] Linux build: starts, runs a model.

**Testers**
- [ ] A small group of invited testers tries to break it; findings fixed before the release widens; testers credited.

**Out of scope for release**
- iPhone / Apple: not made (decided: no Apple).

## Roadmap (agreed 2026-11-08)

**No point in any of this without real security.** Every step keeps the rules in SECURITY.md (off until switched on; anything outside the app asks, natively, every time), and each new ability gets its rule test before it ships.

**1. Make what exists solid (now, confirmed)**
- [x] Fix the 40 s Windows start: it was every native call being sent through itself (fixed 2026-11-09, now 2.2 s).
- [ ] Home link on real devices: pair over the hotspot, then use it away from home on mobile data (relay).
- [x] Start the PC's model when the phone asks (2026-11-09): Load on a Home PC model, with no model running on the PC, asks it to start the model it last ran and waits until it has loaded (up to 5 min). The PC picks the model (kept as `model-server-last.json`); a model that would need an "Allow?" on the PC is refused with a message, since nobody may be there. Listing models never starts one.
- [x] The Home PC server's sheet shows how the phone reaches the PC ("direct, 14 ms" / "relay, …") and what Load would start.
- [x] Keep the link alive in the background (the chat's background notification already keeps the app running while a reply comes in; check what happens between replies). First step (2026-11-15; check on the phone: lock it for a few minutes between replies, then send): with a Home PC model loaded, coming back to the app checks the link quietly (tunnel, the PC's status, the model's current password) and reopens it; before the next request the same check runs if the app was away since, or the last check is over 2 minutes old, so the first message after a pause no longer fails. It tries twice (a link that went quiet is closed after the first try, so the second opens a new one); "Reconnecting to your PC…" shows while it takes more than a moment; a new password (the PC restarted its model) is taken without loading again; if the PC can't be reached the message says so ("Can't reach your PC: …"). JS only (`services/homeLink/keepLink.ts`), no new permission, never starts a model on the PC. Not yet: keeping the link open while the app is paused (Android may still pause it between replies; this reopens it instead).
- [ ] Relay test (no relay use so far: the user's phone is the PC's internet, so the link is always direct over the hotspot). A "relay only" test switch could check it from home.
- [ ] Clean installs and updates: a version per build (0.1.<build>), upgrades in place.
- [x] **Builds always match** (user, 2026-11-08): one file, `.github/build-request`, starts the Android, Windows and Linux builds together from the same commit (on the windows branch, nothing else starts the Android build). Each build records its commit (scripts/build-info/write.js); App Info shows it ("Build 1a2b3c4"); the home link compares the phone's and the PC's and says once when they differ.

**2. One assistant on two devices (next)**
- [x] **The PC asks, the phone can answer** (built 2026-11-13; check on the phone and PC): Settings → "Use this PC's model from your phone" → "Let paired devices answer this PC's Allow? questions", and on the device the PC's server sheet → "Show this PC's Allow? questions here". While both are on, every "Allow?" the PC shows (a file outside the workspace, a command, the clipboard, opening a link, a model file…) also shows on the device, word for word, with **Don't allow** / **Allow once**. The device looks every 8 s while the app is open (every 60 s when the PC is away or refuses). Security as decided:
  - Only a paired device, over the encrypted home link; the PC's own dialog stays up, and the first answer wins (a later click on the other is ignored).
  - The device shows the PC's exact text; no summary.
  - The PC still checks everything itself; the device's answer is yes/no for that one question (an id, expires in 2 minutes; no answer from a device = the PC's own dialog decides).
  - Never "always" from a device: its yes is "allow once" even where the PC offers "Always allow this file".
  - Pairing a new device is asked on the PC only, never mirrored.
  - Off until switched on, on both devices (the PC's switch is off again after a restart until the app's screens turn it back on from the saved choice); every device answer is logged on the PC (`link/answers.log` in the app folder) with the device's name.
  - Not yet: the PC's dialog can't close itself when a device answered first (the system dialog has no close call); it stays until clicked, and that click does nothing.
- [ ] The phone uses the PC's tools (each still asks, on the PC or the phone as above); hand-off of tasks; chats and memory in step over the link.
  - Design to decide: [docs/design/phone-uses-pc-tools.md](docs/design/phone-uses-pc-tools.md) (options, threats, staged plan, open questions).
  - **Decided (owner, 2026-11-15):** Option A (remote tools, chat stays on the phone). (1c) the phone that asked may also allow the PC action, as today (no extra screen-lock check; the Home PC PIN and per-device "May answer" still apply). (2b) reading the PC's workspace from a device asks once per chat. (3a) `run_command` from a device in stage 3, behind its own per-device permission. (4a) the PC's switch for device tools stays as it was after a restart. (5a) hand-off of whole tasks to the PC is wanted later.
  - [x] **Stage 1, read only** (built 2026-11-15; check on devices): PC: Settings → home link card → "Let paired devices use this PC's tools" (off, kept across restarts) and per device "May read" (off; turning it on asks in the PC's own dialog; in the pairing history). Phone: Toolbox → "On your PC": `pc_info`, `pc_workspace_list`, `pc_workspace_read` (each off). Link request `tool`: only paired devices, then the PC's switch → the device's "May read" → a fixed list of three → the arguments (a random chat id; one workspace file name, never a path, `..`, hidden or system name). Same functions and caps as the PC's own tools (`pc::pc_info`, `pc::workspace_file`, `docs::read_document`); text and documents only, at most 256 KB of text. Listing or reading asks on the PC once per chat ("<device> asks to read files in your workspace for this chat"; a device that may answer can answer it), kept 12 hours in memory; a notification on the PC for each file read; every use in the answers log. On the phone: the Home PC PIN first, the answer wrapped as untrusted, plain messages when the PC refuses or can't be reached. A second PC can call it too (`homelink_tool`), but its Toolbox has no "On your PC" section yet (its own `pc_info` has that name). Code: `src-tauri/src/pc_files.rs`, `link.rs`, `src/services/talents/PcToolsEngine.ts`.
  - [x] **Stage 2, actions that already ask** (built 2026-11-15; check on devices): PC: per device "May act" next to "May read" (off; turning it on asks in the PC's own dialog; `may-act` in the pairing history). Phone: Toolbox → "On your PC" adds `pc_open`, `pc_print`, `pc_media`, `pc_clipboard_read` (each off). The link's fixed list grows by exactly these four; check order unchanged (paired → PC switch → the device's flag for that tool → the list → arguments: a workspace file name, or a key from the PC's media key list). Each calls the very same function as the PC's own tool (`pc::open_file`, `pc_extra::print_workspace_file` / `press_media_key` / `read_clipboard`), so the same checks and the same native "Allow?" every time (never "always"), its first line naming the device ("“Pixel 8” asks to open …"); a device that may answer can answer it, the asking one too (1c); the switch and "May act" are checked again after the answer. The clipboard's text is never logged (nor in the "answered on" notification), whoever asked; on the phone it is wrapped as untrusted. A PC notification for each action ("Pixel 8 opened report.docx on this PC"; the clipboard by length only), and each in the answers log. Phone: Home PC PIN first; plain messages when the PC's user said no, the device may not act, or the PC can't be reached. Code: `link.rs` (`ACT_TOOLS`, `act_for`, `link_device_may_act`), `approval::ask_for`, `pc.rs`, `pc_extra.rs`, `remote_ask.rs`, `PcToolsEngine.ts`, `native/homelink` (passes the media key on).
  - [x] **Stage 3, commands** (built 2026-11-15; check on devices): PC: per device "May run commands" next to "May act" (off, also for devices paired before and after pairing anew; turning it on asks in the PC's own dialog with a strong warning: "can run anything you can on this PC, after you allow each command"; `may-command` in the pairing history). Phone: Toolbox → "On your PC" adds `pc_run_command` (off). The link's fixed list grows by exactly this one; check order unchanged (paired → PC switch → the device's flag for that tool → the list → the command through the PC's own `check_command`). It calls the very same function as the PC's own `run_command` (`pc::run_checked_command`): the whole command in the native "Allow?" every time, never "always", with line and character counts, naming the device ("“Pixel 8” asks to run this command on your PC …"); a device that may answer can answer it, the asking one too (1c), and sees it whole (never cut; too long to show whole on the phone → only "Don't allow" there); the switch and the flag checked again after the answer; workspace folder, 60 s, 32 KB output. The output goes back without the PC's paths (line by line) and capped; on the phone the whole answer is wrapped as untrusted. A PC notification for each (device + first 60 characters) and the whole command in the answers log (escaped). Code: `link.rs` (`COMMAND_TOOLS`, `command_for`, `output_for_device`, `link_device_may_command`), `pc.rs` (`run_checked_command`, `command_question_for`), `PcToolsEngine.ts`, `native/homelink` (passes the command on).
  - [ ] Stage 4 (writes), see the design.
- [ ] **Sync phone and PC** (user, 2026-11-08), over the home link only, off until switched on:
  - [x] One **system prompt** for both (built 2026-11-12; check on devices): the system prompt, your memory notes and the model's memory notes kept in step over the home link. Off until switched on on both (PC: Settings → home link card; device: the Home PC server's sheet). Newer edit wins per item, empty never wins, the replaced text kept in history; runs on Load and on "Sync now"; the PC says what changed.
  - **Never two system prompts:** when the phone uses the PC's model (Home PC), only the phone's request carries the system prompt; the PC's link passes requests through untouched and adds nothing of its own (keep it that way; a test should pin it). Same the other way round.
  - [x] Assistants and custom tools kept in step too (built 2026-11-13; same switches): assistants without their device-only parts (chosen model, picture), matched by id then by name (no duplicate starter assistants), added or updated, never deleted; custom tools as one list, checked on arrival, off until switched on per device.
  - [ ] Still to keep in step: chats (optional, see mirrored chats). Toolbox switches stay per device on purpose (each device asks for its own actions), not kept in step.
  - [x] **Loops kept in step** (built 2026-11-15; check on devices): part of the same "keep in step" switch (no switch of its own; "Loops" in the sync line). Only a loop's definition travels (what a shared loop code carries: name, goal and steps or prompt, how often, time, limits, battery guard), never runs, log, chat, next time, paused state or battery readings: each device keeps its own schedule. A loop from the other device arrives **paused, not started** ("2 loops from the PC; start them under Toolbox → Loops"), so nothing runs on both unless started on each. Merged one by one like assistants (by id; newer edit wins; stopping a loop travels as a tombstone and removes the other copy unless it changed since; kept 30 days under "Loops recently deleted (from another device)" with Restore, which brings it back paused; more than 5 at once: asked first). An edit keeps the loop's own runs and chat on each device. A device with 10 loops takes no more and says so. Code: `src/services/sync/loopSync.ts`.
  - [x] **Deleting an assistant on one device deletes it on the other** (built 2026-11-15; check on devices): the assistants item is now merged one by one: each of your own assistants carries when it last changed on its device, and deleting one leaves a tombstone (id, name, when; last 200, 90 days) in the same list. For each assistant (matched by id, then by name, so the starter assistants each device made count as the same) the newer of its edit and its deletion wins (a deletion wins a tie); an edit after the deletion brings it back. Removed ones are kept 30 days under "Assistants recently deleted (from another device)" (device: Home PC sheet, under keeping in step; PC: home link card) with Restore (counts as edited, so it comes back on the other device too); their picture and model choice are kept with them (the picture file goes when the 30 days are over). More than 5 in one sync: asked first ("Keep them" makes them newer). The sync line / PC notice says "2 assistants deleted on the PC; kept 30 days under Recently deleted". Store assistants are never deleted. Same-name matching means deleting "Helper" on one device also deletes an unchanged "Helper" made separately on the other (restorable). Deletions made before both devices have this version may still come back once. Code: `src/services/sync/assistantDeletes.ts`.
  - [x] **Chats mirrored** (built 2026-11-13; check on devices): own switch on both (PC: under keeping in step; device: the Home PC sheet). Chat versions compared; only newer or missing chats move, newest first within the size room (the rest next time); same ids on both; a Home PC reply reaches the PC about 2 s later; the PC's chats reach the device at its next sync. Not yet: pictures, truly live updates on the PC side.
  - [x] **Deleting a chat mirrors too** (built 2026-11-15; check on devices): deleting a chat leaves a tombstone (id, when; last 500, 90 days), carried both ways inside the chats part of a sync (only while chats mirror). It removes the other device's copy only if that copy hasn't changed since (newer edit wins); the removed chat is kept 30 days under "Recently deleted (from another device)" (device: Home PC sheet; PC: home link card) with Restore (a restored chat counts as edited, so it comes back on the other device too). More than 20 in one sync: asked first ("Keep them" makes them newer, so they come back on the other device). The sync line says "2 chats deleted on the PC; kept 30 days under Recently deleted"; the PC says it in a dialog. Code: `src/services/sync/chatDeletes.ts`.
  - (was) **Chats mirrored** (user, 2026-11-08, after the first real pairing): a chat with the Home PC on the phone shows up on the PC too (and the other way), live while both are on; same history, either device can continue it.
  - Conflicts: last edit wins per item, with the other version kept in history (memory already has snapshots); a changed system prompt shows "changed on your PC" once.
  - Model choice and per-device settings (model files, GPU, storage, permissions) stay per device.
- [ ] Desktop tools in the workspace folder only; voice; quick chat on a hotkey.

- [x] **Ready-made loops**, first version (built 2026-11-13; check on the phone and PC): **Toolbox → Loops**. Pick one of 7 starter loops, fill in the blanks, choose how often (every hour / 3 hours / day at a time / week), how many runs and days, press Start. When one is due (checked every minute while the app is open) the app asks **Skip / Later (1 h) / Run now**; a run is a message in the loop's own chat ("Loop: …"), so every tool switch and "Allow?" still applies. Each reply ends with "Next steps:", shown as tap buttons under it. Running loops: next time, runs so far, last log lines, Run now / Pause / Stop. **Notified when due, even with the app closed** (built 2026-11-15; check on the phone and PC): Toolbox → Loops → "Notify when a loop is due" (on by default). Phone: an inexact alarm per loop at its next time (may be a few minutes late; no new permission, asks for notifications on Android 13+ at Start), set again on every start / run / skip / later / pause / stop and when the app opens; the notification only opens the app, which asks Skip / Later / Run now for that loop. Not shown while the app is on screen (it asks by itself). PC: a system notification when a loop comes due while DesktopAgent is open but behind other windows. Not yet: alarms after a phone restart come back only once the app is opened (no boot permission); a loop's run itself still happens in the app after the tap (never automatic). Still to do from the write-up below: plans as step programs with a dry run, sharing, battery guards. See "Ready-made loops" below.
- [x] **Make a loop from one sentence** (built 2026-11-15; check on the phone and PC): **Toolbox → Loops → Make a loop**. Type one sentence ("help me get fit before summer"), pick Short / Normal / Detailed, press Draft: the loaded model (local or remote, same generation slot as the chat, no tools, one completion) writes a plan as JSON; the app reads it as data only (first JSON object, every field checked, runs/days clamped to the hard limits, steps cut to the level and at most 20). The draft shows name, what each run does, how often, runs/days, the steps (edit, delete, move up/down, add), the plain summary and the whole prompt each run gets; nothing runs before Start. If the reply can't be read: a plain message, Try again or Write it myself. Saved as a custom loop (`templateId: 'custom'`), same limits as the ready-made ones; the steps are a checklist inside its prompt that each run continues. `src/services/loops/makeLoop.ts`, `src/screens/MakeLoopSheet.tsx`.
- [x] **Loops: edit, battery guard, dry run, no-progress stop** (built 2026-11-15; check on the phone and PC): **Edit** on a running loop's card (name, what each run does, how often / time, runs and days within the hard limits, battery, and for "Make a loop" loops the steps checklist; same editor as Make a loop). Saving keeps runs so far, the chat and the log, moves the next time (and the phone's alarm) if the schedule changed, and logs "Edited"; days count from the start, runs never below those done. **Battery (phone)**: per loop, "Only when charging or battery above 20%" (default), above 50%, only on the charger, or any level; when due and not met the app doesn't ask, logs "Waiting: battery" (one line) and looks again in 30 minutes (react-native-device-info, no new native code; the PC has no guard). **Dry run** after Start (ready-made and Make a loop): the exact first message, the next 3 run times, limits and guards, what it may use; "Looks right, start" or Back; sends nothing. **No-progress stop**: after a run's reply is complete, the same next steps (or the very same reply) as the run before → paused, "Paused: no progress for 2 runs" on the card and in a message; Resume starts the check afresh. Only fingerprints are kept, not the reply. Not yet: the notification may still come every 30 minutes while a loop waits for the battery (the alarm can't read the battery; tapping it says why it waits).
- [x] **Loops as plans: the plan is a program** (built 2026-11-15; check on the phone and PC): **Toolbox → Loops → Make a loop → "Steps the app runs (plan)"**. The model drafts the steps as JSON (fixed kinds only: ask the model, use a tool, ask me, wait, check, repeat, notify, save); the app checks them strictly (unknown kinds, tools and fields dropped, with a note shown in the editor), the user edits each step in a plain list (name, kind, inputs, time limit, if it fails: retry once / skip / stop and ask; move, delete, add) and the guards, presses Start, sees the plan's dry run (each step, every question it would ask, the most it could use and which guard that hits; nothing runs, the model isn't asked), then "Looks right, start". When due the app still asks Skip / Later / Run now; Run now runs the steps in the app (not in a chat). A run shows wherever you are (a small window: progress, Pause / Stop, Hide) and on the loop's card: status, the question as buttons, why it paused with its choices, and the trace (step, time, in/out, capped). Guards per run: 50 steps, 10 min working time, 10 model calls, 10 tool calls, a time limit per step, no-progress (same step, same result twice) and runaway (one plan run at a time, a run uses a copy of its plan, nothing in the runner can change a plan, schedule or tool switch); a hit pauses with "stop / continue once / raise the limit" (logged). Saved after each step: after an app restart the run waits; a step that was mid-flight is asked about (run again / skip / stop). Card: Steps (edit = new version; the last 10 kept with Go back), Dry run. `src/services/loops/plan.ts`, `planRunner.ts`, `planStore.ts`, `src/screens/PlanParts.tsx`, `src/components/PlanRunHost.tsx`. Not yet: plan loops can't be shared (Share is hidden on their card) and aren't in loop sync; only the last run's trace is kept; the model can't propose changes to a running plan; a step can't say "on the PC"; step-by-step times (step 4 "Timers"); while the app is in the background a tool's "Allow?" can't show, so that step fails (its on-failure rule applies).

- [x] **Loops: share, what each run did, "May use"** (built 2026-11-15; check on the phone and PC): **Share** on a loop's card gives a `PA1:L:` code (QR when it fits, Copy code, Share as file; packed like tools). Only the definition travels (name, goal and steps or the prompt, how often and when, runs, days, battery guard), never runs, log or chat. Toolbox → Scan QR / Paste a code reads it: the whole loop (every step, schedule and limits, the dry run) before **Install (paused)**; same hard limits, clamped; it waits on its card as "not started" (no Run now) until the user presses **Start** (days count from then). After each run's reply the log says which tools it called ("Run 3: used web_search, read_url"), shown on the card. The summary and dry run add **"May use: …"**: the tools switched on in the Toolbox now, in plain words. `src/services/loops/loopShare.ts`, `src/screens/LoopCodeDialogs.tsx`. Not yet: loops kept in step between paired devices.
- [ ] **Reasoning that doesn't loop** (first real use 2026-11-08: a 2B model with Think on went back and forth "wait, I should…" and never answered "hi"):
  - A thinking budget: a cap on reasoning tokens (setting, default small for small models; llama-server's reasoning budget), then it must answer.
  - Loop guard while streaming: the same phrase over and over in the reasoning → stop thinking and ask for the answer.
  - The model maker's recommended settings per model family when thinking (Qwen: temperature 0.6, top_p 0.95, top_k 20, presence penalty ~1.5 for quantized), applied to Home PC / This PC models too.
  - Think off by default for small models; a short system prompt when no tools are switched on.
  - [x] **What the model sees** (2026-11-08): Toolbox section listing every part the app adds (date/time, global instructions, memory, earlier-chat summary, tool list, tool guidance, the model's built-in prompt), a switch for each, and **Show exactly what the model sees** (built by the same code as sending). Date/time: Off / Date only (default) / Date and time, once, in the background, local time; nothing is added to the user's message any more; web search no longer adds its own UTC date (it disagreed with the local date at night).
  - [x] Memory block: nothing is sent when there are no real notes (empty, or only the starting template `01 =MEM/1 | …`); no empty "Your notes" heading (2026-11-09).
  - [x] **Thinking budget** (2026-11-09): Toolbox → What the model sees → "How long the model may think": Short / Medium (default) / Long / No limit (512 / 2,048 / 8,192 tokens). At the limit the runner ends the thinking with "I have thought enough. Now I will give my answer directly." and the model answers, which also ends "wait, I should…" circles. Same numbers for the phone's own models (llama.rn `thinking_budget_tokens`) and llama.cpp servers (This PC, Home PC: `thinking_budget_tokens` + `reasoning_budget_message`, per request). Other server types ignore it.
  - [x] Loop guard while streaming (2026-11-15; check on the phone and PC): while the model is still thinking, the reasoning is checked every ~160 new characters (`utils/thinkingLoop`): the end is one block repeated 3+ times back to back, or one sentence of 6+ words said 3+ times (openers like "wait," / "but" / "hmm" ignored), or one run of 10 words said 3+ times. On a loop the request is stopped and sent again with thinking off (same messages), so the model answers; the reasoning shown ends with the same "I have thought enough…" line as the budget (`api/loopGuardEngine`). Phone's own models and all servers; not Claude (its thinking is its own). Stop from the user never sends it again.
  - [x] The model maker's recommended settings (2026-11-15; check on the phone and PC): Chat settings sheet → **Use the maker's settings (Qwen3)** for the loaded model, thinking or not. Fills only values still at the app's default; values the user changed stay ("Kept yours: …"); nothing is saved until Save. Families, from the makers' own cards (`utils/makerSettings`): Qwen3 (thinking 0.6 / 0.95 / top_k 20 / min_p 0; non-thinking and Instruct 0.7 / 0.8 / 20 / 0; presence penalty 1.5 for quantized), QwQ, DeepSeek-R1 and distills, Phi-4-reasoning, gpt-oss, Magistral, Gemma 3. Works for Home PC / This PC models too (by the model's name).
  - [x] Think off by default for small models (2026-11-15): models under ~3B parameters (from the model's parameter count, else its name: "1.7B", "270M") start with Think off in new chats; the Think pill still turns it on and that choice is kept. Note: "Reset to global" in an assistant's settings, pressed while a small model is loaded, copies Think off.
  - [x] Short system prompt when no tools are switched on (2026-11-15; check on the phone and PC): the tool line and tool guidance now come only from the tools actually sent that turn (before, guidance like web search's could come from an assistant's or chat's old tool list while the tool itself was off). No tools on: no tool line, no guidance, and no tool list at all (not even an empty one, which made some chat templates write their tool boilerplate); your instructions, memory and date stay as set. "Show exactly what the model sees" uses the same code (`toolPromptPieces` in `utils/globalToolSettings`).
  - (was) **Time without the fixation** (2026-11-08: a 2B with Think on dwelt on "(Sent at 23:29, UTC-08:00)"): a setting "Tell the model the time: always / date only / off"; put the time in the prompt's background block ("Current time: …") instead of on the end of the user's message, worded so it isn't read as part of the question. Each device uses its own clock (both set automatically from the network); when the phone uses the Home PC, the phone's time is sent. If phone and PC report different UTC offsets over the home link, say so once (seen 2026-11-08: BC went permanent UTC-7 in 2026; a PC on old Windows Pacific rules showed UTC-8).

- [ ] **Find the fit** (user, 2026-11-08): the PC app works out which models this PC can run, so nobody needs to know about VRAM or quantisation.
  - Read the hardware on the native side: graphics card(s) and their memory (Windows: DXGI; Linux: Vulkan), RAM, CPU cores (RAM/cores already via `system_info`).
  - For each model (Hugging Face search, downloads, files picked): estimate memory needed (file size + room for the conversation at the chosen context) and show a label before download: "Fits on your graphics card (fast)", "Fits, partly on the card (medium)", "Runs from memory only (slow)", "Too big for this PC". Pick the best quantisation that fits (e.g. Q4_K_M → Q3 → Q2 for big models).
  - Mixture-of-experts models (e.g. 30B with ~3B active) marked as good picks for PCs with lots of RAM and a weak card.
  - [x] Load with llama.cpp splitting layers between card and RAM to fit (2026-11-09): `--fit on` (llama.cpp's own fitting, leaves 1 GB free per card); `--n-gpu-layers 999` removed (it turned fitting off, so a model bigger than the card failed).
  - [x] Graphics cards read through the bundled llama.cpp (`--list-devices`, the same Vulkan driver the model runs on), once per app start: name, memory, and whether it is built into the processor (Vulkan's `uma`; its memory is the PC's own, not counted twice). The PC's memory limit for models is memory + the cards' own memory. Models and downloads say where they run: "Fits on your graphics card (fast)", "Partly on your graphics card (medium)", "Runs in memory, no graphics card (slow)", "Too big for this PC". Settings → Run a model on this PC shows what the PC has.
  - [x] Labels before download (2026-11-15; check on the phone and PC): Hugging Face files and not-yet-downloaded models in the list show "Needs about 5.1 GB · Fits on your graphics card (fast)" (PC: the existing card / partly / memory / too-big labels) or "Fits on this phone" / "Just fits: close other apps first" / "Too big for this phone" (phone: memory only, the same limit as the memory warning). Needed = (file + room for the conversation at the chosen context) + 10 %; before download the room per token is a rule from the model's size (64 KB + 12 KB per billion parameters, at most 384 KB; `utils/modelFit`), after download the exact estimate from the file is used as before.
  - [x] Mixture-of-experts models (names like "30B-A3B", "8x7B", "MoE", gpt-oss, Mixtral, DeepSeek V2/V3, Llama 4 Scout/Maverick, GLM-4.5-Air) say "Mixture of experts: good on PCs with lots of memory", in search results and on files (2026-11-15).
  - [x] After the first replies, show the real speed (tokens/s) and remember it per model on this device (2026-11-15): from the runner's own timings (replies of 16+ tokens), an average that follows the latest 10 replies, shown next to the model's size in the model list (`utils/modelSpeed`). Not yet: picking the best quantisation that fits.
  - Big models (40–70B) on new PCs: about 25 GB (40B) to 42 GB (70B) at Q4; fast on 48 GB of graphics memory (e.g. two 24 GB cards) or on PCs with large shared memory (e.g. 96–128 GB unified-memory mini-PCs); usable from 64 GB RAM at a few tokens/s. The fit check says which, per PC.
  - [x] Check model type support against the bundled llama.cpp (b11662) and say "needs a newer llama.cpp" instead of failing (2026-11-15; check on the PC with a model type newer than b11662): the PC app reads the model server's log (in memory only, last 40 lines, never shown as is). When llama.cpp stops with "unknown model architecture: '…'", Load says "This model (…) needs a newer llama.cpp than the one bundled (b11662). Try another model, or a newer DesktopAgent when there is one." at once, instead of waiting two minutes for "The model did not start". Not yet: a note before download (needs the file's model type, only known after download), and a phone starting the PC's model still just times out.
- [ ] **NPU on the desktop** (user, 2026-11-08): big models stay on the graphics chip (memory speed is the limit; llama.cpp has no desktop-NPU backend). Use the NPU (AMD Ryzen AI / XDNA via Ryzen AI software or Lemonade, Intel Core Ultra via OpenVINO) for small always-on helpers at low power: wake word, speech to text, the "ask your documents" index, a small quick-reply model. The phone already has a Hexagon NPU build. Qualcomm Snapdragon X PCs need an ARM build of DesktopAgent first.
  - **Research (2026-11-15; some vendor facts second-hand, marked in the notes):** llama.cpp now has an OpenVINO backend that runs on Intel NPUs, and our pinned release (b11662) ships ready-built OpenVINO `llama-server` builds (about 100 MB, Windows x64 and Ubuntu; MIT + Apache-2.0): `GGML_OPENVINO_DEVICE=NPU`, same API and GGUF files, but early (fixed small context `-c 1024`, one slot, slow first load, not every model). AMD: FastFlowLM 1.0 (`flm serve`, OpenAI-style, Windows + Linux, about 17 MB; code MIT, NPU parts closed but free to redistribute, also commercially) on Ryzen AI 300/400/Max only, not 7040/8040/8000G. Qualcomm (GenieX) needs proprietary libraries and an ARM64 build: last. Speed: a 1B model on AMD's NPU about 40–63 tokens/s; no good Intel NPU figures (users say slower than Intel's built-in graphics). On a PC with a graphics card the gain is mostly that helpers don't compete with the big model, plus lower power on laptops.
  - Plan: step 0 detect the NPU without admin rights (Windows: "Neural processors" devices by hardware ID; Linux: `/sys/class/accel/*` with `amdxdna` / `intel_vpu`), 1–2 days. Step 1: a small helper model on the NPU (Intel: OpenVINO llama-server; AMD: FastFlowLM) for chat titles and next-step chips, falling back to the CPU, 3–5 days. Later: memory search embeddings, then speech to text. **Owner question: which CPU is in your PC?**

- [x] **PC to PC link** (built 2026-11-12; check on two PCs): Settings → "Pair a phone or PC" shows the code as text with **Copy**; paste it into the other PC's DesktopAgent (Models → add a server, address box). Details: a second PC (e.g. a Linux laptop) uses the main PC's model like the phone does. The phone's link library (`native/homelink`, plain Rust) goes into DesktopAgent too; the main PC shows the pairing code as text as well as the QR (a laptop has no camera to scan), pasted into the laptop's DesktopAgent; same rules (one-time code, 10 minutes, the main PC asks; the laptop reaches only the model server; listed and removable on the main PC). The main PC appears on the laptop as a "Home PC" server.
- [ ] **All devices in one circle** (user, 2026-11-12): Windows desktop, Linux laptop, Android phone. Each device pairs once with each other one it should reach (or with one "home" device that introduces the others, asking on both), so it's a small group of known keys, not an account or a server. Over the same encrypted link: any device can use any other's model (each switched on per device); sync (system prompt, memory, assistants, custom tools, chats) is the "Sync phone and PC" item above, extended to every device in the circle; tools stay on their own device and ask there (or on another device with the exact question mirrored, "The PC asks, the phone can answer"). Removing a device on any one of them tells the others (signed by a device they already trust).
  - Design to decide: [docs/design/device-circle.md](docs/design/device-circle.md) (options, threats, staged plan, open questions).
  - **Decided (owner, 2026-11-15):** Option A now, introductions later. (6a) every device obeys a signed removal from any device in the circle. (7a) introductions from a home device later, after stages 1–3. (8b) moving a PC to one key: pair again by hand (no automatic migration). (9a) a device that receives a removal removes it and tells the user. (10a) permissions per pair of devices.
  - [x] **Stage 1: one key per PC, "Your devices"** (2026-11-15; check on the phone and both PCs): a PC is one key as a home PC and as a device of another PC (the same iroh endpoint; switched off, it still lets no device in). New installs use one key from the start; a PC that already had its own device key keeps it until Settings → "Use one key for this PC", which says that its pairings as a device must be made again by hand (decision 8b; the old key is kept, unused). "Your devices" (Settings, on the phone and on the PC inside "Use this PC's model from your phone") lists every device paired either way: name, short key, direction, when paired, and what this device gave it (per pair; the PC's per-device switches sit in each row). Removing there is what removing did before, on that device only; telling the others is stage 2. Rust tests pin: a PC's device key is its link key unless it already had its own (no automatic move); rights off for old and new records; a right is saved only after the PC's own dialog.

- [ ] **ARM Linux build** (user, 2026-11-12: a PineTab 2 to test on): the Linux build is x86 only; add an arm64 build (GitHub's ubuntu-24.04-arm runners; llama.cpp built for arm64, no Vulkan on that tablet's GPU: CPU only). A small model on a tablet, or the PC's model through the PC-to-PC link.

**3. It learns you (later)**
- [ ] Daily personal training (PC trains, phone learns, raw data deletable). Small models keep improving; style and habits first, exact facts stay in memory notes.
  - [x] **Loading adapters** (2026-11-15): add a LoRA .gguf under a model (Model settings → Adapters, through the app's own file import into `Documents/models/lora`; on the phone a file made for another model type is refused), choose Off or one adapter with a strength (0.2–1), remembered per model; the model's name shows "+ my-style (0.8)". Phone: applied in place with llama.rn (no reload; Off is instant). Desktop: the model server restarts with `--lora-scaled`. Several dated versions kept; switching back is the rollback. Still to do: the training itself, the checks before an adapter is used, and choosing adapters for the PC's model from the phone.
  - **Research (2026-11-15; times are estimates from public figures, nothing measured):** an 8 GB NVIDIA card can train small models overnight with PyTorch + PEFT/TRL (Apache-2.0) and bitsandbytes (MIT): QLoRA on a 4B model about 4–6 GB of graphics memory; a day's new examples in minutes, a full 1–5k-turn retrain in about 15 min–3 h. Unsloth: core Apache-2.0 only (its Studio is AGPL). llama.cpp's own LoRA training isn't merged yet (CPU-only pull request, Nov 2026). AMD training on Windows is unproven. Base model: Qwen3 (Apache-2.0); not Gemma (Google) or Llama (not permissive).
  - Back to the phone: a rank-16 adapter is about 35 MB (1.7B) / 66 MB (4B) as GGUF; llama.rn (in this repo) and llama-server can load adapters at run time, so no merging and instant rollback.
  - Safe data: only the user's own words and replies they liked (no tool output, web pages, notes or other people's messages); secrets filtered on the phone and duplicates removed; each adapter checked before use (own test prompts, tool calls still valid, secret probes); dated versions to roll back.
  - Recommendation: better memory first (search over notes and past chats instead of sending all notes); adapter loading on both devices; then training as an optional NVIDIA-only "Trainer" download (about 3 GB, pinned, built in Actions), never bundled in the installer. **Owner questions:** which graphics card; which model family both devices share; is a 3 GB optional download OK; delete all raw data, or keep a small encrypted set for retraining.
  - **Decided (owner, 2026-11-15):** graphics card NVIDIA; shared model family Qwen3; a ~3 GB optional Trainer download is fine; raw training data kept (not encrypted for now; revisit once training works). CPU unknown: the NPU step waits until the app can detect it (step 0 detection first).
  - [x] **Memory search** (2026-11-15; check on the phone and PC): Toolbox → What the model sees → Memory: "Send all notes" (default, as before) or "Only notes that match": for each message the app sends only the notes with the same words (up to 8, about 2,000 characters; word matching with BM25, light English stemming, any script, Chinese/Japanese/Thai by characters; model memory's format line goes along). Optional "Also search earlier chats" (off): up to 3 short pieces of the user's own earlier messages (one per chat, labelled with chat name and date; never the current chat, deleted chats or chats with a deletion from another device), wrapped as untrusted text. "Show exactly what the model sees" lists the notes picked for the last message. Embeddings not used yet: llama.rn embeds only with a context loaded with `embedding: true` (a second copy of the chat model) and chat models rank notes poorly; a server's `/v1/embeddings` would send every note on each message. Later: a small embedding model (e.g. on the desktop NPU).

**4. Further, optional**
- [ ] More devices (laptop, second phone, an always-on home box); a family sharing one home model, each with their own space; errands across devices under the same rules.

**Not chasing:** cloud features or accounts; beating big cloud models on raw smarts; many platforms at once (Windows + Android first, then Linux).

**Before releasing to people: a full security audit**
- [ ] Our own full audit of both apps and the link (like the 2026-11-06 one, plus the desktop and the link): every door, every approval, every stored secret, every way in from outside (QR codes, links, model output, pages, paired devices).
- [x] A public security policy (SECURITY.md: how to report a problem privately, what's in scope, response times) and a changelog of security fixes (2026-11-15: `.github/SECURITY.md`, `docs/security-changelog.md`).
- [ ] Invite testers: early users run the test builds and try to break it; credit them. Fix before widening the release.
- [x] Builds anyone can check: published checksums for every download (signing optional, our own key) (2026-11-15: `SHA256SUMS` with every release; APK signing ready for the owner's key, see Pre-release).

**Home link: ways in (review 2026-11-12)**. The link itself is encrypted end to end (QUIC + TLS 1.3, each device pinned by its key; relays see only encrypted bytes). The weak points are the two ends and the metadata:
- [x] **Model server password in the process list** (fixed 2026-11-12): llama-server gets its random password as a command-line argument, which any program on the PC can read. Pass it by environment variable or a file only the app can read instead.
- [x] **Phone tunnel reachable by other apps on the phone** (fixed 2026-11-12): it listens on 127.0.0.1, so any app on the phone can connect; llama-server's `/health` answers without the password (tells whether a model runs). Pass only model requests through the tunnel and require the password on everything (or a per-start token on the local port).
- [x] **Stolen, unlocked phone:** it can use the PC's model (nothing else). Optional PIN / fingerprint before the Home PC is used; "remove this phone" stays the fix on the PC. (2026-11-15: PIN, and fingerprint on Android, see Pre-release → Security; it doesn't protect what is already on the phone, SECURITY.md rule 5.)
- [ ] **Keys at rest:** the PC's link key is in Windows Credential Manager (readable by any program running as the same user); the phone's key is in the app's no-backup folder (readable on a rooted phone). Malware on either end sees everything; document it plainly, and consider sealing the PC key to this PC (DPAPI / TPM) so a copied key is useless elsewhere. (Documented 2026-11-15 in `docs/privacy.md`; sealing still to decide.)
- [ ] **Metadata:** ISP, Wi-Fi / hotspot and number0's relay and discovery servers see that the two devices talk, their IP addresses, when, and how much (not the content). Document it; consider padding / an own relay later. (Documented 2026-11-15 in `docs/privacy.md`.)
- [x] **Pairing:** the QR code is one-time, 10 minutes, and the PC asks; the phone is told about every new code. Keep; test that an old or reused code is refused (tests added 2026-11-15, `link.rs`).
- [ ] **Signed builds:** sign the Windows installer and the APK with our own keys and publish checksums, so a swapped download is caught. (Checksums published and APK signing ready 2026-11-15; the owner's key and a Windows certificate remain, see Pre-release.)
- [x] iPhone / web version: not made (decided 2026-11-12: no Apple, no iPhone).

**Paired devices: sync, mirrored chats, answers (review 2026-11-15, app side; the native side is its own list)**
- [x] **Synced custom tools stayed on** (fixed): a tool that a sync adds or changes, or that a sync removes, is switched off before the new list is saved; deleting a tool always switches its name off, so a later sync can't bring it back on. Unchanged tools keep their switch. A Toolbox open during a sync can't switch one back on either: every switch change is one name (or group) against the stored list, one at a time, and the open Toolbox reloads when the stored switches change.
- [x] **A time far in the future won forever** (fixed): times from another device count as at most 5 minutes ahead (prompt, memory, assistants, tools, chats, chat deletions); what is applied is stored with this device's own time, so an injected edit no longer comes back after the PC user fixes it. A future time stored before the fix is brought back to now.
- [x] **Mirrored chats carried any metadata** (fixed): only messages from the user, the assistant or a summary, of the kinds the app saves (text, reply); only known metadata keys, each checked (no picture paths, no audio file, no author id; a key naming a file is dropped). A copy that drops or changes messages here keeps the earlier version 30 days under "Recently deleted" (restorable); with no room to keep it, the copy is not taken.
- [x] **Pictures sent to a server** (fixed): the app never passes a web address on as a picture (the server would fetch it from its own network) and reads only pictures in its own folder (camera, gallery and workspace copies; on the PC imports and screenshots).
- [x] **Long PC questions on the phone** (fixed): never cut at the end; a question too long to show whole shows its start and end with the count left out, and can only be refused on the phone ("answer on the PC"). Direction and invisible characters show as markers (⟦U+202E⟧).
- [x] **"Kept in step" dialogs piling up on the PC** (fixed): one at a time; later ones are shown together after it closes.
- [x] **Store assistants rewritten by a sync** (fixed): only your own assistants are matched and updated.
- [x] **Loop next-step buttons cut at 2 lines** (fixed): a step's whole text shows on its button; steps over 80 characters are not offered.
- [ ] Check on the phone and the PC: a mirrored chat with pictures (the pictures stay, the other side shows the text), "Recently deleted" showing "earlier version", a long "Allow?" question on the phone (start and end, Don't allow only), next-step buttons in a loop chat, sending a gallery picture and a camera picture to a cloud vision model (still works; only pictures in the app's own folder are read).

## Ready-made loops: timer + next steps, for beginners (idea 2026-11-08, write-up only)

A loop is a small agent job that comes back on a timer: it does its part, shows the result, and ends with **next steps** the user can tap. Ready-made ones in a gallery, so nobody has to know what an "agentic loop" is.

**The shape of every loop (user, 2026-11-08): Prompt → Research → Breakdown → Timers → Continue → Ask**
1. [x] **Prompt:** the user says what they want in one sentence ("help me get fit before summer", "plan my move"); or picks a ready-made loop, which is this sentence filled in. (Built: "Make a loop".)
2. [ ] **Research:** the model gathers what it needs with the tools that are switched on (web, memory, workspace files; the PC's tools over the home link later), and shows what it found and where from. (Not yet: drafting uses no tools; research happens in the runs, in the loop's chat.)
3. [ ] **Breakdown:** it turns the goal into small, concrete steps with rough times, shown as a checklist the user can edit, reorder or delete before anything starts. (Built: the checklist, editable before Start. Not yet: rough times per step.)
4. [ ] **Timers:** each step gets a when (a time, "every morning", "in 2 days", "after step 3"); the user sees the whole schedule and can change any of it. Limits (how often, end date, battery) are set here.
5. [ ] **Continue:** at each timer the loop picks up where it left off: does its part of the next step, updates the checklist, and adjusts the plan if something changed.
6. [ ] **Ask:** before anything that matters (an action outside the app, changing the plan, spending, sending, more time) it asks; and at each check-in it asks the user how it went, then shows the next steps as buttons. No answer = it waits, it never guesses ahead.
- [x] One **"Make a loop"** button: type the sentence, the app runs steps 2–4 and shows the plan for approval; nothing runs before the user presses Start. (Built 2026-11-15: steps 3 and a single timer for the whole loop; not yet research before drafting, nor a timer per step.)

**Agentic planning: the plan is a program (user, 2026-11-08)**
- [x] A plan is saved as structured steps, not chat text, and run by a fixed runner in the app, step by step, like a small program. It stays data, never code (rule 4): the runner only knows a short list of step kinds, and the model can't add new ones. (Built 2026-11-15, as an extra kind of loop; chat-message loops work as before.)
- [x] Step kinds: **ask the model** (a prompt, with the results of earlier steps filled in), **use a tool** (built-in, behind its switch), **ask the user** (a question or a choice, as buttons), **wait** (a timer or a time), **check** (a simple condition on earlier results: done / not done, changed / not changed, a number above or below), **repeat** (a block, with a maximum count), **notify**, **save to memory or workspace** (asks first). (Built 2026-11-15: `{{step:N}}` fills in step N's result as plain text; ask me has 2–4 buttons; wait is a duration (not yet a clock time); check: contains / doesn't contain / changed since the last run / number above or below, then skip the next step or end; repeat: the next N steps up to 10 times, no repeat inside a repeat; notify: an in-app alert (not yet a system notification); save appends to memory or a workspace .md/.txt file through those tools' own "Allow?".)
- [x] Each step has: a name the user can read, inputs (from the user or earlier steps), what it produces, which tools it may use, a time limit, and what happens if it fails (retry once, skip, or stop and ask). (Built 2026-11-15; "what it produces" is its result, shown in the trace.)
- [ ] The model writes the plan from the user's sentence (Prompt → Research → Breakdown → Timers); the user sees it as a readable checklist / flow, can edit any step, and starts it. The model can propose changes later, but only the user applies them (shown as a before/after). (Built 2026-11-15: drafted from the sentence, edited as a plain list, started by the user. Not yet: research before drafting, per-step timers, model-proposed changes with a before/after.)
- [x] **Dry run** before starting: walks through the plan without doing anything outside the app, showing what each step would do and which questions it would ask. (Built 2026-11-15 for today's loops: the first run's exact message, the next 3 times, limits, guards, what it may use. And for plans: each step, switched-off tools, every question, the most it could use against the guards; also on the card.)
- [x] Every run keeps a trace: which step, when, what went in and out; resume after the phone or PC restarts exactly where it stopped; pause / step through / stop at any time. (Built 2026-11-15: the trace is capped (100 lines, 200 characters each; only the last run's is kept); after a restart the run waits for the user, and a step that was mid-flight is asked about, never re-run by itself.)
- [ ] Versioned: each edit makes a new version; going back is one tap. Ready-made loops are just shipped plans; shared plans (QR / file) are reviewed and installed off, like tools. (Built 2026-11-15: versions of a plan, the last 10, Go back. Not yet: ready-made loops as plans, sharing plans.)
- [ ] Runs where it fits: the phone for quick steps, the PC (home link) for long or heavy ones; a step can say "on the PC", and the PC's questions can be answered on the phone.

- [ ] **The user chooses how many steps** (user, 2026-11-08): a detail level when making the plan (Short ≈ 3 steps, Normal ≈ 5–7, Detailed ≈ 10–15, or an exact number), and a hard maximum per plan (default 20, settable). The model must fit the plan to it; asking for more steps later is a plan change the user approves. (Built: Short / Normal / Detailed, the draft cut to the level, hard maximum 20; the user can add steps up to 20 before Start. Not yet: an exact number, a settable maximum, changing steps after Start.)
- [ ] **Loop guards** (all on by default, shown on the plan's card, only the user can raise them):
  - [x] Each **repeat** block has a maximum count; each plan a maximum number of steps run in total and a maximum run time. (Built 2026-11-15: repeats ≤ 10; per run 50 steps and 10 minutes of working time by default (waits and questions not counted), plus a time limit per step.)
  - [ ] A budget per run: model calls, tool calls, tokens; on the phone also battery (stop below a level, heavy work only on the charger). (Built 2026-11-15: the battery part, as a guard before asking; model calls (10) and tool calls (10) per plan run. Not yet: tokens; battery checked during a plan run.)
  - [x] **No-progress stop:** the same step with the same result twice in a row, or a check that never changes after N tries → pause and ask the user instead of looping. (Built 2026-11-15: two runs in a row with the same next steps or the same reply → paused, reason on the card. Plans: the same model or tool step with the same result twice in a run → paused. A check that never changes is bounded by its repeat's count.)
  - [x] **Runaway stop:** no plan can start another plan, schedule itself more often, or edit its own steps, tools or guards. (Built 2026-11-15: one unfinished plan run at a time; a run uses a copy of its plan; no step kind or tool a plan may use changes plans, schedules, tool switches or tools (tool_save / tool_delete refused); steps can't be edited while a run is unfinished.)
  - [x] When a guard is hit: pause (never silently retry), show which guard and why, and offer: stop, continue once, or raise the limit (the user's choice, logged). (Built 2026-11-15 for plans: continue once = one more, raise = double up to a hard cap; in the run's trace and the loop's log.)
- [ ] **Still asks the user**, whatever the plan says: ask-the-user steps can't be skipped by the model; anything outside the app, any phone action, and anything dangerous (send, buy, delete, run a command) asks every time; no answer = the plan waits.

**How it looks to the user**
- [x] A **Loops** gallery: each card says in one line what it does, how often, and what it may use. Pick one, fill in the blanks (topic, time, how long), press Start. No prompt writing.
- [x] Before it starts, a plain summary (built for "Make a loop": how often, runs, days, asks before each run, and the whole prompt; the "May use" line with the tools switched on now, 2026-11-15): "Runs every day at 7:00 for 2 weeks. May use: weather, calendar, memory (read). Never sends, buys or deletes anything."
- [x] Each run ends with a short result and 1–3 **next steps** as buttons ("Do step 2 now", "Remind me at 5", "Done, skip ahead"). Tapping one continues the loop; ignoring it is fine.
- [ ] A **Running loops** list: next run time, runs so far, Pause / Stop / Edit; a notification per run (can be turned off). (Built: next time, runs, log, Run now / Pause / Stop, a notification when due with an on/off switch (2026-11-15). Not yet: Edit.)

**Starter loops (examples)**
- [x] Morning brief: weather, today's calendar, reminders from memory → three things to do first.
- [x] Focus timer: 25 min work / 5 min break; at each break asks what got done and suggests the next small step.
- [x] Goal planner: give a goal ("learn Spanish basics", "clean the garage"); it breaks it into steps and each day offers the next one, checking what's done.
- [x] Evening review: what went well, what's left; tomorrow's first steps saved to memory (asks before saving).
- [x] Watch a page: checks a web page every few hours and tells you only when it changes.
- [x] Habit check-in: a daily question ("water? walk?"), a streak, and a gentle next step.
- [x] Learn something: a short lesson a day on a topic, with a quiz question; the next lesson builds on the answers.
- [ ] With DesktopAgent (home link): a long job runs on the PC overnight (summarise a workspace folder, a long draft) and the phone gets the result and next steps in the morning.

**Rules (same as everything else; a loop is data, never code)**
- [ ] A loop is a ready-made custom tool with a timer: built-in tools only, each still behind its Toolbox switch; phone actions and anything outside the app still ask every time. Installed off; shown in full before starting.
- [ ] Hard limits on every loop: how often, how many runs, an end date (built: runs ≤ 60, days ≤ 60, at most 10 loops, never more often than its interval, counted before it runs; not yet: time/battery budget), a time/battery budget per run (phone: only on the charger for heavy ones); stops by itself when reached.
- [x] A loop can't start other loops, change its own tools or timer, or raise its limits; only the user can. (A loop is saved data the model never sees as editable; there is no tool for loops.)
- [x] Every run is logged (what it did, which tools); the log shows on the loop's card. (2026-11-15: "Run 3: used web_search, read_url" after the reply.)
- [ ] Phone: runs through Android's job scheduler (may be a few minutes late; exact times only for alarms the user sets). Desktop: runs while DesktopAgent is open (tray later). (Built 2026-11-15: the phone notices a due loop while closed (inexact alarm → notification → tap → the question); the run itself stays in the app after the tap, by the rule "nothing runs without a tap". Desktop: notification while open in the background; nothing while DesktopAgent is closed.)
- [x] Sharing loops: as a QR / file like tools (`PA1:L:`), reviewed before install, installed off. (2026-11-15: installed paused, not started; Start on its card.)

## Current validation and fixes

- [x] Memory editor easy to reach: **Toolbox → Memory**, above Global System Prompt; History lists every snapshot to preview and restore (PR #5).
- [x] Memory is added to the model's context on every run, User Memory has no model write tool, Model Memory writes need approval (code + tests, PR #5).
- [x] Fix HTML preview stuck on **Loading…** in chat: JavaScript was disabled (PR #4).
- [x] Render generated HTML/CSS/JavaScript live inside chat, including updating clocks and timers (PR #4).
- [x] Save generated pages as `.html`: to the workspace or via the share sheet.
- [x] Add sandbox restrictions, load/error timeouts, and regression tests for embedded HTML (PR #4).
- [x] `read_url`: strict port matching for user-named sites, no https→http downgrade, redirect-escape tests.
- [x] `read_url`: the default reader is now **the phone itself** (no r.jina.ai): it fetches the page directly, the final URL after redirects comes from the network layer (verified), and the HTML becomes plain text on the phone. Provider readers that can't attest the final URL fall back to it. Fail-closed checks unchanged (allowlist, no https→http downgrade).
- [ ] Phone check: search, then "read the first result"; a page that redirects; a PDF / non-HTML link (refused cleanly).
- [x] **Web search is free, no key:** the paid providers (Brave, Tavily, Exa, Firecrawl, Parallel — all need sign-ups now) are no longer offered; their adapters stay in the code, not selectable. The one search is **DuckDuckGo**, done by the phone from its plain HTML results page (not an official API: can change or rate-limit, and says so). Reading a page needs only the consent, no key.
- [ ] Phone check: consent, then "search the web for …" and "read the first result"; a few searches in a row (rate limit message).
- [x] The consent text in every language now says what really happens (DuckDuckGo from the phone, pages fetched directly, nothing to PocketAgent; no keys) (2026-11-15). The other languages were rewritten from the English; a native speaker check is welcome.
- [x] `read_url`: an http page and its https version count as the same page (https preferred when both are allowed).
- [x] Workspace file operations: `file_append`, `file_patch`, `file_diff`, `file_history`, `file_undo`; per-file version history; diff shown in the approval dialog.
- [x] Fix newline (`file_read_range`, `file_search`) and extension (`file_info`) matching bugs.

### Phone checks

- [ ] Memory: save both memories, History → pick a snapshot → restore, and a model memory edit asks for approval.
- [ ] HTML preview: a generated clock ticks in chat and fullscreen; code view, copy, fullscreen, Save to workspace, and Share work.
- [ ] Workspace tools: append / patch / undo through chat, with the diff in the approval dialog.

## Confirmed on the phone (2026-11-05)

- [x] Claude: chat, tools, memory, file_create, HTML preview.
- [x] Gemini (free): chat, tool calls (HTML clock, cat drawing), Live/TTS models hidden, the 400s fixed (`max_tokens -1`, Claude engine on a Gemini address).
- [x] Switching from a cloud model to a local one releases the server.
- [x] Granite 3.0 1B-A400M (MoE) runs (~6.7 tok/s); too small for tool calls.
- [x] memory_replace with approval.
- [x] Pictures: SmolVLM with Vision on describes a photo; a text model switches to SmolVLM and back; a photo picked through Files attaches as a picture.
- [x] HTML preview no longer cut off (fit / inner scroll / fullscreen).
- [x] Declutter: 4-item side menu; Settings links, Chat section and Advanced fold; + Add model at the top; Save button visible.
- [x] Hugging Face search: "Granite moe" finds the Granite a400m / a800m MoE repos.
- [x] Phone actions: approval dialog, then Maps opens (navigate_to).
- [x] Phone actions: "text Mack Attack hello mack" finds the contact and opens Messages with the words unchanged; one call, one short confirmation (Gemini 3.1 Flash Lite).
- [x] 2026-11-06, build 42196457922: first reply on Qwen3.5 2B with tools off in **~2 s** (1964 ms to first token, 6.2 tok/s), down from ~20 s. Sending only switched-on tools fixed it; memory still in the prompt (it used the name Jon).
- [x] 2026-11-06: free search (DuckDuckGo, no key) finds 5 results and the model answers from them. Seen: the model guessed the year (searched "2025"), and the reply after the results took ~15 s (reading 5 results). Done: today's date at the start of the prompt (changes once a day, so the phone keeps reusing earlier work) and the local time on the end of the newest message, fresh each message; only what is sent changes, the chat stays as typed. Kept 5 results (Settings slider). Phone check: ask "what's the date and time?" and a search that needs the year.
- [x] 2026-11-06: PocketAgent can be picked as the Default digital assistant app; long-press power opens it straight to the mic listening.
- [x] 2026-11-06: the memory block's wording ("Never modify User Memory via tools", "writes require approval") made Qwen 2B loop over a name change with the memory tools off. Now the prompt has just the notes with short labels; how to change memory (and that the user approves) is in the memory tools' own descriptions, sent only when they are on. Phone check: tell it a new name with memory tools off, then on.
- [ ] Next build (not yet on the phone): Vision switch in the ⚙ sheet, a picture turns a switched-off vision model on, readable daily-quota (429) error with no retries, Attach to chat from the Workspace list.

## Context summary ("Summarize & continue")

When a chat fills the model's memory, older messages are replaced, for the model only, by a short summary the model writes. This frees up context without starting a new chat.

- [x] Automatic: when a turn ends at 80% full or more (local models), the app summarizes once the turn is over, then shows "earlier messages were summarized" with Undo.
- [x] Button: **Summarize & continue** on the "getting full" and "full" banners.
- [x] The last 4 messages are kept word for word. The model sees: system prompt + summary + kept messages + anything newer.
- [x] Older messages stay on screen, greyed. A card in the chat shows the summary, with Show, Edit and Undo (Undo restores the full context).
- [x] Summarizing again folds in the previous summary. Long chats are summarized in chunks that fit the context.
- [x] On failure nothing changes, and the app says so.
- [ ] Phone check: fill a chat until the banner appears, summarize (button and automatic), keep chatting and check the model remembers earlier facts, then Edit and Undo.

## Auto-switch to a vision model for pictures (built, needs phone check)

Goal: when you attach a picture while a text-only model is loaded, the app switches to a vision model automatically instead of ignoring the picture. Research done 2026-11-03; built 2026-11-04 (see Steps).

### What happens today (research findings)

- **Pictures are silently dropped for text models.** `useChatSession` sends images only when `activeModelCaps.visionActive` is true; otherwise the message goes out as text only and a "multimodal not enabled" warning appears. Older pictures in the conversation are also dropped for text models (`convertToChatMessages(…, isMultimodalEnabled)`).
- **You can't easily attach a picture to a text model:** the attach menu only shows Camera / Gallery when the loaded model can see (`isVisionEnabled`); Files and Workspace stay.
- **Vision = model + projector.** A local model can see only if it has `supportsMultimodal`, vision is switched on for it (`setModelVisionEnabled`), and its projector (mmproj) file is downloaded (`hasRequiredProjectionModel` / `getProjectionModelStatus`). Remote server models report vision through `serverStore.remoteCaps`.
- **Loading already does the hard parts.** `modelStore.initContext(model)` releases the previous model, loads the projector, checks memory and **asks you** if it might not fit (`checkMemoryAndConfirm`), and handles "last request wins" when loads race. `selectModel` also covers remote models.
- **A small vision model already ships as a preset:** SmolVLM2-500M-Instruct (Q8_0, ~437 MB + ~109 MB projector), used by the built-in "Lookie" pal (`LOOKIE_DEFAULT_MODEL` in `builtinPalModels.ts`). Good default suggestion for a first vision model.
- Pals can name a default model (`pal.defaultModel`); a switch must not silently change a pal's saved model.

### Design

**Trigger:** you attach (or take) a picture and press send, the loaded model can't see, and a usable vision model exists.

**Choosing the vision model:** no fixed model. The app already knows which downloaded models can see (the vision badge / `capsFor` + a ready projector), so it picks from those:
1. the last vision model you used;
2. otherwise the best-fitting downloaded vision model (the one the memory estimate says fits; if several, the most recently used);
3. none downloaded → a short message that no downloaded model can see pictures, with a button to the Models screen. Nothing downloads on its own.

**What happens on send — seamless switch (decided 2026-11-04):** you attach a picture while a text model is loaded and press send; the app switches to the vision model automatically and the chat simply continues on it with your picture. No question first; a status line and an **undo** (switch back to the previous model) are shown. The memory check still asks if the vision model might not fit; cancel = draft and picture kept, nothing changed.

(Considered and not chosen: "look, then hand back" to the text model.)

**Never lose the picture's content:** whatever the vision model says about a picture is saved on that message as a short text note (e.g. "Picture: café receipt, total €12.40, 3 Nov"), so later turns with a text model still know what was in it.

**Switching back is quick when there's room:** on phones with enough free memory (the existing memory estimate), the previous model can stay loaded so undo / switching back skips the reload; otherwise it reloads.

**UI:**
- Camera / Gallery always offered when a vision model is available (or can be downloaded), not only when the loaded model can see.
- A clear status in the chat: "Switched to <vision model> to see your picture" with **Undo**.
- Pals: a temporary switch doesn't change a pal's saved default model.

**Safety and limits:**
- The memory check still asks before loading something that may not fit; cancel = picture not sent, nothing changed.
- Remote (server) models: switch only to another model on the same server that reports vision, or ask.
- No network involved for local models; pictures stay on the phone.

### Steps

- [x] `visionModels` / `pickVisionModel()` in ModelStore: last vision model used, otherwise the smallest (most likely to fit); projector must be downloaded. (Size stands in for the memory estimate; the loader's memory check still asks before loading.)
- [x] Attach menu: Camera / Gallery shown when any downloaded model can see.
- [x] Switch before sending (in the chat input, before the draft is cleared): if pictures + no vision → switch through `initContext`, then send; cancelled or no vision model → draft and pictures kept.
- [x] "Switched to … to see your picture" notice with Undo (reloads the previous model).
- [x] Text-only models get a short note where a picture was ("[1 picture attached here; this model cannot see pictures …]") instead of the picture silently vanishing. Simpler than a separate stored description: the vision model's own reply already describes it.
- [ ] Keep the previous model loaded for a quick switch back when memory allows. **Not done:** the app holds one loaded model at a time; this needs multi-model support (see "multiple models" idea).
- [x] Tests: choice order and filters, switch / ready / none / cancelled / failed / server cases, Undo, input keeps the draft, Camera/Gallery shown, notes for text-only models.
- [ ] Phone checks: attach a photo with a text model → switch happens and the answer uses the picture; Undo; memory prompt.

### Decisions (2026-11-04)

- Seamless switch-and-stay to a vision model when a picture is sent to a text model.
- Automatic, with a status line and Undo (no confirmation first; the memory check still asks if needed).
- No fixed/recommended vision model: use what the app already knows can see; if none, say so.

## Claude as a remote model (built, needs phone check)

Add remote model → **Configure Claude API**: paste an Anthropic API key, pick from the Claude models the key can use (live list from Anthropic's Models API).

- [x] Official Anthropic SDK (`@anthropic-ai/sdk` 1.1.0), its own engine (`src/api/claude`), not the OpenAI-compatible path.
- [x] Word-by-word streaming on the phone: a small XHR-based `fetch` the SDK reads as a stream (React Native's fetch can't stream), plus UTF-8 codecs if the engine lacks them.
- [x] Pictures, system prompt, memory and the app's tools converted to Claude's format and back; all tool results of a turn in one message.
- [x] Thinking toggle and effort map to Claude's per model (e.g. Opus 5.5 can't turn thinking off, so "off" = low effort; Sonnet 5.5 off = `between_tools`); reasoning summary shown in the reasoning panel; no sampling settings sent (newer models reject them).
- [x] Claude's own replies (with thinking) kept in memory and sent back unchanged; `drop_block` on models that tie thinking to the conversation, since the app edits history (memory, summaries).
- [x] Server-side refusal fallback (`fallbacks: "default"`) on the models that support it.
- [ ] Phone check: add Claude with a real key, chat (streaming, Stop), a picture, a tool (web search / files), thinking on/off, a wrong key.
- Not yet: prompt caching markers (a cost saver for long chats), counting Claude's usage in the context meter.

## Multi-model: keep models loaded (built, off by default, needs phone check)

For future phones with plenty of memory. Settings → Model Loading → **Keep models loaded**.

- [x] Switching parks the current local model (still loaded) instead of releasing it; switching back is instant, no reload and no memory prompt.
- [x] Up to 2 models loaded at once by default (the one in use included), adjustable to 3 or 4; the oldest kept model is unloaded beyond that, or when the next load wouldn't fit in memory.
- [x] In the background kept models stay only while the wake word is on (decision 2026-11-05); otherwise they're unloaded. The active model follows the existing auto-offload setting.
- [x] Remote models keep the local one parked; deleting a kept model unloads it first; benchmarks unload everything; turning the setting off unloads the kept ones. "Unload N kept models" button.
- [x] Benefits: instant vision switch-back after a picture, instant "Hey <name>" switching between named models.
- [ ] Phone check (needs a phone with enough memory): load A, switch to B, back to A (instant), picture with a text model and back, a third model with the limit at 2.
- [x] Restore last model on start (decision 2026-11-05; Settings → Model Loading, on by default): Claude/remote reconnects instantly, a local model loads with the usual memory check. Unloading a model yourself stops it coming back.
- [x] Fix: coming back to the app no longer reloads an earlier offloaded model over the one in use (it had unloaded Claude).
- [ ] Phone check: use Claude, close the app fully, reopen → Claude is back; same with a local model; unload manually → stays unloaded after restart.
- Later: show a "Loaded" badge on model cards; free kept models when Android reports memory pressure.

## DeepSeek as a remote model (built, needs phone check)

Add remote model → **Configure DeepSeek API** (`https://api.deepseek.com`), paste a DeepSeek API key, pick a model from the live list (e.g. `deepseek-v4-flash`, `deepseek-v4-pro`).

- [x] Uses the existing OpenAI-compatible connector with a DeepSeek profile: `max_tokens`; thinking via `thinking: {type: enabled|disabled}` (on by default at DeepSeek, so "off" is sent explicitly); effort mapped onto DeepSeek's low / high / max.
- [x] Thinking text (`reasoning_content`) is kept in the history and in tool loops, as DeepSeek requires with tools (else HTTP 400).
- [x] The app never forces a tool choice (DeepSeek's thinking mode rejects that).
- [ ] Phone check: add DeepSeek with a real key, chat, thinking on/off and effort, a tool (web search / files) across two turns, a wrong key.

## Free cloud APIs: Gemini, Groq, OpenRouter (built, needs phone check)

Add remote model → **Cloud chat API** now shows one button per provider: OpenAI, Claude, DeepSeek, Gemini (free), Groq (free), OpenRouter (free). Tapping one fills the address and type; **Get a … API key** opens that provider's key page.

- [x] One preset list (`src/api/cloudPresets.ts`) drives the buttons, the key link and the "wait for the key before connecting" rule.
- [x] Gemini through Google's OpenAI-compatible endpoint (`…/v1beta/openai`, no `/v1` added); its own profile: `max_tokens`, `reasoning_effort` up to high, `none` for thinking off; `models/` stripped from listed ids.
- [x] Groq (`api.groq.com/openai/v1`) and OpenRouter (`openrouter.ai/api/v1`) use the OpenAI profile. On OpenRouter, free models end in `:free`.
- [ ] Phone check: each with a real free key, chat, a tool across two turns, a wrong key. Free-tier limits change; check each provider's page.

## Phone actions via built-in Android intents (phase 1 built, needs phone check)

Replaces the earlier "ARTEMIS-inspired automation" batch. Research done 2026-11-03; **write-up only, nothing implemented yet.**

### ARTEMIS research findings

Reference: https://github.com/google/artemis (Apache-2.0; bundles part of minitap-ai/mobile-use, also Apache-2.0).

- ARTEMIS is mainly a **Python program on a computer** that drives a phone over USB (adb) and uses cloud vision models. It is built for automated app testing, which is why it is heavy. It does not fit an offline app running on the phone.
- Its on-phone part is a small Java accessibility helper (about 2,300 lines): it reads the screen hierarchy, does gestures and screenshots, and serves commands on a loopback server only after adb hands it a token.
- It launches apps from the computer with `monkey -p <package> -c android.intent.category.LAUNCHER`. It does not use AlarmClock or other intents.
- **Ideas worth reusing (not code):**
  - observe → act → verify → recover;
  - prefer element indexes (accessibility nodes) over screen coordinates;
  - compress old history (keep step numbers, drop old screenshots);
  - a separate read-only "checker" that verifies the result before reporting success;
  - stop when the same action fails to change anything twice in a row.

### Easier approach: Android's built-in intents

Standard requests any app can send (the same ones voice assistants use). They run on the phone, offline, with no computer and no Python.

| Todo item | Android built-in | Permission |
|---|---|---|
| Timers ("15 minute timer"): create, show | `AlarmClock.ACTION_SET_TIMER` (`EXTRA_LENGTH` seconds, `EXTRA_MESSAGE`, `EXTRA_SKIP_UI`), `ACTION_SHOW_TIMERS` | `com.android.alarm.permission.SET_ALARM` (normal, granted at install) |
| Alarms | `ACTION_SET_ALARM` (`EXTRA_HOUR`, `EXTRA_MINUTES`, `EXTRA_DAYS`, `EXTRA_MESSAGE`), `ACTION_SHOW_ALARMS`, `ACTION_DISMISS_ALARM` | same |
| Reminders | `Intent.ACTION_INSERT` on `CalendarContract.Events` (pre-filled title/time; the user saves) | none |
| Open installed apps | `PackageManager.getLaunchIntentForPackage`; list launchable apps with `queryIntentActivities(MAIN/LAUNCHER)` | none: a `<queries>` entry for MAIN/LAUNCHER (avoid `QUERY_ALL_PACKAGES`) |
| Navigation | `google.navigation:q=…` / `geo:0,0?q=…` URIs | none |
| Play a song / playlist | `MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH` | none |
| Camera | `MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA` | none |
| Call / text / email | `ACTION_DIAL`, `ACTION_SENDTO` (`smsto:` / `mailto:`): opens pre-filled, **the user presses call/send** | none (never `CALL_PHONE` / `SEND_SMS`) |
| Settings pages | `Settings.ACTION_WIFI_SETTINGS`, `ACTION_BLUETOOTH_SETTINGS`, battery, etc. | none |
| Flashlight | `CameraManager.setTorchMode` | none |

**Why a small native module is needed:** React Native's `Linking.sendIntent` sends every number as a Double (`putExtra(name, double)`), but the Clock app reads `EXTRA_LENGTH`, `EXTRA_HOUR` and `EXTRA_MINUTES` as ints, so timers and alarms would be ignored. A small Kotlin module (about 150 lines, like the existing `HardwareInfoModule` / `KeepAwakeModule`) sends correctly typed extras and lists launchable apps.

Not every phone has an app for every intent (e.g. no Clock app that handles `SET_TIMER`). The module checks with `resolveActivity` first and reports "no app on this phone can do that" instead of failing silently.

### Plan

**Phase 1: intent actions (no accessibility).**

- [x] Kotlin `PhoneActions` module: send an allow-listed set of intents with typed extras; list launchable apps (label + package); `resolveActivity` check; nothing else. (First compiled in the next APK build.)
- [x] Manifest: `SET_ALARM` permission; `<queries>` for MAIN/LAUNCHER and the intents above.
- [x] Model tools, all **off by default**, grouped in Toolbox as **Phone actions** (one switch for all, "Show each" for single ones):
  - `set_timer`, `show_timers`
  - `set_alarm`, `show_alarms`
  - `add_reminder` (opens the Calendar screen pre-filled)
  - `open_app` (match by app name; ask when more than one matches)
  - `navigate_to`, `play_music`, `open_camera`, `open_settings`
  - `compose_message` (dial / SMS / email screens, user sends)
- [x] Safety:
  - Every action shows an approval prompt in chat first (like file writes), naming exactly what will happen ("Set a 15-minute timer named Tea?").
  - Nothing places calls, sends messages, pays, or changes settings by itself.
  - No `CALL_PHONE`, `SEND_SMS` or `QUERY_ALL_PACKAGES`.
- [ ] Voice: spoken requests ("Set a timer for 15 minutes") go through the existing chat and voice input to the same tools. Time parsing is in the tool arguments, which are validated (timer 1 s–24 h; alarm hour 0–23 / minute 0–59).
- [x] Tests: JS tool tests (argument validation, approval required, denied → nothing sent, unknown app → clear message). The Kotlin side can only be verified on the phone APK.
- [ ] Phone checks on the test phone: timer, alarm, reminder, open app, navigation, music, camera, settings, and a "no app can handle this" case.

**Phase 2: cross-app workflows (still intents only).**

- [x] Chain phase 1 actions with a confirmation per step (e.g. "navigate home, then play my playlist"). Bounded steps; cancel at any time. (2026-11-15: tool `phone_actions_chain`, `src/services/talents/PhoneActionChain.ts`, off until switched on in Toolbox and offered only next to a phone action that is on. 2 to 5 steps, phone actions only, each switched on and checked by its own tool before anything is asked. The user first sees the numbered list ("Do these 3 steps?"), then every step asks again just before it runs ("Step 2 of 3: Play "Road trip" in your music app?"); a no, a failure or Stop ends the chain and says what was and wasn't done. When a step opens another app, the next question waits until the user is back in PocketAgent (up to 10 minutes). Never quiet, not even inside a shortcut, and a shortcut can't contain one. On the desktop the steps behave as the single actions do there. Tests: `PhoneActionChain.test.ts`, pin in `securityRules.test.ts`.)
  - [ ] **Check on the phone:** "navigate home, then play my playlist": the list, then step 1, maps opens; back in PocketAgent, step 2 asks; Cancel there stops it.

**Phase 3: using other apps by tapping and scrolling (optional; decide later).**

- [ ] Only if phases 1–2 aren't enough. It needs an in-app Kotlin Accessibility service, which means:
  - a strong user-granted permission;
  - Google Play policy review;
  - careful safety design: explicit per-task consent, sensitive-screen blocklist (banking, passwords, payments), bounded retries, a stop button, and no free-form coordinate tapping without a visible target.
- [ ] Reuse the ARTEMIS ideas listed above; learn from its Java helper (Apache-2.0, keep notices if any code is adapted).
- [ ] Screenshots / local vision with an offline vision model on newer phones: investigate feasibility before committing.

**Dropped from the old list:**

- "Evaluate ARTEMIS MCP integration": that is for driving a phone from a computer IDE, not for PocketAgent on the phone.

## Custom tools: made and saved by you or the model (built, needs phone check)

Decided 2026-11-05. Today Toolbox has tool drafts that only run as local tests; the model can neither call nor make them.

Two kinds of custom tool (no code execution, no new network access):

- **Saved instructions:** a named how-to (steps or a prompt). Calling it returns the stored text, so a model can keep and reuse a skill.
- **Shortcut of tools:** a saved chain of existing tools with fill-in values, e.g. `morning` = `set_alarm` 07:00 + `open_app` Spotify. Each step still asks for approval as usual; the run stops at the first denial or failure. This also covers phone-actions phase 2 (chaining).

Plan:

- [x] Toolbox → **Custom tools**: create / edit / delete both kinds by hand, View, a switch per tool (off by default). Editing switches a tool off. The old local-test drafts stay below, labelled.
- [x] Model tools `tool_save` and `tool_delete`: full definition in the approval dialog; saved (or replaced) tools start **switched off**.
- [x] Checks: names can't clash with built-ins or each other; shortcuts use built-in tools only (no tool_save / tool_delete, no custom tool inside a shortcut); at most 8 steps; fill-ins `{{name}}` become required arguments.
- [x] **Changed from the plan:** a shortcut asks **once per run**, showing every step, instead of once per step. Android stops a background app from asking or opening apps, so after a step that opens another app nothing further could run. Inside an approved shortcut, phone actions don't ask again, timers/alarms stay in the background, and a step that opens another app must be the last one. The run stops at the first failure and says what was done.
- [x] How-to text for both kinds; tests.
- [x] 2026-11-06: an Instructions tool "morning" ("Open Claude") works: "Run morning" read it, then open_app opened Claude (Gemini 3.1 Flash Lite; the first try it said it couldn't read the instructions).
- [x] Fixed: typing in the custom tool editor moved the cursor (backspace deleted the wrong letter). The dialog layer delivered the screen's copy of the text late; the boxes now keep their own text.
- [x] Done: clearer editor wording ("When should the model use it? e.g. when I say good morning"; "Tools never run on a timer; for an alarm use Shortcut with set_alarm") and a plainer description for the model.
- [ ] Phone check: make "morning" (alarm with `{{hour}}` + open an app) in Toolbox, turn it on, ask "run morning at 7"; ask a model to save a packing list as instructions, approve, turn it on, ask for it back; delete both.

### Share and scan by QR: tools and device pairing (built 2026-11-15, needs phone and PC check)

Toolbox → Custom tools has **Share** on each tool and **Scan QR** / **Paste a code** buttons. Uses the scheme from the user's QR2D page (`qr2d-v0_27.html`). Code: `src/services/talents/toolQr.ts` (pack/unpack), `toolImport.ts` (review and install), `src/screens/ToolCodeDialogs.tsx`, `src/components/QrCodeView`.

- [x] **One QR scanner for everything** (decided 2026-11-06): **Scan QR** reads every PocketAgent code, and the tag in front says what it is: `PA1:T:` a tool, `PA1:P:` a desktop pairing (goes to the usual pairing, which asks first), later mods. Nothing is installed or paired without the user confirming. Unknown tags are refused.
- [x] Scan QR is reached from Toolbox (tools and pairing). The server list keeps its own scanner (pairing and server addresses), unchanged.
- [ ] Optional: the server / desktop list's scanner could also take a tool code and hand it to the Toolbox review.
- [x] Pack: the tool's JSON → deflate (pako, raw) → base64, tag and version in front: `PA1:T:1:z:…`; plain JSON (`PA1:T:1:j:…`, ASCII only) when that is shorter. Who made the tool is not sent; it arrives as the user's.
- [x] Unpack: tag and version checked (a newer version says "update the app"), at most 32 KB of code and 16 KB of tool (inflating stops at the cap, so a zip bomb is refused early), only a tool's fields kept, broken base64 / deflate / UTF-8 / JSON refused.
- [x] Size check: one standard QR holds about 2,331 characters (version 40, medium error correction); most tools fit. Too big: the dialog says so and offers **Share as file** and **Copy code** (no multi-QR for now).
- [x] **Copy code** and **Paste a code** (also **Open a file**): the way PC to PC, since a laptop has no camera. On the desktop, Scan QR opens the paste box.
- [x] Draw the QR with `qrcode-generator` + `react-native-svg`: black on white with a quiet border, also in dark themes.
- [ ] Share the QR as a picture too (needs a view-to-image library; not added).
- [x] Scan with the camera (the existing vision-camera code scanner).
- [ ] Scan **from a picture** (jsQR on the image), so a QR in a screenshot or chat works: not built (jsQR is not in the app, and the phone needs the picture's pixels).
- [x] After reading: the same checks as `tool_save`, the **full definition** shown (every step and fill-in), then install **switched off**. Name clash → asks for another name; the existing tool is kept (never replaced; delete it first to replace it).
- [x] Never run anything from a scan; a code is data only (instructions or a shortcut of built-in tools). Guarded in `securityRules.test.ts` (rule 2).
- [ ] Phone check: share a shortcut as QR, scan it on a second phone: every step shown, installs off, works after switching on. Scan a PC pairing QR from Toolbox: asks, then pairs. Camera permission refused → paste still works.
- [ ] PC check (DesktopAgent): Share → Copy code, paste on another PC (or the phone) → installs off; Share as file saves a `.pocketagent-tool.txt`; Open a file reads it; Scan QR shows the paste box.
- [ ] Later, optional: the colour "mcode" from QR2D (8 colours, Reed–Solomon) for denser codes; only if plain QR is too small in practice.

## HTML preview lock: no WebRTC, frames or pop-ups (built, needs phone check)

Question 2026-11-06: can a downloaded assistant make an HTML page that reaches other things? The preview already had no app bridge, no files, no navigation, no network by CSP, incognito. **Gap found and closed:** no browser enforces a CSP rule for WebRTC, so a page could still send data out (e.g. chat or memory the model put in the page) over a WebRTC connection, also from a blank inner frame.

- [x] Frame tags in the page text are renamed before the page is built (`<iframe>` → `<blocked-iframe>`).
- [x] A guard script runs first: WebRTC removed for good, `window.open` blocked, frames added by scripts removed before they can be used, frame `contentWindow` returns nothing.
- [x] Checked in Chromium against 24 ways in (direct, redefine, parser frames, innerHTML, shadow DOM, document.write, execCommand, Range, srcdoc, javascript: frames, pop-ups …): all blocked. Clocks, eval calculators, canvas and DOM pages still work.
- [ ] Phone check: an HTML clock and a calculator still work in the preview.
- [ ] Saved `.html` files opened in another browser are outside this lock (that browser's rules apply).

## Off means off: tool switch audit (done 2026-11-06)

Checked every path that can run a tool. Only two exist: the chat loop (`AgentRunner`) and a shortcut run.

- [x] A switched-off tool is never sent to the model, and if a model names it anyway the chat loop refuses it ("not enabled").
- [x] **Fixed a gap:** an assistant (including one downloaded from PalsHub) could list its own tools and they ran even when switched off in Toolbox. Now an assistant may only add `calculate`, `datetime` and `render_html` by itself; every other tool (phone actions, web, files, memory, tool making, custom tools) needs its Toolbox switch. Test: an assistant listing `set_alarm`, a model calling it → never runs.
- [x] Custom tools saved by the model or (later) scanned from a QR start switched off; tool_save itself needs its switch.
- [ ] Note: a switched-on shortcut runs its built-in steps after one approval that shows every step, even if those step tools are off on their own. Option: also require each step's tool to be on.
- [ ] The assistant editor still lists every tool; mark which ones need a Toolbox switch.

## Developer settings switch (built, needs phone check)

Settings ends with **Show developer settings** (off by default, remembered). Off: what most people use. On: everything as before.

- [x] Hidden while off: model loading options (GPU layers, threads, batch, memory cache, speculative, mmap/mlock), Memory (stream large models), local API sharing, old export, keep several models loaded, Benchmark and Hardware links, Toolbox test drafts and "Duplicate to draft".
- [x] Hiding doesn't change a setting: e.g. keep-models-loaded stays as set.
- [x] Dev Tools in the menu stays debug-builds only (its screen only exists there).
- [ ] Phone check: switch off → short Settings; on → everything as before; reopen the app, the choice is kept.

## Personal model: LoRA trained for the user, daily with DesktopAgent (idea 2026-11-06, write-up only)

Idea: a small LoRA adapter trained on what the user chooses from their phone, so a local model learns their style, names, routines and notes. Fully local: nothing leaves the phone.

What exists (checked 2026-11-06):
- Stock llama.cpp / llama.rn can **load** LoRA adapters (already usable for running one), but has no Android training path yet.
- Tether's QVAC-fabric-llm.cpp (a llama.cpp fork) reports LoRA fine-tuning on phone GPUs (Adreno, Mali, Apple) for Qwen3 and Gemma3; planned for upstream, not merged; claims are self-reported.
- Qualcomm documents running LoRA adapters on the NPU (Snapdragon 8 Elite, HTP), not training.
- Usual practice today: train on a PC or the cloud, then run the adapter on the phone.

Plan (each step on its own; ask before each):
1. [ ] **Data the user picks, never everything by default.** Order decided 2026-11-06, each source its own opt-in:
   1. **Contacts:** names, nicknames, relationships the user adds (e.g. "Mack Attack = brother"). Uses READ_CONTACTS, which the app already has for name lookup; reading for training is a separate, clearly worded opt-in.
   2. **Text conversations (SMS/MMS):** the user's own writing style and who they talk to. Needs READ_SMS (a new permission: update `SECURITY.md` and the permission test on purpose). Google Play only allows READ_SMS for default SMS apps; fine for GitHub / F-Droid / Accrescent builds, the main audience. Pick conversations one by one; never all by default.
   3. **Later: files and photos.** Files through the Android file picker (no storage permission); photos only after picking, captioned locally by a vision model first.
   Also usable without any permission: PocketAgent chats, memory, workspace files. A preview of every example before training; easy to remove items; the sources list shows exactly what was read.
2. [ ] **Run adapters now:** load a LoRA (.gguf) on top of a local model (llama.rn supports it); switch per assistant. This also lets users bring adapters trained on a PC.
3. [ ] **Train on a PC first (fallback):** export the chosen examples as a dataset file; a short guide/script to train a LoRA for the same base model; copy the adapter back. Nothing uploaded by the app.
4. [ ] **Train on the phone (experiment):** when on-device training is in llama.cpp (or via the QVAC fork), small rank (8–16), 0.8B–2B base, only while charging and cool, pausable, with a progress screen. Measure time and heat on the 2023 Razr first.
5. [ ] **Keep it honest:** a LoRA learns style and habits; facts that change (names, plans) still belong in memory. Show "trained on N examples, date"; one tap to switch off or delete the adapter.

**Daily training with DesktopAgent (idea 2026-11-07): the PC does the heavy work, the phone learns.**
- [ ] Off until the user switches it on, on both devices. Needs the home link (paired phone and PC).
- [ ] During the day the phone collects new examples only from the sources the user opted into (step 1), into its private training queue. The user can look at the queue and remove items any time.
- [ ] Once a day (default: at night, PC on, phone on the charger or anytime the PC is reachable), the phone sends the day's new examples to the PC over the home link (encrypted from phone to PC; nothing goes anywhere else).
- [ ] The PC trains a new LoRA version for the same base model as the phone's (small rank, a few minutes on the graphics card), starting from yesterday's adapter, so it learns a little each day instead of from scratch. Training tool: llama.cpp's own fine-tuning if good enough, else a bundled trainer; pinned and checksum-checked like llama-server.
- [ ] Before using it, the PC checks the new version against a small fixed set of the user's own test questions (style and facts it should keep); if it got worse, it keeps yesterday's and says so.
- [ ] The adapter goes back to the phone; the phone loads it on top of its local model. The PC can use the same adapter with a bigger copy of the base model.
- [ ] Morning note on both devices: "Learned from N new examples (date). Undo." Every version is kept for a while: one tap to go back to any day, or switch the personal adapter off.
- [ ] **Delete after training** (setting on the PC, on by default): once the new adapter is made and checked, the day's examples are deleted from the PC, so it holds nothing but the adapter (private, and saves space). Turned off, the PC keeps the examples so it can retrain from scratch later (e.g. for a new or bigger base model); the settings show how much space they use, with **Delete all training examples now**.
- [ ] The phone keeps its queue only until the PC confirms the new adapter, then deletes it too (same choice on the phone: keep a copy or not).
- [ ] Old adapter versions: keep the last 7 by default (each a few MB to tens of MB), with the space shown and a **Delete old versions** button.
- [ ] **"The model is the memory"** (user's idea 2026-11-07): the user can delete all raw data (examples on phone and PC) and keep only the adapter. Explain plainly when they choose it:
  - It keeps habits, style and often-used names well; exact facts (dates, addresses, numbers) only roughly, and it may fill gaps wrongly. Exact facts stay in the memory notes.
  - Forgetting one thing later: no examples to retrain without it, so only by going back to an older adapter version (from before it learned it) or training a correction on top. Hence the kept versions.
  - The adapter is still personal data (a model can repeat bits of what it learned): private storage only, never shared, one tap to delete.
- [ ] Never trained on: passwords, one-time codes, bank and card numbers, anything marked private, anything from a conversation the user excluded (filters run on the phone before anything is sent).
- [ ] Without the PC: the phone keeps collecting and waits; on-device training (step 4) is the later fallback.

Privacy and safety:
- [ ] Training data and adapters stay in the app's private storage; never sent anywhere; excluded from cloud backups.
- [ ] An adapter is personal data: sharing it as a mod is blocked by default (it can leak what it was trained on).
- [ ] No contacts, messages or photos are read without a per-source opt-in; each source can be switched off and its examples deleted. Messages from other people are training data about them too: show that in the opt-in.

## PocketAgent for Windows: the same app as an .exe (idea 2026-11-07, write-up only)

Goal: one codebase. On the phone it's the Android app; on a PC the same app is a Windows .exe, with the desktop jobs (bigger models, LoRA training, serving the phone) built in. That makes the "PocketAgent Desktop" companion below just the Windows build of this app.

Findings (2026-11-07):
- Microsoft's **React Native for Windows 0.82** is stable (March 2026) and matches this app's React Native 0.82.1. It supports only the new architecture, which RN 0.82 already uses.
- The JS/TS app (screens, stores, tools, settings, safety rules) carries over as is.
- **Native parts that have no Windows version** and need a Windows replacement: llama.rn (local models), whisper.rn (voice), vision-camera (QR / camera), image-picker, audio stream, speech, share, haptics, phone actions.

Plan (each step on its own; ask before each):
**Rule (decided 2026-11-07): anything not needed on a platform is stubbed, not removed.** A stub has the same functions as the real module, does nothing and says "not available on this device", so the shared code never needs `if Windows` checks and nothing is deleted. The UI hides features whose module is a stub.

**Branch `windows` (started 2026-11-07).** Done so far:
- [x] react-native-windows 0.82.8 added; Windows C++ app project generated (`windows/PocketAgent`), our `metro.config.js` kept and merged.
- [x] Stub layer (`stubs/windows/`): Metro swaps 24 packages for stubs only when bundling for Windows (Android bundle checked unchanged). "native" stubs say "not available on this device"; "ui" stubs (animations, gestures, safe areas, keyboard, masked view) keep screens rendering: animations jump to their end.
- [x] The whole app bundles for Windows (`yarn bundle:windows`).
- [x] Tests: every stub loads; native calls fail clearly; animation maths; and a guard that fails if a new native package has neither Windows code nor a stub.
- [x] CI: `.github/workflows/pocketagent-windows.yml`, run only on request: `bundle` (cheap checks) or `exe` (full build).
- [x] First Windows build (run 42319633707) failed: 11 packages only have old-style Windows code (react-native-windows 0.82 is new-architecture only), which also pulled react-native-windows in from source and broke its link. Fixed by not linking them on Windows and stubbing them: app storage and files work **in memory** (lost on close), the chat database uses WatermelonDB's JavaScript mode (LokiJS, in memory), device info gives fixed values, clipboard does nothing yet, screens/gradients/slider/picker are plain views. The web view and SVG stay linked. Android unchanged (checked: SQLite, no stubs).
- [ ] **Windows storage module** (the one real piece of Windows code needed first): save app storage, files and the database to the user's AppData so nothing is lost on close.
- [ ] Next Windows build: confirm it compiles and links.
- [ ] (was) First Windows CI run: see which linked packages (fs, storage, web view, svg, screens, clipboard, slider, picker, device info, gradients, config) build on the new architecture; stub the ones that don't.
- [ ] Icon fonts (react-native-vector-icons) added to the Windows app's assets.
- [ ] A real secure random source on Windows before pairing keys (the stub is fine for record IDs only).
- [ ] API keys on Windows: Windows Credential Manager instead of the keychain stub.
- [ ] Bottom sheets and the side menu run on inert animation stubs: check on Windows; a permanent sidebar suits a desktop window better than a drawer.

1. [ ] **Windows shell:** add a react-native-windows project; the app opens on Windows; every native module without a Windows version gets a stub (llama.rn until step 2, whisper.rn, vision-camera, image-picker, audio stream, speech, share, haptics, phone actions, in-app purchases, Firebase, Google / Apple sign-in).
2. [ ] **Local models on Windows without a new native module:** bundle llama.cpp's prebuilt `llama-server.exe` (CUDA for NVIDIA, Vulkan for AMD/Intel) and start it on 127.0.0.1; the app talks to it with the remote engine it already has. Same idea for voice (whisper.cpp server).
3. [ ] **Platform list per tool:** each tool says where it runs. Phone actions stay Android-only; Windows gets its own small set later (open an app, open a file or folder, a notification). Approvals and switches work the same on both.
4. [ ] **Desktop features in the Windows build:** "Share this PC's model with my phone" (QR pairing), LoRA training, heavy jobs. Shown on Windows only.
5. [ ] **One installer:** a signed .exe / MSIX, no admin rights where possible; Windows Firewall: private networks only.
6. [ ] **CI:** a Windows build job. GitHub counts Windows runner minutes at 2× Linux, so build Windows only on request, like the APK.

Not planned: Mac, iPhone, Linux (see Platforms).

## Remove Google libraries from the Android build (found 2026-11-07)

Firebase, Google Sign-In and Apple sign-in are left over from PocketPal. They are **not switched on** (no `google-services.json`, the Google Services plugin isn't applied), but the APK still ships Google's Firebase App Check and Play Integrity libraries (`android/app/build.gradle`). GrapheneOS users check APKs for exactly this (e.g. Exodus Privacy).

- [ ] Stub Firebase / Play Integrity / Google Sign-In / Apple sign-in / in-app purchases (same stub rule as Windows): the JS modules are replaced by stubs and the Google libraries leave the Android build; the real code stays in the repo. The PalsHub sign-in that uses them shows "not available".
- [ ] Add a test that fails if a `com.google.firebase` / `com.google.android.gms` library is in the build again (with the other security rules).
- [ ] Check the APK with Exodus Privacy: aim for zero trackers.

## Windows route: react-native-web + Tauri (go-ahead 2026-11-07, web version running)

Instead of react-native-windows (most native libraries need stubs there, and nothing can be run or checked without a 40-minute Windows build): run the same app as a web app (react-native-web, which most of the app's libraries officially support) wrapped in a small Tauri .exe (Windows' own WebView2). Tauri bundles and starts `llama-server.exe` as a "sidecar", has file / clipboard / notification plugins, and builds the installer. The web version can be run and screenshot here; Windows builds are only for packaging. The react-native-windows work stays on the branch (don't delete).

**Web version (step 1, done 2026-11-07):**
- [x] react-native-web 0.21.2 + react-dom 19.1.1; Metro builds for platform "web" (`yarn build:web` → `web/dist`), using packages' web code and a web stand-in for `react-native` (react-native-web plus "not available" answers for phone-only APIs and the app's own native modules).
- [x] Web stubs (`stubs/web/`), mostly shared with Windows: local models, voice, camera, Google/Apple/store services, file storage (in memory), device info, keychain, and the HTML preview (off until its web lock is built and checked).
- [x] Chat database on the web: WatermelonDB's JavaScript database **saved in browser storage** (IndexedDB), so chats are kept.
- [x] App and icon fonts load; images load.
- [x] Checked in Chromium here: welcome screen, Chat, Settings and Models open with no errors (screenshots sent).
**Tauri .exe (step 2, built 2026-11-07, first Windows build next):**
- [x] `src-tauri` (Tauri 2.12.4): 17 native commands, each listed in build.rs and allowed in capabilities: files (own AppData folder free, anywhere else asks via a native dialog, `..` refused), keys (Windows Credential Manager), network (no browser cross-site limits; the window itself has no internet), model server.
- [x] "Run a model on this PC" (Settings): pick a .gguf, the bundled llama.cpp server (b11662, Vulkan + CPU, checksum pinned) runs it on 127.0.0.1 with a random password and it appears as "This PC" in Models.
- [x] Checked here: 9 Rust tests; the release web build under the .exe's security policy with a fake native side (streaming fetch/XHR, abort, direct internet blocked); end to end with a stand-in llama.cpp server (pick → start → This PC → Load → chat reply streamed).
- [x] Safety rule 6 in SECURITY.md + tests that fail if a command, permission or approval step changes.
- [x] First Windows installer built (run 42332849525, 2026-11-07): release `exe-windows-42332849525-1`, 20 MB, contains pocketagent.exe + the llama.cpp folder (53 files). Earlier runs failed on Windows-runner differences, all fixed: CRLF in a rule test, npx.cmd, unzip, Windows paths in Rust tests, rustls/ring → native TLS. The Rust code now type-checks for Windows here (`cargo check --target x86_64-pc-windows-msvc`) and a local `tauri build --bundles deb` checks config + resources before any Windows run.
- [x] 2026-11-07: ran the real app (Tauri, Linux build) on a virtual screen here. Found and fixed: the first installer's layout was broken (Tauri's style nonces made the browser ignore the app's run-time styles; now off for styles only, pinned by a test). Checked for real: window and fonts, side menu, settings remembered after reopening, files saved in the app's own folder, the native file picker (GGUF filter), the native Allow dialog (Don't allow → nothing runs; Allow → the bundled llama-server starts and a bad file is reported).
- [ ] When llama-server quits at once (bad file), say so straight away instead of after the 2-minute wait.
- [ ] Before each Windows build: run the real app here on a virtual screen (Xvfb) as well as the tests.
- [ ] On a Windows PC: installs, opens, saves chats/settings, keys, a real .gguf runs, Allow dialog for files outside the app folder.
- [ ] Icon: only a 96px source exists; a proper large icon.
- [ ] Code signing, decided 2026-11-07: no outside certificate company. If wanted, a self-signed "PocketAgent" certificate (key as a GitHub secret, signtool in the build, fingerprint + SHA-256 published) proves a download is ours; Windows still says "unknown publisher". Not started. Outside options noted only: SignPath Foundation (free, open source), Azure Artifact Signing (US/Canada individuals), paid certificates.
- [ ] Fix: an invalid colour `rgba(…)30` in the app's styles (Android ignores it; the web warns).
- [ ] Fix: `pocketagent_logo` is an Android-only image name; give the web its file.

**DesktopAgent name, logo, Linux (2026-11-07):**
- [x] The desktop app is called DesktopAgent: window, installer, page title, and the app's texts ("PocketAgent" → "DesktopAgent", "your phone" → "your PC"; desktop only, `src/locales/forPlatform.web.ts`).
- [x] Logo: the PocketAgent robot saying "DesktopAgent" (`src-tauri/icon-source/desktopagent-logo.png`, made from the 1536px logo), for the app icons, welcome screens and chat; Phosphor versions of its layers too, so the logo follows the Phosphor colour.
- [x] Phosphor style checked on the desktop: works.
- [x] Linux: `tauri.linux.conf.json` (AppImage + .deb), pinned llama.cpp Linux build (Vulkan + CPU, checksum), on-request job `.github/workflows/pocketagent-linux.yml` (start: change `.github/linux-build-request`). Built and run here: the AppImage opens and starts its bundled llama-server.
- [ ] No GitHub builds until asked (user, 2026-11-07). Next Windows build will include: layout fix, DesktopAgent name and logo.
- [ ] Later for Linux: Flatpak / Flathub (what many privacy-minded Linux users prefer).

**First Windows test on a real PC (2026-11-07), and fixes:**
- [x] A real model ran: Qwen3 1B (IQ4_XS) through "Run a model on this PC" in Phosphor mode, 8.8 tokens/s.
- [x] Fixed: every API / server screen went black. Two desktop-only crashes in the sheets: `TextInput.State.currentlyFocusedInput` missing in react-native-web (aliased), and the bottom-sheet library's web `findNodeHandle(null)` (patched: `patches/@gorhom+bottom-sheet+5.2.8.patch`). Checked in the real app: Gemini preset, key typed, reached Google (400 for a made-up key).
- [x] Fixed: any future screen crash shows the error with Copy details / Reload instead of a black window (`web/ErrorScreen.js`).
- [x] Fixed: "Connection timed out" on the local model: "This PC" now waits up to 10 minutes for the first word (a slow PC reads long prompts with tools for minutes); the server uses the graphics card for all layers (Vulkan) and 8192 tokens of context.
- [x] Fixed: in-app Hugging Face downloads failed (`startDownload` of null): the desktop now downloads through the native side, straight to disk with progress, cancellable, `.part` until complete (tested byte for byte against a local server).
- [x] Fixed: "Memory Warning" on a 2B: the desktop used a placeholder 8 GB; it now reads the PC's real total and available memory (`system_info`).
- [x] Desktop start-up makes no network calls (device-rules fetch off). The app itself starts in ~1.5 s (browser) / ~8 s (real app here, software drawing); the 45 s seen on Windows is likely first launch (Defender scanning the new unsigned app, web view setup) - check the second launch.
- [x] Second Windows test: Gemini works; a 2B runs on the PC (12.4 tok/s).
- [x] Fixed: delete / remove did nothing. React Native Web's Alert.alert is empty, so every confirmation was silently skipped; the desktop now shows them as dialogs with all their buttons (`web/AlertHost.js`). Checked: delete a model → "Remove …?" → Delete → gone.
- [x] Fixed: "Network error" on a This PC model after reopening the app (its server stops with the app; the list still pointed at it). Load now starts the server for that model file again (same Allow dialog) and points This PC at it.
- [ ] Each build gets its own version (0.1.<build number>) so installs upgrade cleanly.

**Phone gestures → desktop controls (2026-11-07, checked in Chromium here):**
- [x] Right-click does what a long-press does on the phone (holding the mouse still works too): chat in the side menu → Pin / Rename / Duplicate / Export / Delete (Delete asks first, then the chat is gone); message → Copy / Edit; mic → voice settings. React Native Web's Touchables overwrite a plain `onContextMenu`, so `stubs/web/react-native.js` listens on the element itself. The browser's own right-click menu is hidden except in text boxes and on selected text.
- [x] Enter sends, Shift+Enter makes a new line.
- [x] Escape closes the top sheet (phones swipe sheets down).
- [x] Copy works: the clipboard was a do-nothing stand-in; now the browser clipboard (`stubs/web/clipboard.js`), only when the user presses Copy.
- [x] Haptic taps quietly do nothing on a PC (they were throwing "not available").
- [x] Models list: there is no pull-down-to-refresh with a mouse, so it checks downloads each time the screen opens.
- [ ] Wide windows: keep the side menu open beside the chat instead of sliding over it.
- [x] Side menu chats: the hand cursor shows over the whole row (inner menu-item parts reset it, so the row looked clickable only on its text). Anything pressable gets `data-pa-press`; `web/index.html` keeps the hand over all of it.
- [ ] Voice settings still say "on this phone" / "Android shows…"; voice input is not on the desktop yet (stubbed).
- [ ] HTML preview "Share / save to phone" has no desktop version (the share sheet is phone-only); "Save to workspace" works. Desktop: a native "Save as…" dialog (the user picks the place, so it is their consent).
- [ ] "Add local model" uses the phone's file picker (stubbed); on the desktop use "Run a model on this PC" or give it the native picker.

**Start-up time (45 s on Windows, 2026-11-07):**
- [x] Settings → "Start-up time" card shows where the time goes: app opened → page starts loading, loading the app's code, code running → first screen, page fully loaded (native marks from `startup_timing` + the page's own). Here (real Linux app): 1 s, 0.7 s, 0.4 s, 1.7 s.
- [x] A "Loading DesktopAgent…" text shows while the code loads, instead of a blank window.
- [x] Windows card (2026-11-07, every launch alike): page starts loading 0.9 s, code loads 0.6 s, **code running → first screen 37 s**, page fully loaded 38.5 s. Here the same step takes 0.4 s, and slowing every file by 10 s did not delay it, so not file serving. The "fully loaded" mark landing with the first screen points at the window's main thread being blocked: Tauri runs plain (non-`async`) commands on it, and several ran at start (saved keys from Windows Credential Manager, the PC's memory).
- [x] Fix: every native command now runs off the main thread (`#[tauri::command(async)]`), pinned by a Rust test and a rule test.
- [x] The card now also lists the slowest native calls at start-up (0.25 s or more), so the next build shows if one still holds things up.
- [x] Checked on Windows (build 42356860678): still 41 s, and no slow native calls listed. So not the main thread / native side. "Page fully loaded" lands exactly with the first screen.
- [x] The card now also shows: when all start-up code has run, when React put the first screen together, when it was drawn, the page's own "loaded" event, long tasks (the page busy without a break), when the window was hidden/shown, and the slowest files. Next Windows card tells "code busy" from "window waiting".
- [x] HTML preview checked on Windows: a model-made clock runs live in chat.
- [x] Fixed (2026-11-09): the game's script stopped on `localStorage` (it throws in the no-origin preview), before it hooked up the button. Previews now get a storage that lives only while the page is open; checked in Chromium with the sandboxed frame and the app's real guard script: click starts the game, arrow keys arrive.
- [x] (was) HTML preview on Windows: a model-made Snake game shows (title, START GAME button, "Use Arrow Keys or WASD") but the button does nothing (user, 2026-11-09). The clock ran, so scripts run; clicks and keys don't reach the game. Suspects: something of the app's covering the preview and catching the clicks (press/scroll layers around the chat bubble or fullscreen view), the frame not getting keyboard focus, or the sandbox stopping something the game needs (e.g. `alert`, forms, storage). Check in Chromium and the real Linux app with a click and key test page; keep the sandbox (rule 3).
- [x] Research (2026-11-07): during the wait Windows shows "Loading DesktopAgent…", so the window draws but the app's code makes no progress. Pretending to be Windows in Chromium (browser identity + platform) changed nothing (0.55 s), so it's WebView2 itself. No blocking requests in the shipped code. Lead: the app's saved settings are read through localStorage (the settings storage's web version), which freezes the page until the browser's storage answers; Chromium-based web views can take very long to start their storage on some PCs (compare Firefox's 48–51 s storage start-up bug 1899015). The card now times the first localStorage read and the first IndexedDB open.
- [x] Windows card (build 42437317929, 2026-11-08): settings read 0 s (not storage). One long task from 1.5 s to 39.9 s: the page busy without a break, ending exactly when React finished the first screen; the chat database's answer and the first draw wait behind it. Chromium here: same work 0.2 s; JIT off or the Phosphor look change nothing.
- [x] Ruled out on the PC (2026-11-08): `--disable-gpu` → still 38.8 s (so not the graphics process). Ruled out here: language / time zone (en-CA, Vancouver) and Windows identity → 0.5 s.
- [x] The card now adds up the time spent in each kind of browser call during start-up (style rules, layout, canvas, elements, storage, fonts…) and shows the top 5; here the top is style rules: 549 calls, 0.14 s.
- [x] Windows card (build d226953, 2026-11-09): every browser call together 0.1 s, so the 38.9 s task is the app's own JavaScript. Same release bundle here in Chromium: first screen 1.1 s.
- [x] Next step built: on Windows the app records WebView2's own CPU profile (the one Edge's developer tools use) from when the page starts loading until 60 s later, and the Start-up time card lists the busiest functions (own time and with what they call) plus garbage collection, as file:line:column. The full profile is kept as `startup-profile.cpuprofile` in the app's data folder. CI keeps the source map (not shipped) for 30 days to turn the places back into source files. Checked here end to end on a Chromium profile (summary in Rust, places mapped back to React / Metro source).
- [x] Card from build 692bacf (2026-11-09), also with fresh data (so not saved data): 41 s in Tauri's own bridge code (`processIpcMessage` 31 s, `postMessage` 10 s), called from our `async` code. Cause: on Windows the native bridge is `fetch("http://ipc.localhost/<command>")`, and our network layer (`web/tauriNet.js`) took that for an outside address and sent it through the native bridge, which is again such a fetch: every native call called itself, with a payload growing each time, until the page gave up and Tauri switched to its slower backup (`postMessage`). Linux uses `ipc://localhost`, so it never happened there.
- [x] Fixed: the app's own addresses (`*.localhost`) are never sent through the bridge (page), and the native side refuses them and drops the bridge's key (security). Reproduced here with Tauri's real Windows bridge code: before 25.7 s with the backup used 21 times; after 0.9 s, backup never used.
- [x] Checked on Windows (build 4f56602, 2026-11-09): page fully loaded in 2.2 s (was 43–48 s); code running → first screen 0.3 s (was 41–43 s); no long task over 0.2 s.
- [ ] Slim down the investigation's extra probes (keep the card and the profile).
- [ ] (old suspect, ruled out) Suspect: a synchronous wait for WebView2's graphics process during the first screen (the UI library measures text with a canvas). Test on the PC: start once with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu`. The card now also times canvas setup. If confirmed, fix in the app (e.g. a web view flag, or no canvas during start).

**Downloaded models on the PC (user, 2026-11-09):**
- [x] Loading a downloaded model on the PC failed: "Running a model on this device is not available on this device (Windows)" (the phone's in-app runner isn't in the desktop app). Load now starts the PC's model server (llama.cpp, graphics card via Vulkan) for that file and switches to it under "This PC" (shown by its file name). The vision part goes along (`--mmproj`) and is used again when the server is restarted after the app was closed. Files the app downloaded need no question; picked files still ask.
- [ ] Check on Windows: download → Load → chat, and a picture with a vision model.
- [x] Fixed (2026-11-09): "Copy report" copies the ticked details as text; nothing is sent (PocketPal's Firebase sender is kept in the code, unused). The real system is shown (Windows / Linux on the desktop).
- [x] (was) Model error report on the PC: shows "OS: Android" (it only knows phones), and "Submit Report" goes to PocketPal's Firebase report service (needs Google's app check; it fails, nothing is sent). No Google anywhere: replace with "Copy report" (to paste where the user wants) and show the real system.

**No outside connections (audit, user, 2026-11-09):**
- [x] Every outside address in the code checked; the desktop app's real traffic in its first minute: none. Switched off (code kept, `src/config/outside.ts`, tested): feedback, content reports, model error reports, shared benchmarks (PocketPal's Firebase / Google, after a google.com probe); the phone's device-rules download from cdn.jsdelivr.net at every start. Firebase's Android libraries taken out of the build. SECURITY.md rule 7.
- [ ] The Send feedback / Report / Share benchmark buttons now end in "Sending reports is off…": replace them with Copy (like the error report) or hide them.
- [ ] Unlink Google Sign-In and Google Play billing on Android too (never started today); check on the phone that nothing imports them at start-up first.
- [ ] Check the phone's real traffic at start-up (no tool here can watch it; e.g. the phone's own per-app data usage, or a network log).

**Model memory on the PC (user, 2026-11-09):**
- [x] A 4B model showed "Memory Warning" on a 16 GB PC: the limit was the phone's rule (what was free on the first day, kept forever). The desktop limit is now all memory but 3 GB for Windows (never less than what is free now), read fresh every start.
- [x] Count the graphics card's own memory when telling what fits (2026-11-09, see "Find the fit").
- [ ] Look up what the device has, every time, never assume (user, 2026-11-09): phones and PCs change (new PC, new graphics card, more memory, a different phone), so the app reads what is there at each start and when it matters (before a download, before loading): total and free memory, graphics card(s) and their own memory, NPU, processor cores and features, free disk space. No numbers kept from an earlier day as a limit. The "will it fit" warnings, "Find the fit" and the model runner's settings (how much goes on the graphics card) all use this. Show it in one place (Settings → This device) so the user sees what the app sees.

**"Always allow this file" for models (user, 2026-11-07):**
- [x] Running a model from outside the app folder: Allow once / Always allow this file / Don't allow. "Always" is kept in Windows Credential Manager (names the screens can't write) for that exact file (path, size, time). Checked in the real Linux app: Always → runs; same file again → no question, also after reopening the app; file changed → asked again; Don't allow → nothing runs.
- [ ] A Settings list of always-allowed files with "Forget" (for now: Windows Credential Manager, entries starting "DesktopAgent-model:").

**Access rule (decided 2026-11-07): broad access, never automatic.**
- [ ] The app may reach the whole drive, run programs, open apps and links, use the clipboard; **every** such action asks first, showing exactly what will happen; no means nothing happens.
- [ ] The approval dialog is shown by Tauri's native (Rust) side, not by the web screens, so even a bad page or a bug in the screens can't skip it.
- [ ] No prompt only for the app looking after itself: its own AppData folder (settings, chats, models) and starting the bundled llama-server (this PC only, random password).
- [ ] A test pins the Tauri permissions: adding a door without its approval step fails until decided on purpose and written into SECURITY.md.
- [x] Model-made HTML previews run in a locked-down frame with no way to reach the app's doors (2026-11-07). The native side serves the page from its own address `pa-preview` with the no-network policy + `sandbox allow-scripts`; the frame is sandboxed to scripts only; the window allows frames from `pa-preview` only. Checked against 24 ways out, in Chromium (Windows' engine) and in the real Linux app (WebKitGTK + the real Tauri bridge): page scripts run (clock); fetch, XHR, beacon, WebSocket, EventSource, images, CSS, prefetch, scripts from outside, workers, forms, pop-ups, downloads, added frames, top and self navigation, storage, cookies and WebRTC all blocked; the app's page and the Tauri bridge unreachable; nothing reached an outside listener (a loosened control run did leak, so the check catches leaks). End to end: a model's render_html reply shows a live clock in chat and fullscreen.

## Open-source licences in the app (done 2026-11-07)

- [x] Settings → App Info → **Open-source licences**: every library the app ships with (JavaScript, the desktop's native side for Windows + Linux, the phone's home link library, llama.cpp, the LLVM OpenMP runtime in the Windows model runner, the fonts), each with its own copyright lines and licence text, searchable, with a link to its source. The phone shows what the phone ships, the desktop what the desktop ships. PocketPal AI's MIT notice (Copyright (c) 2024 Asghar Ghorbani) comes first.
- [x] Made by `yarn licenses` (scripts/licenses/generate.js) from the installed libraries' own licence files. Kept up to date: a test fails when package.json, yarn.lock or the Cargo files change and the list was not made again.
- [x] Fonts' licence files (SIL Open Font License, with each font's copyright) are in src/assets/licenses/fonts, from each font's own project.
- [ ] When llama.cpp is updated (src-tauri pinned release), copy its LICENSE (and the Windows LLVM OpenMP licence) into src/assets/licenses/native and update the version in the generator.

## DesktopAgent tools: what a PC can do that the phone can't (idea 2026-11-07, write-up only)

No Android sandbox on the PC: the native side (Rust) can use Windows directly (and Linux where it makes sense). More memory and a graphics card too. Same rules as everywhere (SECURITY.md 2 and 6): **every tool starts off** (Toolbox switch), and every action outside the app's own folder shows **exactly** what will happen in a native dialog; no means nothing happens. Dangerous kinds (run a command, delete, send) always ask, with no "always allow". Every action is written to a log the user can read.

**Files and documents: the workspace folder only (same as Android, decided 2026-11-07)**
- [ ] File tools work only inside the app's own workspace folder (in AppData), like the phone's workspace. No access to the rest of the PC's files.
- [ ] Getting files in and out is the user's action: import (file picker or drag and drop into the chat) puts a copy in the workspace; export / Save as copies one out. The model can't reach outside.
- [ ] Search files by name and content in the workspace.
- [ ] Read Word, Excel, PowerPoint and PDF files in the workspace as text (converted on the native side, nothing uploaded).
- [ ] Write or change a workspace file with a before/after view; nothing is saved until the user presses Save.
- [ ] Tidy up: rename / move many workspace files from one list the user checks and approves at once.
- [ ] Ask your documents: a local search index (embeddings on this PC) over the workspace, so the model can answer from your own files.

**First desktop tools (2026-11-12): the phone's actions, the PC's way**
- [x] The phone action tools work in DesktopAgent (`src/services/phoneActions/native.web.ts`), same Toolbox switches: timers, alarms (also weekly) and reminders are kept by DesktopAgent and pop up with a sound when due (while the app is open); maps open OpenStreetMap and web search opens DuckDuckGo in the browser (no Google); e-mail opens a draft in the mail app; settings pages open Windows Settings; share text copies it. Calls, texts, camera, music and other apps answer "that needs the phone".
- [x] One native door for opening things (`open_external`, SECURITY.md rule 6): pages, e-mail drafts and a fixed list of settings pages only; a native dialog with the exact address; no shell. Tests pin it.
- [ ] Check on Windows: each action once (timer pops up; maps / search / e-mail draft / Wi-Fi settings open after the dialog).
- [ ] Timers and reminders kept when the app closes (today only while it is open); a Windows notification when the app is in the background.
- [ ] Tool descriptions say "phone" (e.g. "the phone's Settings"): word them for the device they run on.

**Second desktop batch (2026-11-12)**
- [x] Files in and out on the desktop: "Add a file" and "Gallery" open native file dialogs (a copy goes into the app's folder, then the workspace or the chat, as on the phone); every "share" (workspace files, HTML pages, exports) becomes **Save a copy as…** (native save dialog); plain text is copied.
- [x] Word, Excel, PowerPoint, OpenDocument and PDF in the workspace read as text (`file_read`, `file_read_range`; read only). Checked on real files made with LibreOffice (accents, &, tables). On the phone: not yet.
- [x] `file_search` can look inside files (`in_files`): text files, and documents in the desktop app.
- [x] PC tools (desktop only, Toolbox switches): `pc_info` (system, processor, memory, graphics cards, disks), `run_command` (PowerShell / shell; native dialog with the whole command every time; workspace folder; 60 s; output cut at 32 KB), `open_file` (a workspace file in its app; never programs or scripts; asks).
- [x] Timers, alarms and reminders survive closing the app; missed ones show at the next start.
- [x] Toolbox: "Actions on this PC" instead of "Phone actions" in the desktop app.
- [ ] Check on Windows: add a .docx / .xlsx / .pdf and ask about it; Save as from the workspace and an HTML page; pc_info; a run_command (e.g. "Get-Volume") with its dialog; open_file on a picture.
- [x] Third batch (2026-11-12): `clipboard_read` (native dialog shows the text), `media_control` (media keys; asks), `print_file` (documents / pictures; asks); "Screenshot" in place of Camera (asks, hides the app, attaches the picture; Windows only); Windows notifications for timers and reminders; tray icon (open / quit); quick chat key Ctrl+Shift+Space (Settings, off by default).
- [ ] Check on Windows: screenshot (multi-monitor too) and "what's on my screen?" with a vision model; clipboard_read dialog; media keys with music playing; print a .docx; tray; the quick key; a timer notification with the app behind other windows.
- [ ] Still to do: scheduled tasks, Python scripts, code helper, "ask your documents" index, whisper / Piper voice, the phone using the PC's tools; screenshot on Linux.

**Apps and the system**
- [ ] Open an app or web page, or a workspace file in its app (asks each time, shows what opens).
- [ ] Run a PowerShell / shell command: shown in full, asks every time, output shown in the chat; a short list of read-only commands (e.g. disk space, IP address) can be allowed once.
- [ ] Read the system: battery, disk space, memory, graphics card (to pick the right model size), running programs (read-only).
- [ ] Clipboard: copy is the user's button (done); reading the clipboard asks.
- [ ] Screenshot + a vision model: "what's on my screen?" (asks each time, shows the picture first).
- [ ] Windows notifications and reminders ("remind me at 3"); timers.
- [ ] Media keys: play / pause / next.
- [ ] Open Windows settings pages (Wi-Fi, Bluetooth, display, sound), like the phone's settings tool.
- [ ] Print a document or a made page.
- [ ] Email and calendar: draft only (opens the mail app with the text filled in); never sends by itself.

**Web**
- [ ] Web pages and search from the native side (no browser limits), same tool as the phone's.
- [ ] Read pages that need JavaScript with a hidden, locked-down web view.

**Image generation (user, 2026-11-12)**
- [x] Make pictures on the PC with **stable-diffusion.cpp** (2026-11-15, first version, branch `agent/image-gen`): pinned release `master-1039-290148d` (1 Nov 2026). Windows: its `win-vulkan-x64` zip, sha256 checked, cached, `sd-cli.exe` + libraries into `src-tauri/sd/` (bundled next to `llama/`); `sd-server` removed (no password). Linux x64: built from the same tag in the Linux workflow (commit checked), **CPU only, AVX2** for now. ARM Linux: none; the tool says "not on this PC". `src-tauri/src/image_gen.rs`: `image_generate` / `image_cancel`, one `sd-cli` run per picture, no port, no network.
  - [ ] Linux x64 with Vulkan (needs Vulkan headers + glslc newer than Ubuntu 22.04's, or the prebuilt Ubuntu 24.04 Vulkan zip if the AppImage base moves to 24.04).
  - [ ] Check on Windows that the zip's layout is as expected (the workflow looks for `sd-cli.exe` anywhere in it and copies its folder) and that the two ggml copies (llama, sd) don't clash.
- [x] The `image_generate` tool (off until switched on, Toolbox): prompt, size (512 / 768 / 1024), steps (≤ 30), seed; the picture shows in the chat (read from the app's own `images` folder) with "Save a copy…". Runs on this PC only. Caps and a basic word filter on the native side (SECURITY.md rule 6). The chat's Stop kills it.
- [x] Image models as sets, as data (`src/services/imageGen/imageModels.json`): FLUX.2 klein 4B (Apache-2.0; Q4_K_M GGUF + Qwen3-4B Q4_K_M text encoder + FLUX.2 VAE, about 5.4 GB) and SD 1.5 (OpenRAIL-M, about 2.1 GB, use rules shown). Toolbox, Image models: size, licence and use rules shown before download; the licence note the first time. Downloaded with the app's downloader into `Documents/image-models/<set>`.
  - [x] Checksums in the download code (2026-11-15, security review 2): a file with a `sha256` in `imageModels.json` is checked on the native side while it streams (`download.rs`; a mismatch is deleted, never renamed into place) and again in `imageModels.ts`, and counts as downloaded only with its `<name>.sha256` note; a set marked `verified: true` with a file lacking its sha256 is refused; a set still `verified: false` downloads as before, with "Not verified yet" shown in the Toolbox and in the download question. Linux CI: the cached `sd-cli` must match the SHA-256 recorded (in its cache key) when it was built.
  - [ ] **Check the model URLs and sizes** (Hugging Face was unreachable when the list was made): `unsloth/FLUX.2-klein-4B-GGUF` `flux-2-klein-4b-Q4_K_M.gguf` (or leejet's own `FLUX.2-klein-4B-GGUF`), `unsloth/Qwen3-4B-GGUF` `Qwen3-4B-Q4_K_M.gguf`, `Comfy-Org/flux2-dev` `split_files/vae/flux2-vae.safetensors` (the FLUX.2 VAE is Apache-2.0; the BFL FLUX.2-dev repo itself is gated and non-commercial), `stable-diffusion-v1-5/stable-diffusion-v1-5` `v1-5-pruned-emaonly-fp16.safetensors`. Then add each file's sha256 and set `verified: true`, and check the downloaded files' checksums after download.
  - [ ] "Find the fit" before download (graphics card memory vs `recommendedVramGb`), and a choice of set when several are downloaded (now: the first downloaded in list order).
  - [ ] Z-Image-Turbo (Apache-2.0) as another set.
- [ ] Rough speed to check on the user's PC (16 GB RAM, 8 GB card): FLUX.2 klein 4B 4 steps at 1024px (est. 5–15 s plus model loading each picture), SD 1.5 at 512px; with and without a chat model loaded (`--offload-to-cpu` is on for klein). If loading each time is too slow: a private sd-server behind a password, or upstream `--api-key`.
- [ ] Progress while a picture is made (sd-cli prints steps; parse them).
- [x] The phone over the home link: ask the PC for a picture (built 2026-11-15, branch `agent/phone-picture`; **check on devices**). Its own link request "picture" (not the model tunnel), routed to `image_gen.rs`'s one checked maker. Off on both sides: the PC's switch "Let paired devices make pictures on this PC" plus each device's "Pictures" switch (asked in a native dialog on the PC), and the phone's `image_generate` tool in Toolbox. The device sends prompt / sizes / steps only; the PC uses its first downloaded set, notifies ("<device> is making a picture: …"), keeps a copy in its `images` folder and sends the PNG back (≤ 8 MB). The phone saves it in its cache folder (`pc-pictures`) and shows it like the PC's own pictures; a second PC (`homelink_picture`) saves it in its workspace.
  - [ ] Check on devices: switches off → clear refusals; on → a picture from the phone shows in its chat, the PC notifies; removing the device mid-picture stops it; the PC's own picture and a phone's can't run at once ("already being made").
- [ ] Later: on the phone itself (slow; newest phones only).
- **Research (2026-11-15; speeds are estimates, licences partly from secondary sources — check before any sale):**
  - Engine: stable-diffusion.cpp (MIT, very active). Prebuilt `win-vulkan-x64` (pin with tag + checksum like llama.cpp); Linux better built from a pinned tag in Actions (its Linux builds need Ubuntu 26.04; no arm64 build). Ships `sd-cli` and `sd-server`; the server has no password, so start with `sd-cli` per picture. llama.cpp itself has no image generation.
  - Default model: **FLUX.2 klein 4B** (Apache-2.0; about 5–7 GB with its Qwen3-4B text encoder and VAE; est. 5–15 s per 1024px picture on an 8 GB card). Alternative: Z-Image-Turbo (Apache-2.0). Small option for weak PCs: SD 1.5 (OpenRAIL: commercial use allowed but its use rules must be passed on).
  - Not for a product you sell: FLUX.1 dev, FLUX.2 klein 9B, SD-Turbo, SDXL-Turbo (non-commercial); SD 3.5 only under US$1M revenue a year; FLUX.3 Klein licence unconfirmed.
  - Phone: ask the PC (new `POST /v1/images/generations` in the link's allowlist, only while the image tool is on, size/steps/prompt capped). On the phone itself: stable-diffusion.cpp on CPU (SD 1.5, ~1.9 GB) or MNN; not Qualcomm QNN (proprietary). PineTab 2: not workable (tens of minutes per picture); hide on arm64 Linux.
  - Safety: no content filter in the engine. Off by default; refuse clearly illegal prompts before generating; licence notice on first use; everything stays on the PC.
  - Effort: about 2–3 weeks for the PC plus phone-via-PC; on the phone itself another 2–4 weeks.
- [ ] Diffusion *text* models (LLaDA, Dream): llama.cpp has them only as an experimental separate tool, not in its server; wait until the server supports them.

**Models and voice**
- [ ] Use the graphics card fully (Vulkan now; check CUDA / ROCm builds), bigger context, two models at once (a small fast one and a big one).
- [ ] Voice: whisper.cpp for listening, a local voice (Piper or Windows' own) for speaking; push-to-talk key.
- [ ] Quick chat: a global hotkey (e.g. Ctrl+Space) opens a small chat window over anything; tray icon; "start with Windows" (off by default).

**Automation and coding**
- [ ] Custom tools / shortcuts on the desktop too (built-in tools only, same review as the phone's).
- [ ] Scheduled tasks ("every morning: weather + calendar"), run only while the app is open, each run listed.
- [ ] Run small Python scripts for maths, charts and data, inside the workspace, asking first; the result is shown before anything is saved.
- [ ] Code helper for a project imported into the workspace: read files, explain, propose changes as a diff the user applies.

**Together with the phone (home link)**
- [ ] The phone uses the PC's tools too (not only the model): each PC tool still asks on the PC, or on the phone with the PC's dialog mirrored; off by default.
- [ ] Hand off: start a task on the phone, finish it on the PC (and back).

## Home link: use your home PC's model from your phone, anywhere (started 2026-11-07)

Research (2026-11-07): **iroh 1.x** (Rust, MIT/Apache, 1.0 in June 2026; we pin 1.4.1). Devices dial each other by public key; direct connection first (hole punching through home routers and mobile networks), else a relay that only passes encrypted bytes. Official Kotlin bindings exist (`computer.iroh:iroh`), but one report says their async calls hang on Android. Compared: plain WireGuard needs port forwarding / a public IP (often impossible behind the provider's shared address, CGNAT); Tailscale needs an outside account (Headscale: your own server); Tor onion services in Rust (Arti) work but lack DoS protection and are slower. n0's 4 public relays are free but rate-limited, "for development"; they can't read the traffic. Self-hosting `iroh-relay` is one binary.

**Desktop side (done, checked in the real Linux app with a stand-in phone):**
- [x] `src-tauri/src/link.rs` + Settings card "Use this PC's model from your phone": off by default; Pair a phone shows a QR code (PC key + one-time code, 10 min, one try); the phone sends the code; the PC asks in a native dialog; only then the phone's key is saved (credential store, names the screens can't write).
- [x] Paired phones can only: ask whether a model runs (with its password), and pass HTTP to this PC's own model server. Checked: unpaired phone refused; reused code refused without a dialog; a paired phone asking for anything else refused; streamed chat reply through the link; Remove shuts the phone out at once; Switch off closes the port.
- [x] Linux: the kernel keyring got an entry stuck (neither readable nor writable), so on Linux the link key and paired phones live in an owner-only file in the app's settings folder (~/.config/…), outside the data folder the screens reach. Windows: Credential Manager.
- [x] Built with the `link` feature (default). The Windows type-check here runs with `--no-default-features` (no Windows C compiler here for iroh's crypto library; the real Windows build has one).
- [x] Pairing codes are single use (one try, 10 minutes). Pairing history (user, 2026-11-08): every code made, phone paired and phone removed is recorded on the PC and sent to paired phones with each status; the phone shows "Pairing activity on your PC" for anything new (not its own pairing). Checked in the real app: making a code shows up in the paired phone's status.
- [ ] Tell the phone at once (not only at its next contact): a background check or a push over the link while the app is closed.
- [ ] Optional setting: a new pairing also needs OK from an already paired phone (pairing itself is not mirrored by "the PC asks, the phone can answer": asked on the PC only).
- [ ] **Show how phone and PC are connected** (user, 2026-11-08): on both devices, "Connected directly (local network)" or "Connected through a relay (encrypted)", from iroh's path info; live while chatting.
- [ ] **Switch networks without reconnecting** (user, 2026-11-08): leaving home mid-chat (Wi-Fi off), the link moves to mobile data / the relay by itself and back to direct when possible (iroh connections can change path); no new pairing, no restart, the chat carries on. Test on real devices: Wi-Fi off mid-reply, then on again. Optional "Switch now" button before leaving, and a "Prefer: automatic / direct only / relay" setting.
- [ ] Note for users whose PC gets internet through the phone's hotspot (as in the first test): away from home the PC has no internet, so the link can't reach it; it needs its own connection.
- [ ] Relays: n0's public relays by default; add "Use my own relay" (URL) for people who self-host.
- [ ] Keep running when the window is closed (tray icon), and start the model when a paired phone asks.
- [ ] Linux keeps keys in the kernel keyring (forgotten after a reboot): use the desktop's secret service there.

**Phone side (written 2026-11-07; not yet built for Android):**
- [x] `native/homelink`: our own small Rust library (same iroh 1.4.1 as the PC side; not the Kotlin bindings that were reported to hang on Android). Pair from the QR code, ask status, open a local port on the phone (127.0.0.1 only, others turned away) that leads to the PC's model server. Checked here against the real desktop app: pairing (PC dialog), status, `GET /v1/models` and a streamed chat through the local port with plain `curl`, wrong password refused, bad QR refused.
- [x] Android door: JNI calls answering JSON (`src/android.rs`), checked here by loading the real library from Java with the app's class and method names: pair, status, tunnel + streamed chat, close.
- [x] `HomeLinkModule.kt` (calls off the main thread; phone key in the no-backup folder), registered in MainApplication. The QR scanner also takes `PA1:P:` pairing codes; the phone asks "Pair with your PC?", then adds the server "Home PC" (10-minute wait for slow PCs). Before listing or loading a Home PC model, the app reopens the tunnel and takes the model's current password.
- [x] The Android build compiles the library (cargo-ndk 4.1.2, NDK 27.3, arm64) into jniLibs before Gradle.
- [x] Phone stays small (rule 5): no new Android permission.
- [x] First phone test (2026-11-07): the app closed on pairing (native crash in libc.so). Cause: iroh's DNS and network code read the Android app context (ndk-context), which was never set, and the library was built to abort on any failure, so even iroh's own fallback couldn't catch it. Fixed: the app context is handed to iroh once at start (`install_android_jni_context`, as iroh documents), every Android door catches failures and answers with an error, and both the phone library and the desktop are built to unwind, never abort (pinned by a rule test).
- [ ] Build the APK (the Android job runs from main, or by hand on a branch) and test on a phone: pair over the hotspot, then away from home on mobile data (relay).
- [ ] Keep the tunnel alive in the background (foreground service) for long replies with the screen off.
- [ ] Desktop-to-phone the other way (PC uses the phone's tools), shared tasks: later.

## PocketAgent Desktop: companion app and phone ↔ desktop link (idea 2026-11-06, write-up only)

A desktop app that pairs with the phone: trains the personal LoRA, runs bigger models (14B–30B) for the phone, and takes heavy jobs. **Platforms (decided 2026-11-07, updated 2026-11-12): Windows first, then Linux (x64 and ARM builds exist now); no Apple at all (no Mac, no iPhone).** Open source, no Google, no account, no cloud.

### How they talk (the link)

- [ ] **Pair once by QR** (same Scan QR screen as tools, tag `PA1:P:`): the desktop shows a QR with its address, its public key and a one-time code; the phone scans it (same scanner as tool sharing), sends its own public key, both save each other. No account or server involved.
- [ ] **Find each other:** on the same Wi-Fi by local discovery (mDNS / Android NSD); fall back to the address from the QR.
- [ ] **Encrypted both ways:** every connection is mutually authenticated with the saved keys (TLS with pinned keys, or the Noise protocol); nothing in clear text, even at home. Unknown devices are refused.
- [ ] **Away from home (later, optional):** the user's own WireGuard VPN or a self-hosted relay; never a PocketAgent-run server.
- [ ] **USB fallback:** works over a cable too (adb reverse), for no-Wi-Fi setups.
- [ ] **Windows notes:** one installer, no admin rights needed where possible; asks Windows Firewall to allow the local network only (private networks, not public); GPU training on NVIDIA (CUDA) first, AMD/Intel later (Vulkan / DirectML); runs in the tray so the phone can reach it.
- [ ] **One small protocol, three kinds of message:**
  1. *Model:* the OpenAI-style chat API the app already speaks (the desktop runs llama-server or similar), so "use the desktop's model" is just a paired server.
  2. *Files:* send a dataset to the desktop, get an adapter back; checked by hash, resumable.
  3. *Jobs:* start / progress / cancel for training and heavy work; the phone shows progress.
- [ ] **Desktop side:** listens on the local network only, never the internet; paired devices listed with **Remove**; a log of what each device asked for.

### Working together on the same task (idea 2026-11-07)

The phone agent and the desktop agent talk to each other over the paired link and share work, each doing what it is best at: the phone does phone things (alarms, texts, contacts, camera, being with you), the PC does heavy things (big models, training, long documents, files on the PC).

- [ ] **Shared task list:** a task started on one device shows on both (title, steps, status, who is doing which step); either device can pick up a step; progress and results flow back. Works offline per device and syncs when they are both on the link.
- [ ] **Agent-to-agent messages:** one agent can ask the other to do a step ("desktop: summarise this 200-page PDF"; "phone: set a reminder for the result"), with the request and the answer shown in the chat on both sides.
- [ ] **Hand-off:** start a chat on the phone, continue it on the PC (and back) with the same context; the chat moves only when you ask.
- [ ] **Shared memory (opt-in):** memory notes can sync between the two; off by default; you pick which notes.
- [ ] **Safety:** a request from the other agent is treated like a request from a model: the same Toolbox switches and approval dialogs apply on the device that does the step (a desktop request to text someone asks on the phone, every time). Each device can refuse; a task log on both sides shows who asked for what. No step runs on a device whose user hasn't switched that tool on there.
- [ ] Build after: pairing (step 1) and "use a desktop model"; reuses the link's "Jobs" messages.

### Safety rules for the link (add to SECURITY.md when built)

- [ ] A request from the other device counts like a request from a model: the same Toolbox switches and approvals apply. The desktop can never trigger a phone action, read contacts or texts, or change memory without the approval dialog on the phone; the phone can't run anything on the desktop that the desktop user hasn't allowed.
- [ ] Only what the user picked is sent (e.g. the chosen training examples). The desktop deletes training data after the job unless the user keeps it.
- [ ] Remove a device on either side and its keys stop working at once.

### Steps (each on its own; ask before each)

1. [ ] **Use a desktop model:** QR pairing + the encrypted link to a llama-server on the PC; appears as a server in the app.
2. [ ] **Desktop training (Windows):** dataset upload, LoRA training on the PC's GPU (llama.cpp's own or the usual Python tools, whichever works best per GPU), adapter sent back, data deleted.
3. [ ] **Phone dataset export** in the order decided: contacts → texts → later files and photos.
4. [ ] **Heavy jobs:** long transcriptions, photo captioning for training.
5. [ ] **Later:** away-from-home link (own VPN / relay).

## Mods ecosystem (write-up only, not started)

Idea 2026-11-06: let people make and share small add-ons ("mods") for the app, listed on a website. Start free and simple.

**Audience:** privacy-minded people, GrapheneOS and de-Googled phone users, people running models on the phone. So **no Google anywhere**: not in the site, not in the app's mod flow, not in payments.

Mod types (all **data, not code**):

- Custom tools (instructions and shortcuts); the first mod type, shared by QR (see Custom tools above).
- Assistants / Pals: a system prompt, starter questions, which tools they use.
- Phone-action packs: shortcuts for one app or routine (e.g. "drive mode").
- Prompt / skill packs: sets of saved instructions.
- Model recipes: a Hugging Face model plus its best settings (context, template, sampling, vision projector).
- HTML mini apps: pages shown in the HTML preview (no network, sandboxed).
- Knowledge packs: notes or documents for memory.
- Themes, voices and wake words.

Safety rules for every mod:

- [ ] Data only, never code that runs outside the HTML preview sandbox.
- [ ] A mod lists every tool it uses; the install screen shows them and the full contents.
- [ ] Installs **switched off**; phone actions still ask for approval as today.
- [ ] Versioned format with a tag (`PA1:` …); the app rejects formats it doesn't know.
- [ ] Later: signed mods (author key) and a way to report a bad one.

The site:

- [ ] A plain website with **lists** of mods (by type, newest, most used), each with its full contents shown, the tools it uses and a QR / download link.
- [ ] Static pages: no Google Analytics, Fonts, reCAPTCHA, Firebase or ads; no trackers or cookies; works without JavaScript where possible. Hosted off Google (e.g. Codeberg Pages or a small VPS).
- [ ] The app can read the same lists (one index file) to browse and install, with the same review screen. Off until the user turns it on (it's a network call).
- [ ] Submissions by pull request or a simple form; reviewed before listing.

Steps:

1. [ ] **Free sharing:** QR, file and link for custom tools first, then assistants and model recipes.
2. [ ] **The site with lists** (above).
3. [ ] **Paid mods (maybe):** small price, the site takes a small cut. No Google Play billing: use options this audience accepts (e.g. Liberapay / Open Collective tips, a non-Google card processor, or crypto such as Monero), plus payouts and tax handling for makers. Only worth it once the site has real users.
4. [ ] App distribution to match: GitHub releases, F-Droid and Accrescent first; Play only if ever wanted.

## Stream large MoE models from storage (built, experiment, needs phone check)

Idea from Colibrì (a C engine running a 744B MoE model in ~25 GB of RAM by reading experts from SSD). On a phone, keep to about 16B total.

- [x] Settings → Advanced → **Stream large models from storage**, off by default.
- [x] For a mixture-of-experts model (name carries the active size: `1b-a400m`, `30B-A3B`, `8B-A1B`): the file is memory-mapped and not locked, and the memory check counts about twice the active share of the weights (between 1/4 and all of them). When the whole model wouldn't fit, a "Stream this model from storage?" warning explains it will be slower and Android may close the app.
- [x] Ordinary (dense) models and everything with the switch off are unchanged.
- [ ] Phone check: Granite 1B-A400M with the switch on (should behave as before), then a larger MoE (e.g. LFM2-8B-A1B, Qwen3-30B-A3B is over the 16B advice); speed, and whether Android closes the app.

## Voice assistant: wake word and voice control (phase 1 built, needs phone check)

Goal: an Alexa-style assistant. Say a wake phrase, speak a request, and PocketAgent answers out loud and, for phone tasks, acts. Everything runs offline on the phone. Research done 2026-11-04; nothing built yet.

### What the app has today
- Spoken replies (text-to-speech): system voice, Kitten and Supertonic voices, auto-speak. This covers the "answer out loud" part.
- No microphone input, no wake word, no voice commands.

### Research findings
- **Android limits on "always listening".**
  - Listening in the background needs a foreground service of type `microphone`, which shows a permanent notification. It also needs `RECORD_AUDIO`, `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MICROPHONE`.
  - On Android 14+, a microphone service must be started while the app is visible (or from a notification, a widget, or by the default assistant app). It can't simply start itself at boot and listen.
  - Source: developer.android.com, "Restrictions on starting a foreground service from the background".
- **True Alexa/Google-style hotwords (screen off, very low power) are not available to normal apps.** Android's `HotwordDetectionService` and its permissions are limited to preinstalled or system apps. So PocketAgent can only listen through its own foreground service, using the phone's main processor, which costs battery.
- **Default assistant app.** Android lets the user pick a third-party "digital assistant" app (Settings → Apps → Default apps). Being that app (`VoiceInteractionService`) means:
  - the assist gesture or power-button long-press opens PocketAgent;
  - its microphone service is allowed to start from the background.

  This is the most reliable, battery-friendly way to call it up, even without a wake word.
- **Wake-word engines (offline):**
  - **sherpa-onnx keyword spotting:** Apache-2.0, Android support. It reportedly lets you type custom keywords without training a model. The same library also does speech-to-text, voice detection and text-to-speech.
    - React Native: only a young wrapper exists (`@siteed/sherpa-onnx.rn`, "in development"); the likely route is our own small Kotlin module using sherpa-onnx's Kotlin API.
    - Its docs site (k2-fsa.github.io) is blocked in this session's network, so the custom-keyword claim and model sizes still need confirming.
  - **openWakeWord:** Apache-2.0 base models; Android ports exist (Kotlin). Custom words need a trained model (training is Python, done off the phone). Check the licence of any training voices or data.
  - **Picovoice Porcupine:** high quality, but needs an online-validated access key. Forum reports say free-tier keys were stopped after 2026-06-30. **Not recommended:** it conflicts with offline use and costs money.
- **Speech-to-text (after the wake word):**
  - **whisper.rn:** by mybigday, the same people as llama.rn, which the app already uses. Offline Whisper with a `RealtimeTranscriber`, Silero voice detection (knows when you stop talking), and Parakeet support. It needs `@fugood/react-native-audio-pcm-stream` for mic audio.
  - **Android on-device recognizer** (`createOnDeviceSpeechRecognizer`, Android 12+): no model download, but availability varies by phone and some ROMs remove it. Check `isOnDeviceRecognitionAvailable` first.
  - **sherpa-onnx streaming speech-to-text:** this would put wake word and speech-to-text in one library.
- **Memory:** Whisper (or the wake-word model) has to share memory with the chat model, and on today's test phone only one large model fits well. A small speech-to-text model (Whisper tiny/base) is fine; the target is future phones.

### Finding voice models (no fixed model)
Like vision models, the app finds what's available instead of being tied to one model. The user can pick any compatible wake-word or speech-to-text model from Hugging Face.
- **Models screen: a "Voice" search** next to the chat-model search. Today's search is limited to `gguf,conversational` (`HFStore.queryFilter`), so voice models never show.
- **Compatibility is checked by the files in the repo; only models the app can run are offered:**
  - Wake word, sherpa-onnx keyword spotter: encoder, decoder and joiner `.onnx` files plus `tokens.txt`.
  - Wake word, openWakeWord: one classifier `.onnx` (the shared melspectrogram and embedding models ship with the app).
  - Speech-to-text, whisper.rn: Whisper `ggml-*.bin` files.
- **Tags in the list,** like today's Vision tag: **Wake word** and **Speech to text**. Also the size, and the language when the model card says.
- **Settings → Voice** lists downloaded voice models; the user picks one for wake word and one for speech-to-text. A recommended default is suggested (the k2-fsa keyword spotter, Whisper base) but not forced.
- **Unknown uploaders:** ONNX and GGML files are data, not code, but show the author and download count, and warn on new or unknown repos (like any download).
- [ ] Confirm the file layouts above against real repos (needs `huggingface.co` allowed in this session's network settings).

### Plan (each phase usable on its own; ask before each)
1. **Mic button and conversation mode.**
   - Tap the mic and speak; text appears in the input (whisper.rn plus voice detection), then it sends.
   - With auto-speak on, the answer is read out and the mic reopens ("conversation mode") until you stop it.
   - No background listening; the app must be open.
   - Picks: whisper.rn plus the Whisper base model as an optional download, with the Android recognizer as fallback.
2. **Voice control (phone actions phase 1, see the section below).** Timers, alarms, opening apps, navigation and music through Android intents. Spoken requests go to the same tools, and anything that acts is confirmed.
3. **Call it up like an assistant.** Register PocketAgent as a selectable default digital assistant: the assist gesture or power-button long-press opens a listening screen. No wake word and no constant mic, so no extra battery.
4. **Wake word ("Hey Agent"), built early (see status below).**
   - Off by default. A foreground microphone service with a visible "listening" notification and a Stop action. The user turns it on while the app is open.
   - Choice: sherpa-onnx keyword spotting (custom phrase, no training) if confirmed; otherwise openWakeWord.
   - On wake: a chime, then speech-to-text, the model answers and speaks.
   - Measure battery and false wakes on the phone before turning it on for anyone.

### Phase 1 status (built 2026-11-04)
- [x] Mic button in the chat input: tap to speak, tap again to stop early, long-press for Voice input settings.
- [x] Speech-to-text on the phone with whisper.rn; any Whisper GGML model from Hugging Face (search, download, pick). Recommended default: `ggerganov/whisper.cpp` / `ggml-base.en.bin`.
- [x] End of speech detected from loudness (no extra model); stops after a pause, when nothing is said, or at 30 s.
- [x] Conversation mode: after the answer (and its speech, with auto-speak) listen again.
- [x] Whisper model loaded only while in use.
- [ ] Phone check: download the recommended model, speak a message, conversation mode with auto-speak on, mic permission prompt, a noisy room.
- [ ] Measure Whisper speed and memory with a chat model loaded on the test phone.
- Not yet: the Android built-in recognizer as a fallback (only Whisper for now).

### Wake word status (built 2026-11-04, decisions: reuse Whisper, background from the start)
- [x] Detected with the same Whisper model: the mic stays open, each utterance (speech then a pause) is written down and checked for the phrase. Any phrase, default "Hey Agent"; loose matching for Whisper's spelling ("Hey, agent", "a gent").
- [x] "Hey Agent, what time is it?" sends the request directly. "Hey Agent" alone vibrates and listens for the request.
- [x] Background: `WakeListenService`, a microphone-type foreground service, with a "Listening for …" notification and Stop. Started only while the app is visible (Android 14 rule); turned back on when the app opens if it was left on.
- [x] The mic is released while voice input listens, a reply runs, or the app is speaking, so it never hears itself.
- [x] Steady background noise (fan, traffic) is learned and ignored.
- [x] Per-model wake words: a **Wake words** field next to the model's name in its settings ("Hey Jarvis, Jarvis"). Saying one picks that model and loads it if it isn't loaded. The general phrase ("Hey Agent") uses the loaded model, or the last used one.
- [ ] Phone check: turn it on, close the app, say the phrase (with and without a request), screen off, the notification's Stop, a noisy room, TV talking.
- [ ] Phone check: give two models wake words, wake each by name with no model loaded and with the other loaded (loading in the background; check the memory warning doesn't block it).
- [ ] Measure battery over a day and false wakes (it runs Whisper on any speech it hears).
- Later: a dedicated low-power wake engine (sherpa-onnx) if battery is a problem; opening as the default assistant (phase 3).

### Safety and privacy
- The mic is never on without a visible indicator (the app screen or the listening notification). Stop is always one tap away.
- Audio stays on the phone and isn't saved, except a transcript the user can see in the chat.
- Wake word and assistant mode are off by default. Phone actions keep their per-action confirmation.

### To confirm before building
- [ ] sherpa-onnx custom-keyword support, model size and accuracy (allow `k2-fsa.github.io` in the network settings).
- [ ] whisper.rn on the test phone: Whisper tiny/base speed, and memory with a chat model loaded.
- [ ] Default digital assistant registration on a recent Android (which screens and permissions are needed).
- [ ] The battery cost of an always-on wake-word service over a day.

## Platforms

Decided 2026-11-07 (updated): phone app **Android only** (GrapheneOS-friendly). Desktop app, called **DesktopAgent**: **Windows and Linux** from the same Tauri code (most GrapheneOS users run Linux). **No Apple at all:** no iPhone, no Mac. The iOS code inherited from PocketPal stays in the repo (don't delete) but is not built, tested or planned for.

## Future hardware & GrapheneOS readiness (write-up only, not started)

Target: the next foldable/flagship Motorola phones (a 2027 razr or similar), possibly running GrapheneOS.

**Motorola + GrapheneOS (checked 2026-11-06):** a long-term partnership was announced at MWC on 2 March 2026. No devices are confirmed: GrapheneOS said the first compatible Motorola phones could come in 2027, premium hardware first (reports name the Motorola Signature and razr fold), and it isn't settled whether GrapheneOS ships preinstalled or is installed afterwards. Current Motorola phones, the 2023 Razr included, don't meet GrapheneOS's hardware requirements. Motorola also plans to bring some GrapheneOS features to its regular Android phones.

Expected hardware (estimate): 12-16 GB RAM, a Snapdragon 8 Elite-class chip with a stronger Hexagon NPU, UFS 4/5 storage.

- [ ] **Work with no Google services.** Firebase (incl. App Check), Google Sign-In and in-app purchases (left from PocketPal's hub account and paid features) must be optional: the app starts and works fully without Google Play services; only hub sign-in and purchases switch off. Also needed for an F-Droid or Accrescent build.
- [ ] **No-network mode.** GrapheneOS can remove an app's internet access. Local models keep working; search, page reading and cloud models say "no network" plainly instead of failing with errors.
- [ ] **Scoped permissions.** Test contact lookup with Contact Scopes and file picking with Storage Scopes (the user grants only some contacts/files).
- [ ] **Hardened memory allocator.** Measure model load time and memory under GrapheneOS's allocator; if a large model crashes, note the per-app "exploit protection compatibility mode" workaround in the app's help.
- [ ] **Bigger models.** With 12-16 GB: dense 8-14B Q4 fully in RAM; Qwen3-30B-A3B with "Stream large models from storage"; keep multi-model sensible (2 models of ~4 GB).
- [ ] **NPU.** Resume the Hexagon NPU work (section below) on that hardware.
- [ ] **Distribution.** A Google-free build for Accrescent / F-Droid alongside the normal APK.

Sources: [Android Authority](https://www.androidauthority.com/grapheneos-motorola-partnership-announced-3645710), [TechRepublic](https://www.techrepublic.com/article/news-motorola-grapheneos-partnership-2027/), [The Register](https://www.theregister.com/2026/03/02/motorola_grapheneos/), [Neowin](https://www.neowin.net/news/motorola-announces-partnership-with-grapheneos-foundation/).

## Deferred — NPU acceleration (on hold)

On hold until a better test phone is available. On the current test device (Motorola Razr 2023, SM7450 / Hexagon V69) NPU offload is effectively a no-op, so CPU inference stays the only supported backend for now. See issue #1 for the investigation notes and safe implementation sequence.

- [ ] Get a test phone with a supported, verifiable NPU (e.g. newer Snapdragon with Hexagon HTP).
- [ ] Resume issue #1: probe HTP library loading, test a small GGUF model, measure real offload and token speed.
- [ ] Do not replace or disable the working CPU backend; no fake NPU toggle.

## Other future work

- [ ] Draft PR #2 (tool permissions dialog, tool diagnostics, guarded fetch / network policy) was closed as superseded; its branch `checkpoint/pocketagent-2026-10-21-integration` is kept. Port the useful parts onto `main` if wanted.

- [ ] Offline voice, wake phrase, spoken responses, and smart-home routines.

## Phosphor visual restyle (look only)

Restyle PocketAgent to match the look of the PHOSPHOR v46 prompt inspector (`phosphor_v46_prompt_inspector-1.html`). **Visual change only:** keep every existing PocketAgent screen, feature, and flow as it is, and do not bring in any Phosphor functionality, code, or tools.

Reference look (from the Phosphor stylesheet):

- Green-phosphor CRT terminal palette: text `#85ff9b`, muted `#4eac65`, emphasis `#b3ffc1`, background `#010602`, panels `#031006`, inputs `#020b04`, hover/active `#10371b`, banners `#07140c`, log areas `#000`, borders `#285f36`.
- Monospace type everywhere (`'Courier New', monospace`, 14px / 1.5), wide letter-spaced uppercase headings.
- Soft text glow: `text-shadow: 0 0 2px #3bff65`; glowing status dots and progress fills.
- Full-screen scanline overlay (faint horizontal lines, ~6.5% black every 4px), non-interactive.
- Square corners (`border-radius: 0`), 1px thin green borders on panels, buttons, inputs, and cards; no drop shadows or rounded pills.
- Buttons: dark fill with green border; hover/active brighten border to the text color and fill with the hover green.
- Blinking block cursor for "thinking"/streaming states.

Tasks:

- [x] Add a Phosphor theme to the app theme system (colors, fonts, borders, radius) rather than hard-coding styles per screen (PR #3).
- [x] Apply it across every screen, including hard-coded colours, corners and fonts (PR #3).
- [x] Scanline overlay, text glow and blinking block cursor (PR #3).
- [x] Selectable in Settings → App Settings → Phosphor Style, off by default; light/dark stay available (PR #3).
- [x] Readable Toolbox / Hardware screens in Phosphor and Dark Mode (navigator background) (PR #3).
- [x] R/G/B sliders under the Phosphor switch to recolour it; palette always readable (text ≥ 7:1, muted ≥ 4.5:1, borders ≥ 3:1) (PR #3).

Phone checks:

- [ ] Scanlines and glow perform well on the test phone.
- [ ] Glow and scanlines don't hurt legibility; try several slider colours.
- [ ] Before/after screenshots on device; confirm no behavior changes with Phosphor off.
