# PocketAgent TODO and Future Roadmap

Updated: 2026-11-03. This document tracks planned work. Items marked done are done in code (with tests) on the open PR stack (#3 → #4 → #5 → todo-batch); anything that still needs checking on the phone is listed under **Phone checks**.

## Current validation and fixes

- [x] Memory editor easy to reach: **Toolbox → Memory**, above Global System Prompt; History lists every snapshot to preview and restore (PR #5).
- [x] Memory is added to Qwen's context on every run, User Memory has no model write tool, Model Memory writes need approval (code + tests, PR #5).
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

## Future batch — ARTEMIS-inspired Android automation (deferred)

Reference: https://github.com/google/artemis

Research only until explicitly approved for implementation. Verify upstream license and third-party notices before copying code.

- [ ] Study ARTEMIS Flash/Pro execution modes and observe → act → verify → recover architecture.
- [ ] Implement native Android **timers**: create, pause, resume, cancel, and check remaining time; support spoken requests such as “Set a timer for 15 minutes.”
- [ ] Support **alarms and reminders** via Android Clock and appropriate system APIs.
- [ ] **Open installed phone apps** by voice or chat using Android intents and package discovery (e.g. camera, maps, music).
- [ ] **Use and navigate other apps** with permission-controlled Android Accessibility: inspect screen hierarchy, tap, scroll, type, and verify outcomes.
- [ ] Build cross-app workflows, such as opening navigation or playing a requested playlist, with confirmation where appropriate.
- [ ] Prefer semantic accessibility nodes and Android intents over fragile screen-coordinate taps.
- [ ] Investigate screenshots and local vision fallback compatible with offline Qwen 3.5 2B.
- [ ] Implement action safety: explicit permissions, confirmation for sensitive actions, cancellation, bounded retries, and failure recovery.
- [ ] Compress action history to reduce model context use.
- [ ] Evaluate ARTEMIS MCP integration for external development and testing.
- [ ] Add Android emulator/device regression tests, screenshots, Logcat, and replay traces.
- [ ] Keep execution offline-first where Android capabilities allow; clearly identify features needing external services.

### Suggested future implementation order

1. Native timers, alarms, and app launching.
2. Accessibility service and semantic UI observation.
3. ARTEMIS-inspired action controller with verification and recovery.
4. Cross-app workflows and comprehensive safety/device tests.

## Deferred — NPU acceleration (on hold)

On hold until a better test phone is available. On the current test device (Motorola Razr 2023, SM7450 / Hexagon V69) NPU offload is effectively a no-op, so CPU inference stays the only supported backend for now. See issue #1 for the investigation notes and safe implementation sequence.

- [ ] Get a test phone with a supported, verifiable NPU (e.g. newer Snapdragon with Hexagon HTP).
- [ ] Resume issue #1: probe HTP library loading, test a small GGUF model, measure real offload and token speed.
- [ ] Do not replace or disable the working CPU backend; no fake NPU toggle.

## Other future work

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

- [ ] Scanlines and glow perform well on the Razr.
- [ ] Glow and scanlines don't hurt legibility; try several slider colours.
- [ ] Before/after screenshots on device; confirm no behavior changes with Phosphor off.
