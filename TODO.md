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
- [x] `read_url`: the default reader is now **the phone itself** (no r.jina.ai): it fetches the page directly, the final URL after redirects comes from the network layer (verified), and the HTML becomes plain text on the phone. Provider readers that can't attest the final URL fall back to it. Fail-closed checks unchanged (allowlist, no https→http downgrade).
- [ ] Phone check: search, then "read the first result"; a page that redirects; a PDF / non-HTML link (refused cleanly).
- [x] **Web search is free, no key:** the paid providers (Brave, Tavily, Exa, Firecrawl, Parallel — all need sign-ups now) are no longer offered; their adapters stay in the code, not selectable. The one search is **DuckDuckGo**, done by the phone from its plain HTML results page (not an official API: can change or rate-limit, and says so). Reading a page needs only the consent, no key.
- [ ] Phone check: consent, then "search the web for …" and "read the first result"; a few searches in a row (rate limit message).
- [ ] The consent text in non-English locales still mentions r.jina.ai and keys; English is updated.
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
- [ ] Phone check: make "morning" (alarm with `{{hour}}` + open an app) in Toolbox, turn it on, ask "run morning at 7"; ask a model to save a packing list as instructions, approve, turn it on, ask for it back; delete both.

### Share and scan tools by QR (planned, not started)

Toolbox → Custom tools gets **Share as QR** on each tool and a **Scan a tool** button. Uses the scheme from the user's QR2D page (`qr2d-v0_27.html`):

- [ ] Pack: the tool's JSON → deflate (pako) → base64, with a short tag and version in front (e.g. `PA1:`), so the app knows it's a PocketAgent tool and which format it is. Keep plain JSON when it is smaller.
- [ ] Size check: one standard QR holds about 2,331 characters (version 40, medium error correction); most tools fit. If a tool is too big, offer **Share as file** instead (no multi-QR for now).
- [ ] Draw the QR with `qrcode-generator` + `react-native-svg` (already in the app). Share the QR as a picture too.
- [ ] Scan with the camera (the existing vision-camera code scanner) or **from a picture** (jsQR on the image), so a QR in a screenshot or chat works.
- [ ] After scanning: run the same checks as `tool_save`, show the **full definition** (every step and fill-in), then install **switched off**. Name clash → rename or replace (asks).
- [ ] Never run anything from a scan; a QR is data only (instructions or a shortcut of built-in tools).
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
