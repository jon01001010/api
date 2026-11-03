# PocketAgent TODO and Future Roadmap

Updated: 2026-11-02. This document tracks planned work, not completed implementation.

## Current validation and fixes

- [ ] Validate dual User Memory / Model Memory UI on a physical Android device, including saving, snapshots, restoration, and model-write approvals.
- [ ] Confirm memory is loaded into Qwen context on every new run and user memory remains model-read-only.
- [ ] Fix HTML preview stuck on **Loading…** in chat (reported with generated current-time clock).
- [ ] Render generated HTML/CSS/JavaScript live inside chat, including updating clocks and timers.
- [ ] Verify code view, copy, expand/fullscreen, and saving/exporting generated `.html` files.
- [ ] Add sandbox restrictions, load/error timeouts, and regression tests for embedded HTML.
- [ ] Harden `read_url` redirect handling: verify the final resolved URL against the allowlist, enforce strict host/port/path matching, and test redirect escapes and provider final-URL reporting.
- [ ] Finish workspace file operations (append, patch, diff, undo/history) and fix newline/extension matching bugs.

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

## Other future work

- [ ] Offline voice, wake phrase, spoken responses, and smart-home routines.
- [ ] Phosphor incorporation: define integration scope, inspect upstream license/dependencies, and plan a separate implementation batch.

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

- [ ] Add a Phosphor theme to the app theme system (colors, fonts, borders, radius) rather than hard-coding styles per screen.
- [ ] Apply it across chat, sidebar, model list, Pals, Toolbox, hardware diagnostics, settings, and onboarding.
- [ ] Implement the scanline overlay and text glow in React Native (e.g. overlay view / image; check performance on the Razr).
- [ ] Keep the current light/dark themes available; Phosphor as a selectable theme (decide whether it becomes the default).
- [ ] Check readability and contrast (WCAG AA) of muted text, and that glow/scanlines don't hurt legibility.
- [ ] Before/after screenshots on device; confirm no behavior changes.
