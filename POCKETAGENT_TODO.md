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
