# PocketAgent TODO and Future Roadmap

**Target: future phones and models.** The current test phone (Motorola Razr 2023) and small models (e.g. Qwen 3.5 2B) are a development stand-in; don't tune features or prompts for them.

Updated: 2026-11-03. This document tracks planned work. Items marked done are done in code (with tests) on the open PR stack (#3 → #4 → #5 → todo-batch); anything that still needs checking on the phone is listed under **Phone checks**.

## Roadmap (agreed 2026-11-08)

**No point in any of this without real security.** Every step keeps the rules in SECURITY.md (off until switched on; anything outside the app asks, natively, every time), and each new ability gets its rule test before it ships.

**1. Make what exists solid (now, confirmed)**
- [ ] Fix the 40 s Windows start (Start-up time card → settings storage read suspected).
- [ ] Home link on real devices: pair over the hotspot, then use it away from home on mobile data (relay).
- [ ] Keep the link alive in the background; start the PC's model when the phone asks.
- [ ] Clean installs and updates: a version per build (0.1.<build>), upgrades in place.

**2. One assistant on two devices (next)**
- [ ] **The PC asks, the phone can answer** (decided 2026-11-08): when the PC needs an "Allow?" (a file outside the workspace, a command, pairing…), the same question also appears on the paired phone, and either device can answer. Security:
  - Only a paired phone, over the encrypted home link; the PC shows its own dialog too, and the first answer wins.
  - The phone shows the PC's exact text (what, where, which file / command) and which PC is asking; no summary.
  - The PC still checks everything itself; the phone's answer is only yes/no for that one question (a one-time id, expires in 2 minutes; no answer = no).
  - Never "always allow" from the phone for dangerous kinds (run a command, delete, send).
  - Off until switched on, on both devices; every answer is logged on the PC with which device gave it.
- [ ] The phone uses the PC's tools (each still asks, on the PC or the phone as above); hand-off of tasks; chats and memory in step over the link.
- [ ] **Sync phone and PC** (user, 2026-11-08), over the home link only, off until switched on:
  - One **system prompt** for both: the global system prompt (and memory, which goes into it) is kept the same on phone and PC, so the model behaves the same whichever device you use. Edit on either, the other follows.
  - **Never two system prompts:** when the phone uses the PC's model (Home PC), only the phone's request carries the system prompt; the PC's link passes requests through untouched and adds nothing of its own (keep it that way; a test should pin it). Same the other way round.
  - Also kept in step (each its own switch): assistants (pals) and their prompts, custom tools / shortcuts, Toolbox switches (each device still asks for its own phone/PC actions), memory notes, loops / plans, chats (optional).
  - Conflicts: last edit wins per item, with the other version kept in history (memory already has snapshots); a changed system prompt shows "changed on your PC" once.
  - Model choice and per-device settings (model files, GPU, storage, permissions) stay per device.
- [ ] Desktop tools in the workspace folder only; voice; quick chat on a hotkey.

- [ ] **Ready-made loops** for people who don't write prompts (idea 2026-11-08): pick one, fill in the blanks, it runs on a timer and ends each run with next steps. See "Ready-made loops" below.

**3. It learns you (later)**
- [ ] Daily personal training (PC trains, phone learns, raw data deletable). Small models keep improving; style and habits first, exact facts stay in memory notes.

**4. Further, optional**
- [ ] More devices (laptop, second phone, an always-on home box); a family sharing one home model, each with their own space; errands across devices under the same rules.

**Not chasing:** cloud features or accounts; beating big cloud models on raw smarts; many platforms at once (Windows + Android first, then Linux).

**Before releasing to people: a full security audit**
- [ ] Our own full audit of both apps and the link (like the 2026-11-06 one, plus the desktop and the link): every door, every approval, every stored secret, every way in from outside (QR codes, links, model output, pages, paired devices).
- [ ] A public security policy (SECURITY.md: how to report a problem privately, what's in scope, response times) and a changelog of security fixes.
- [ ] Invite testers: early users run the test builds and try to break it; credit them. Fix before widening the release.
- [ ] Builds anyone can check: published checksums for every download (signing optional, our own key).

## Ready-made loops: timer + next steps, for beginners (idea 2026-11-08, write-up only)

A loop is a small agent job that comes back on a timer: it does its part, shows the result, and ends with **next steps** the user can tap. Ready-made ones in a gallery, so nobody has to know what an "agentic loop" is.

**The shape of every loop (user, 2026-11-08): Prompt → Research → Breakdown → Timers → Continue → Ask**
1. [ ] **Prompt:** the user says what they want in one sentence ("help me get fit before summer", "plan my move"); or picks a ready-made loop, which is this sentence filled in.
2. [ ] **Research:** the model gathers what it needs with the tools that are switched on (web, memory, workspace files; the PC's tools over the home link later), and shows what it found and where from.
3. [ ] **Breakdown:** it turns the goal into small, concrete steps with rough times, shown as a checklist the user can edit, reorder or delete before anything starts.
4. [ ] **Timers:** each step gets a when (a time, "every morning", "in 2 days", "after step 3"); the user sees the whole schedule and can change any of it. Limits (how often, end date, battery) are set here.
5. [ ] **Continue:** at each timer the loop picks up where it left off: does its part of the next step, updates the checklist, and adjusts the plan if something changed.
6. [ ] **Ask:** before anything that matters (an action outside the app, changing the plan, spending, sending, more time) it asks; and at each check-in it asks the user how it went, then shows the next steps as buttons. No answer = it waits, it never guesses ahead.
- [ ] One **"Make a loop"** button: type the sentence, the app runs steps 2–4 and shows the plan for approval; nothing runs before the user presses Start.

**Agentic planning: the plan is a program (user, 2026-11-08)**
- [ ] A plan is saved as structured steps, not chat text, and run by a fixed runner in the app, step by step, like a small program. It stays data, never code (rule 4): the runner only knows a short list of step kinds, and the model can't add new ones.
- [ ] Step kinds: **ask the model** (a prompt, with the results of earlier steps filled in), **use a tool** (built-in, behind its switch), **ask the user** (a question or a choice, as buttons), **wait** (a timer or a time), **check** (a simple condition on earlier results: done / not done, changed / not changed, a number above or below), **repeat** (a block, with a maximum count), **notify**, **save to memory or workspace** (asks first).
- [ ] Each step has: a name the user can read, inputs (from the user or earlier steps), what it produces, which tools it may use, a time limit, and what happens if it fails (retry once, skip, or stop and ask).
- [ ] The model writes the plan from the user's sentence (Prompt → Research → Breakdown → Timers); the user sees it as a readable checklist / flow, can edit any step, and starts it. The model can propose changes later, but only the user applies them (shown as a before/after).
- [ ] **Dry run** before starting: walks through the plan without doing anything outside the app, showing what each step would do and which questions it would ask.
- [ ] Every run keeps a trace: which step, when, what went in and out; resume after the phone or PC restarts exactly where it stopped; pause / step through / stop at any time.
- [ ] Versioned: each edit makes a new version; going back is one tap. Ready-made loops are just shipped plans; shared plans (QR / file) are reviewed and installed off, like tools.
- [ ] Runs where it fits: the phone for quick steps, the PC (home link) for long or heavy ones; a step can say "on the PC", and the PC's questions can be answered on the phone.

- [ ] **The user chooses how many steps** (user, 2026-11-08): a detail level when making the plan (Short ≈ 3 steps, Normal ≈ 5–7, Detailed ≈ 10–15, or an exact number), and a hard maximum per plan (default 20, settable). The model must fit the plan to it; asking for more steps later is a plan change the user approves.
- [ ] **Loop guards** (all on by default, shown on the plan's card, only the user can raise them):
  - Each **repeat** block has a maximum count; each plan a maximum number of steps run in total and a maximum run time.
  - A budget per run: model calls, tool calls, tokens; on the phone also battery (stop below a level, heavy work only on the charger).
  - **No-progress stop:** the same step with the same result twice in a row, or a check that never changes after N tries → pause and ask the user instead of looping.
  - **Runaway stop:** no plan can start another plan, schedule itself more often, or edit its own steps, tools or guards.
  - When a guard is hit: pause (never silently retry), show which guard and why, and offer: stop, continue once, or raise the limit (the user's choice, logged).
- [ ] **Still asks the user**, whatever the plan says: ask-the-user steps can't be skipped by the model; anything outside the app, any phone action, and anything dangerous (send, buy, delete, run a command) asks every time; no answer = the plan waits.

**How it looks to the user**
- [ ] A **Loops** gallery: each card says in one line what it does, how often, and what it may use. Pick one, fill in the blanks (topic, time, how long), press Start. No prompt writing.
- [ ] Before it starts, a plain summary: "Runs every day at 7:00 for 2 weeks. May use: weather, calendar, memory (read). Never sends, buys or deletes anything."
- [ ] Each run ends with a short result and 1–3 **next steps** as buttons ("Do step 2 now", "Remind me at 5", "Done, skip ahead"). Tapping one continues the loop; ignoring it is fine.
- [ ] A **Running loops** list: next run time, runs so far, Pause / Stop / Edit; a notification per run (can be turned off).

**Starter loops (examples)**
- [ ] Morning brief: weather, today's calendar, reminders from memory → three things to do first.
- [ ] Focus timer: 25 min work / 5 min break; at each break asks what got done and suggests the next small step.
- [ ] Goal planner: give a goal ("learn Spanish basics", "clean the garage"); it breaks it into steps and each day offers the next one, checking what's done.
- [ ] Evening review: what went well, what's left; tomorrow's first steps saved to memory (asks before saving).
- [ ] Watch a page: checks a web page every few hours and tells you only when it changes.
- [ ] Habit check-in: a daily question ("water? walk?"), a streak, and a gentle next step.
- [ ] Learn something: a short lesson a day on a topic, with a quiz question; the next lesson builds on the answers.
- [ ] With DesktopAgent (home link): a long job runs on the PC overnight (summarise a workspace folder, a long draft) and the phone gets the result and next steps in the morning.

**Rules (same as everything else; a loop is data, never code)**
- [ ] A loop is a ready-made custom tool with a timer: built-in tools only, each still behind its Toolbox switch; phone actions and anything outside the app still ask every time. Installed off; shown in full before starting.
- [ ] Hard limits on every loop: how often, how many runs, an end date, a time/battery budget per run (phone: only on the charger for heavy ones); stops by itself when reached.
- [ ] A loop can't start other loops, change its own tools or timer, or raise its limits; only the user can.
- [ ] Every run is logged (what it did, which tools); the log shows on the loop's card.
- [ ] Phone: runs through Android's job scheduler (may be a few minutes late; exact times only for alarms the user sets). Desktop: runs while DesktopAgent is open (tray later).
- [ ] Sharing loops: as a QR / file like tools (`PA1:L:` later), reviewed before install, installed off.

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
- [x] 2026-11-06: an Instructions tool "morning" ("Open Claude") works: "Run morning" read it, then open_app opened Claude (Gemini 3.1 Flash Lite; the first try it said it couldn't read the instructions).
- [x] Fixed: typing in the custom tool editor moved the cursor (backspace deleted the wrong letter). The dialog layer delivered the screen's copy of the text late; the boxes now keep their own text.
- [x] Done: clearer editor wording ("When should the model use it? e.g. when I say good morning"; "Tools never run on a timer; for an alarm use Shortcut with set_alarm") and a plainer description for the model.
- [ ] Phone check: make "morning" (alarm with `{{hour}}` + open an app) in Toolbox, turn it on, ask "run morning at 7"; ask a model to save a packing list as instructions, approve, turn it on, ask for it back; delete both.

### Share and scan by QR: tools and device pairing (planned, not started)

Toolbox → Custom tools gets **Share as QR** on each tool and a **Scan a tool** button. Uses the scheme from the user's QR2D page (`qr2d-v0_27.html`):

- [ ] **One QR scanner for everything** (decided 2026-11-06): a single **Scan QR** screen reads every PocketAgent QR, and the tag in front says what it is: `PA1:T:` a tool, `PA1:P:` a desktop pairing (address, public key, one-time code; see PocketAgent Desktop), later mods. Each kind goes to its own review screen; nothing is installed or paired without the user confirming. Unknown tags are refused.
- [ ] Scan QR is reached from Toolbox (tools) and from the server / desktop list (pairing); same screen, same camera and "from a picture" options.
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
- [x] Research (2026-11-07): during the wait Windows shows "Loading DesktopAgent…", so the window draws but the app's code makes no progress. Pretending to be Windows in Chromium (browser identity + platform) changed nothing (0.55 s), so it's WebView2 itself. No blocking requests in the shipped code. Lead: the app's saved settings are read through localStorage (the settings storage's web version), which freezes the page until the browser's storage answers; Chromium-based web views can take very long to start their storage on some PCs (compare Firefox's 48–51 s storage start-up bug 1899015). The card now times the first localStorage read and the first IndexedDB open.
- [x] Windows card (build 42437317929, 2026-11-08): settings read 0 s (not storage). One long task from 1.5 s to 39.9 s: the page busy without a break, ending exactly when React finished the first screen; the chat database's answer and the first draw wait behind it. Chromium here: same work 0.2 s; JIT off or the Phosphor look change nothing.
- [x] Ruled out on the PC (2026-11-08): `--disable-gpu` → still 38.8 s (so not the graphics process). Ruled out here: language / time zone (en-CA, Vancouver) and Windows identity → 0.5 s.
- [x] The card now adds up the time spent in each kind of browser call during start-up (style rules, layout, canvas, elements, storage, fonts…) and shows the top 5; here the top is style rules: 549 calls, 0.14 s.
- [ ] (old suspect, ruled out) Suspect: a synchronous wait for WebView2's graphics process during the first screen (the UI library measures text with a canvas). Test on the PC: start once with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu`. The card now also times canvas setup. If confirmed, fix in the app (e.g. a web view flag, or no canvas during start).

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
- [ ] Optional setting: a new pairing also needs OK from an already paired phone ("the PC asks, the phone answers").
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

A desktop app that pairs with the phone: trains the personal LoRA, runs bigger models (14B–30B) for the phone, and takes heavy jobs. **Platforms (decided 2026-11-07): Windows first; Linux not planned; no Apple at all (no Mac, no iPhone).** Open source, no Google, no account, no cloud.

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
