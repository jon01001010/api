# PocketAgent TODO and Future Roadmap

**Target: future phones and models.** The current test phone (Motorola Razr 2023) and small models (e.g. Qwen 3.5 2B) are a development stand-in; don't tune features or prompts for them.

Updated: 2026-11-03. This document tracks planned work. Items marked done are done in code (with tests) on the open PR stack (#3 → #4 → #5 → todo-batch); anything that still needs checking on the phone is listed under **Phone checks**.

## Current validation and fixes

- [x] Memory editor easy to reach: **Toolbox → Memory**, above Global System Prompt; History lists every snapshot to preview and restore (PR #5).
- [x] Memory is added to the model's context on every run, User Memory has no model write tool, Model Memory writes need approval (code + tests, PR #5).
- [x] Fix HTML preview stuck on **Loading…** in chat: JavaScript was disabled (PR #4).
- [x] Render generated HTML/CSS/JavaScript live inside chat, including updating clocks and timers (PR #4).
- [x] Save generated pages as `.html`: to the workspace or via the share sheet.
- [x] Add sandbox restrictions, load/error timeouts, and regression tests for embedded HTML (PR #4).
- [x] `read_url`: strict port matching for user-named sites, no https→http downgrade, redirect-escape tests.
- [ ] `read_url`: readers must report a **verified final URL** (Firecrawl / Exa / default reader). Until then every read fails closed. Needs each provider's final-URL field confirmed against its docs.
- [x] `read_url`: an http page and its https version count as the same page (https preferred when both are allowed).
- [x] Workspace file operations: `file_append`, `file_patch`, `file_diff`, `file_history`, `file_undo`; per-file version history; diff shown in the approval dialog.
- [x] Fix newline (`file_read_range`, `file_search`) and extension (`file_info`) matching bugs.

### Phone checks

- [ ] Memory: save both memories, History → pick a snapshot → restore, and a model memory edit asks for approval.
- [ ] HTML preview: a generated clock ticks in chat and fullscreen; code view, copy, fullscreen, Save to workspace, and Share work.
- [ ] Workspace tools: append / patch / undo through chat, with the diff in the approval dialog.

## Phone actions via built-in Android intents (planned, not implemented)

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

- [ ] Kotlin `PhoneActions` module: send an allow-listed set of intents with typed extras; list launchable apps (label + package); `resolveActivity` check; nothing else.
- [ ] Manifest: `SET_ALARM` permission; `<queries>` for MAIN/LAUNCHER and the intents above.
- [ ] Model tools, all **off by default** in Toolbox like other tools:
  - `set_timer`, `show_timers`
  - `set_alarm`, `show_alarms`
  - `add_reminder` (opens the Calendar screen pre-filled)
  - `open_app` (match by app name; ask when more than one matches)
  - `navigate_to`, `play_music`, `open_camera`, `open_settings`
  - `compose_message` (dial / SMS / email screens, user sends)
- [ ] Safety:
  - Every action shows an approval prompt in chat first (like file writes), naming exactly what will happen ("Set a 15-minute timer named Tea?").
  - Nothing places calls, sends messages, pays, or changes settings by itself.
  - No `CALL_PHONE`, `SEND_SMS` or `QUERY_ALL_PACKAGES`.
- [ ] Voice: spoken requests ("Set a timer for 15 minutes") go through the existing chat and voice input to the same tools. Time parsing is in the tool arguments, which are validated (timer 1 s–24 h; alarm hour 0–23 / minute 0–59).
- [ ] Tests: JS tool tests (argument validation, approval required, denied → nothing sent, unknown app → clear message). The Kotlin side can only be verified on the phone APK.
- [ ] Phone checks on the test phone: timer, alarm, reminder, open app, navigation, music, camera, settings, and a "no app can handle this" case.

**Phase 2: cross-app workflows (still intents only).**

- [ ] Chain phase 1 actions with a confirmation per step (e.g. "navigate home, then play my playlist"). Bounded steps; cancel at any time.

**Phase 3: using other apps by tapping and scrolling (optional; decide later).**

- [ ] Only if phases 1–2 aren't enough. It needs an in-app Kotlin Accessibility service, which means:
  - a strong user-granted permission;
  - Google Play policy review;
  - careful safety design: explicit per-task consent, sensitive-screen blocklist (banking, passwords, payments), bounded retries, a stop button, and no free-form coordinate tapping without a visible target.
- [ ] Reuse the ARTEMIS ideas listed above; learn from its Java helper (Apache-2.0, keep notices if any code is adapted).
- [ ] Screenshots / local vision with an offline vision model on newer phones: investigate feasibility before committing.

**Dropped from the old list:**

- "Evaluate ARTEMIS MCP integration": that is for driving a phone from a computer IDE, not for PocketAgent on the phone.

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
