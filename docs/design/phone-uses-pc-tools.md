# Design: the phone uses the PC's tools

Status: **decided** (written 2026-11-15; owner decisions at the end). Stage 1 (read only) built 2026-11-15: tools `pc_info`, `workspace_list`, `workspace_read` (phone names `pc_info`, `pc_workspace_list`, `pc_workspace_read`); search, ranges and file info are not in stage 1. Stage 2 (actions that already ask) built 2026-11-15: `pc_open`, `pc_print`, `pc_media`, `pc_clipboard_read` (the same names on the phone and the PC) under the per-device "May act"; as decided in 1c, no self-answer check (the asking device may answer like any device that may answer). Stage 3 (commands) built 2026-11-15: `pc_run_command` under its own per-device "May run commands" (`may_command`), through the very same function as the PC's own `run_command`; output sent without the PC's paths. Stage 4 (writing in the workspace) built 2026-11-15: `workspace_write`, `workspace_append`, `workspace_undo` (phone names `pc_workspace_write`, `pc_workspace_append`, `pc_workspace_undo`) under their own per-device "May write" (`may_write`); text kinds that open in a viewer only, at most 256 KB, each change asked natively on the PC every time with a before/after view built there (never "always"; 1c applies), the previous version kept in the screens' own file history for undo. TODO.md items: "The phone uses the PC's tools", "Together with the phone (home link)".

## 1. The goal

In the owner's words (TODO.md): *"The phone uses the PC's tools (each still asks, on the PC or the phone as above)"* and *"each PC tool still asks on the PC, or on the phone with the PC's dialog mirrored; off by default."*

What the user sees, if built as recommended:

- On the PC, in the list of paired devices, each device gets new switches next to "May answer" and "Pictures": **"May read this PC"** and later **"May act on this PC"** and **"May run commands"**. All off. Turning one on asks in the PC's own dialog, which no device can answer.
- On the phone, the Toolbox gets a section **"On your PC"** with the PC's tools (PC info, read workspace files, open / print a file, media keys, clipboard, run a command). All off.
- In a chat on the phone: "What's in budget.xlsx on my PC?" The model calls the PC's file reader; the answer comes back into the phone's chat. For anything that asks on the PC today (a command, opening or printing a file, the clipboard), the PC shows its usual "Allow?" dialog, now naming the phone ("Pixel 8 asks: run this command …"), and, if "Show this PC's Allow? questions here" is on, the phone shows the same words with **Don't allow / Allow once**.

## 2. What exists today

- **The link** (`src-tauri/src/link.rs`): one JSON request line per stream. Requests: `pair`, `status`, `start`, `sync`, `questions`, `answer`, `picture`, `http`. Only paired keys get past `pair`. Per-device flags on the PC: `may_answer`, `may_picture` (off by default, switching on asks in `approval::ask_on_this_pc`, recorded in the pairing history).
- **Questions** (`remote_ask.rs`, `approval.rs`): every native "Allow?" on the PC can also be answered by a device that may answer. The PC's dialog stays up, first answer wins, a device's yes is always "once", every device answer is logged in `answers.log` and announced by a notification.
- **Pictures** are the model for this work: a phone tool (`PcPictureEngine.ts`) sends one link request; the PC runs exactly the same checked code as its own tool (`image_gen::make`), with a global switch plus a per-device flag; the result comes back capped.
- **PC tools** (`pc.rs`, `pc_extra.rs`, JS `DesktopToolsEngine.ts`): `pc_info` (read only, no question), `run_command` (native dialog every time, never "always"), `open_file`, `print_file`, `media_control`, `clipboard_read` (each asks natively), `image_generate`. Workspace file tools (`FileToolsEngine.ts`) work in the app's own folder: reads need no question; writes ask in the app's own (JS) approval sheet, not a native dialog.
- **Where the model runs today when the phone uses the PC:** the chat loop (`AgentRunner.ts`) runs on the **phone**. The PC only answers model requests through the tunnel. Tool calls are made on the phone, with the phone's Toolbox switches.

## 3. Options

### Option A: phone keeps the chat loop, each PC tool is one link request ("remote tools")

**How it works.** A new link request `tool {name, args}`. The phone registers PC tools under their own names (`pc_file_read`, `pc_run_command`, …) so they can never be confused with phone tools in the allowed list. When the model calls one, the phone sends one `tool` request; the PC checks it and calls the **same native function** its own tool uses (`pc::run_command`, `pc_extra::print_file`, …). That function shows its native dialog as today, which is mirrored to devices that may answer. The answer comes back as one JSON line plus capped text.

**Where it is approved.** Always on the PC, natively, because that is where it happens ("Broad access, never automatic"). The phone may answer the mirrored question exactly as today ("The PC asks, the phone can answer"). The question text names the asking device.

**Code changes.**
- `link.rs`: `Request::Tool`, a fixed list `REMOTE_TOOLS` (name → group), checks in order: PC's global switch "Let paired devices use this PC's tools" → the device's group flag → name on the list → arguments built from named fields only (rule 4; file names through the workspace name check, never a path). New flags on `Phone`: `may_read`, `may_act`, `may_command` (serde default off, asked with `ask_on_this_pc`, recorded in history).
- `pc.rs` / `pc_extra.rs`: each function takes an optional "asked by <device>" so the dialog says who asked. No new door: the same function, the same caps.
- New `pc_files.rs` (or a link-side wrapper): read-only workspace access (list, read, search, read range, info; documents through `docs.rs`) by file name only.
- `native/homelink`: `tool()` call; `link_client.rs`: `homelink_tool` for a second PC.
- Phone: `PcToolsEngine.ts` (like `PcPictureEngine.ts`), registered in the talent registry, off in Toolbox; results wrapped with `wrapUntrusted` (command output and documents can carry instructions).

**What can go wrong.**
- A stolen, unlocked phone with "May run commands" and "may answer" both on can ask for a command **and** allow it from the same phone. That is a full door into the PC. (See the mitigation in the recommendation: the asking device can't answer its own request without unlocking the phone again, or can't answer it at all.)
- Prompt injection: a web page the phone's model read says "run `curl … | sh` on the PC". The PC still shows the whole command and asks, but tired users click Allow.
- The PC's dialog stays open after the phone answered (known limit today); someone at the PC may be confused by a dialog for a request they didn't make. The dialog says which device asked.
- Many small requests (one per tool call) over a relay are slower; fine for tools, which are rare.

### Option B: the PC runs the whole task ("hand-off")

**How it works.** A new link request `task {chat id, message}`. The PC's screens run the chat loop (`AgentRunner.ts` on the PC) with the PC's model and the **PC's own Toolbox switches**; the phone shows progress and the answer, like a mirrored chat. Questions are asked on the PC and can be answered on the phone as today.

**Where it is approved.** On the PC, as for the PC user's own chats.

**Code changes.** Larger: a PC-side runner started by a link event (like `link-sync` → `hostSync.web.ts`), streaming steps back, a chat that belongs to the device, stopping it from the phone, and what happens when the PC's screens are closed. Overlaps with the "Hand off" TODO.

**What can go wrong.**
- The phone's typed message becomes a PC chat that can use every tool switched on **on the PC**, not only those the user chose for the phone. A stolen phone gets the PC's whole Toolbox (each still asking).
- Needs the PC's window running; nothing happens when only the tray is up.
- Results stay on the PC except the final text: good for privacy, harder to follow on the phone.

### Option C: no model, buttons only ("do less")

The phone gets a plain screen "Your PC": PC info, the workspace file list, open a file's text. No model calls the PC's tools. Small and safe, but it is not what the TODO asks for. Useful as a first step only if A is postponed.

### Threat model

| Who | Option A (remote tools) | Option B (hand-off) | Option C (buttons) |
|---|---|---|---|
| **Stolen phone** (unlocked, app open) | Can read the PC workspace if "May read" is on; can ask for actions, which ask on the PC. If it may also answer, it could allow its own request: needs the extra unlock check (below). Fix: "Remove" on the PC cuts it off at once. | Same, but with the PC's whole Toolbox. | Can read the workspace list and text only. |
| **Malicious paired device** (a device you paired, now bad) | Same as stolen phone, plus it can send requests the app's screens never would. The PC checks everything itself (allowed names, named fields, workspace names only, caps), so the device gets no more than the flags say. | It can type anything into a PC chat. | Read only. |
| **Compromised PC** (malware as the user) | It already has everything on the PC. New risk to the phone: tool results are untrusted text and could try to steer the phone's model. Wrapped as untrusted; phone actions still ask on the phone every time, so it can't make the phone call or send anything by itself. | Same; the PC writes the answer. | Shows fake text. |
| **Relay / ISP observer** | Sees that the devices talk, when and how much (more small bursts than chat). Can't read or change anything (QUIC + TLS 1.3, pinned keys). | Same. | Same. |
| **Prompt injection** (a web page, a document, synced memory) | Can make the model *ask* for a PC tool. Each tool with an effect asks natively on the PC, with the exact command or file; reads of the workspace don't ask (see open question 2). Tool output is wrapped as untrusted. | Same, on the PC. | None (no model). |

### How each owner rule holds

- **"Broad access, never automatic"** (every access outside the app folder asks in a native dialog on the device where it happens): A: yes, the PC's own native dialog is shown for every action it asks about today; remote file access is workspace only (the app folder), by file name, never a path, so nothing outside the app folder is reachable without a native dialog. B: yes, the PC's normal rules. C: workspace only.
- **"No point in any of this without real security"**: every new door is off on both sides, needs a per-device flag that only the PC's own dialog can turn on, and gets its rule test before it ships.
- **"Phone actions always ask"**: unchanged. Nothing here lets the PC start a phone action. In A the chat loop stays on the phone, so phone tools stay under the phone's rules; in B the PC's loop gets no phone tools at all.
- **No Google, no Apple**: nothing new outside the home link. The phone's unlock check uses Android's own `KeyguardManager` (part of Android, no Play Services, no new library, no new permission).

## 4. Recommendation: Option A, in small stages

Why A: it reuses what works (the picture request, the PC's native dialogs, "the PC asks, the phone can answer"), keeps the phone's Toolbox in charge of what the model may call, and each PC tool keeps exactly its own checks. B can come later as the "Hand off" item.

The one new rule A needs: **a device can't approve its own request by default.** A question that came from device X's `tool` request is marked with X; X may answer it only after the phone confirms the user (Android's screen-lock check, `KeyguardManager.createConfirmDeviceCredentialIntent`), or not at all (open question 1). Other devices that may answer are unaffected.

| Stage | What | Tests / pins (securityRules.test.ts and Rust tests) | Effort |
|---|---|---|---|
| **1. Read only** | `tool` request with `pc_info` and workspace reads (`pc_file_list`, `pc_file_read`, `pc_file_search`, `pc_file_read_range`, `pc_file_info`; documents as text). PC switch + `may_read` per device. Each remote read shows a PC notification ("Pixel 8 read budget.xlsx") and is logged. Phone: "On your PC" tools in Toolbox, off; results wrapped untrusted. | Request list now includes `Tool`; `Tool` checks switch → flag → `REMOTE_TOOLS` in that order; `may_read` serde default off, set only after `ask_on_this_pc`; arguments are names that pass the workspace name check (a path or `..` is refused, Rust test); answers capped (32 KB text); phone's PC tools have their own `pc_` names and are off by default; their results go through `wrapUntrusted`. SECURITY.md rule 6 + rule 7 table updated. | ~1 week |
| **2. Actions that already ask** | `pc_open_file`, `pc_print_file`, `pc_media_control`, `pc_clipboard_read` with `may_act`. They call the same functions, whose native dialog now names the device. Self-answer rule above. | The remote path calls the very same function (no copy); the dialog text contains the device name; a question opened for device X can't be answered by X without its unlock proof (Rust test on `remote_ask`); answer still "once" only. | ~1 week |
| **3. Commands** | `pc_run_command` with its own flag `may_command` and its own PC dialog to turn it on ("This lets <device> ask to run any command on this PC; each one still asks"). Same 60 s, 20 lines, invisible-character refusal. | `may_command` separate from `may_act`; same `check_command`; never "always"; self-answer rule holds; turning it on is recorded in history. | ~1 week |
| **4. Writing in the PC's workspace** (later) | `pc_file_create` / `pc_file_edit`: today writes ask in the PC's JS sheet, which a phone can't answer. For remote writes, ask in a **native** dialog on the PC showing the name and the change (mirrored like any question). Snapshot kept in file history. | Remote writes ask natively; never outside the workspace; size caps as for local writes. | ~1–2 weeks |
| **Later** | Option B ("Hand off") as its own design. | — | 3–4 weeks |

Also in stage 1: **turning everything off at once.** The PC's global switch is kept where the screens can't write it (like the pictures switch); switching it off, or "Remove" on a device, cuts that device's open requests at once.

## 5. Open questions for the owner

1. When the phone asked for a PC action, may the **same phone** allow it? (a) No, only the PC or another device; (b) yes, after the phone's screen-lock check (recommended); (c) yes, as today.
2. Reading the PC's **workspace** from the phone (app folder, so no dialog by the rules): (a) no question, a notification on the PC each time (recommended); (b) ask on the PC once per chat; (c) ask every time.
3. Should **run_command** from a device exist at all? (a) yes, stage 3 as above; (b) not before the security audit; (c) never.
4. The PC's global switch for device tools after a PC restart: (a) stays as it was (like pictures; recommended); (b) off after every restart until turned on again by hand (stricter, more clicks).
5. Is Option B ("Hand off") wanted later, knowing the phone then gets the PC's whole Toolbox? (a) yes, later; (b) no.

## Decided (owner, 2026-11-15)

Option A (remote tools). 1c: the phone that asked may also allow it, as today. 2b: reading the PC workspace asks once per chat. 3a: `run_command` from a device in stage 3, behind its own permission. 4a: the switch keeps its state after a PC restart. 5a: hand-off of whole tasks wanted later.
