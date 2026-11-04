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

## Voice assistant: wake word and voice control (researched, not implemented)

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
4. **Wake word ("Hey Agent").**
   - Off by default. A foreground microphone service with a visible "listening" notification and a Stop action. The user turns it on while the app is open.
   - Choice: sherpa-onnx keyword spotting (custom phrase, no training) if confirmed; otherwise openWakeWord.
   - On wake: a chime, then speech-to-text, the model answers and speaks.
   - Measure battery and false wakes on the phone before turning it on for anyone.

### Safety and privacy
- The mic is never on without a visible indicator (the app screen or the listening notification). Stop is always one tap away.
- Audio stays on the phone and isn't saved, except a transcript the user can see in the chat.
- Wake word and assistant mode are off by default. Phone actions keep their per-action confirmation.

### To confirm before building
- [ ] sherpa-onnx custom-keyword support, model size and accuracy (allow `k2-fsa.github.io` in the network settings).
- [ ] whisper.rn on the test phone: Whisper tiny/base speed, and memory with a chat model loaded.
- [ ] Default digital assistant registration on a recent Android (which screens and permissions are needed).
- [ ] The battery cost of an always-on wake-word service over a day.

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
