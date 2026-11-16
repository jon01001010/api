//! Home link: use the model running on this PC from your phone, from
//! anywhere (SECURITY.md rule 6). Off until the user switches it on.
//!
//! Devices dial each other by public key (iroh). Connections are encrypted
//! end to end between the PC and the phone; when no direct path can be found
//! (home routers, mobile networks), a relay passes the encrypted bytes on but
//! can't read them.
//!
//! - Pairing: the PC shows a QR code with its public key and a one-time
//!   code (10 minutes, 3 wrong tries). The phone connects and sends the code; the
//!   PC then asks the user in a native dialog. Only after "Pair" is the
//!   phone's key saved.
//! - After pairing, only saved phones are let in, and they can do exactly
//!   four things (the fourth, "sync", only while the user allows it here:
//!   the system prompt and memory kept in step, merged by the screens): ask whether a model is running ("status"), start the
//!   model this PC last ran ("start": never a file the phone names, and
//!   never one that would need an "Allow?" on the PC), and pass HTTP
//!   requests to this PC's own model server on 127.0.0.1 ("http"). Nothing
//!   else on the PC is reachable: no files, no tools, no other ports.
//!   Two more, each only while allowed on this PC for that device: answer
//!   this PC's questions ("questions" / "answer", remote_ask.rs) and ask
//!   for a picture ("picture": made here by image_gen.rs with this PC's own
//!   picture model, the same caps and word check; the PNG comes back).
//!   And this PC's read-only tools ("tool": pc_info, the workspace's file
//!   list and a workspace file's text, pc_files.rs), only while the user
//!   allows device tools here and this device may read; reading the
//!   workspace asks on this PC once per chat (see Request::Tool). And,
//!   only while this device may act, four of this PC's tools that already
//!   ask (open or print a workspace file, a media key, the clipboard's
//!   text): the very same functions as this PC's own, each asking here
//!   natively every time, naming the device. And, only while this device
//!   may run commands (its own flag, separate from "may act"), a command
//!   (pc_run_command): the very same function as this PC's own
//!   run_command (the same checks, the whole command in the native
//!   "Allow?" every time, never "always", the workspace folder, 60 s, the
//!   output capped), its output sent back without this PC's paths.
//! - The PC's link key and the paired phones are kept where the screens
//!   can't write: Windows Credential Manager, or on Linux a private file in
//!   the app's settings folder (see read_entry).
//! - Removal notices (device circle stage 2, homelink::circle): removing a
//!   device here ("Remove here") signs a notice with this PC's key; paired
//!   devices get it with their status ("removals"), and a device hands its
//!   own to this PC ("removal"). A good notice from a device this PC trusts
//!   removes that key here too, exactly as "Remove here" does, and the user
//!   is told; it can only remove, never add a device or switch a right on.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Each connection must name this protocol, or it is refused in the handshake.
pub const ALPN: &[u8] = b"pocketagent/home-link/1";
/// What the QR code starts with.
pub const QR_PREFIX: &str = "PA1:P:";
const KEY_ENTRY: &str = "DesktopAgent-link:key";
const PHONES_ENTRY: &str = "DesktopAgent-link:phones";
const EVENTS_ENTRY: &str = "DesktopAgent-link:events";
/// The circle's state (homelink::circle::State): numbers seen, notices to
/// pass on, the Home PCs this PC uses. In parts: a credential holds at most
/// 1280 UTF-16 characters (CIRCLE_PART_UNITS each, CIRCLE_PARTS at most).
const CIRCLE_ENTRY: &str = "DesktopAgent-link:circle";
const CIRCLE_PARTS: usize = 12;
const CIRCLE_PART_UNITS: usize = 1000;
/// The PC's switch "Let paired devices make pictures on this PC" ("on").
const PICTURES_ENTRY: &str = "DesktopAgent-link:pictures";
/// Largest picture sent back to a device (a 1024 x 1024 PNG is 1-3 MB).
pub const MAX_PICTURE: usize = 8 * 1024 * 1024;
/// The PC's switch "Let paired devices use this PC's tools" ("on"); kept
/// across restarts like the pictures switch.
const TOOLS_ENTRY: &str = "DesktopAgent-link:tools";
/// The only tools a device may ask for (stage 1: read only, under "may
/// read"; stage 2: ACT_TOOLS, under "may act"; stage 3: COMMAND_TOOLS,
/// under "may run commands"; stage 4: WRITE_TOOLS, under "may write").
pub const REMOTE_TOOLS: &[&str] = &[
    "pc_info",
    "workspace_list",
    "workspace_read",
    "pc_open",
    "pc_print",
    "pc_media",
    "pc_clipboard_read",
    "pc_run_command",
    "workspace_write",
    "workspace_append",
    "workspace_undo",
];
/// The tools on REMOTE_TOOLS that act on this PC (stage 2): each is one of
/// this PC's own tools that already asks natively, and asks every time.
pub const ACT_TOOLS: &[&str] = &["pc_open", "pc_print", "pc_media", "pc_clipboard_read"];
/// The tool on REMOTE_TOOLS that runs a command (stage 3): this PC's own
/// run_command, which shows the whole command and asks every time.
pub const COMMAND_TOOLS: &[&str] = &["pc_run_command"];
/// The tools on REMOTE_TOOLS that write in the workspace (stage 4): make or
/// replace a text file, add at its end, undo the last change; each shows a
/// before/after view and asks here every time (pc_write.rs).
pub const WRITE_TOOLS: &[&str] = &["workspace_write", "workspace_append", "workspace_undo"];
/// How long a device has to send the text it writes (after the request).
const WRITE_BODY_TIME: Duration = Duration::from_secs(30);
/// Largest tool answer sent (a file's text is at most 256 KB, escaped).
pub const MAX_TOOL_ANSWER: usize = 2 * 1024 * 1024;
/// How long "read the workspace for this chat" stays allowed.
const READ_GRANT_TIME: Duration = Duration::from_secs(12 * 60 * 60);
/// Most chats remembered as allowed at once (the oldest go first).
const MAX_READ_GRANTS: usize = 200;
/// Most chats of one device allowed to read at once: the chat id is the
/// device's own choice, so a new one replaces that device's oldest
/// (security review 2, finding 6; the PC's notification shows the count).
pub const MAX_CHAT_GRANTS_PER_DEVICE: usize = 3;
/// Pairing history kept (paired phones see it, so they notice new codes).
const MAX_EVENTS: usize = 30;
const PAIR_CODE_LIFETIME: Duration = Duration::from_secs(10 * 60);
/// Wrong tries a pairing code survives (from any devices, all together);
/// the next wrong one uses it up. A device id is a fresh key anyone can
/// make, so one wrong try must not burn the code (security review 2).
const PAIR_CODE_WRONG_TRIES: u32 = 3;
/// The credential store holds about 2.5 KB per entry: a few phones.
const MAX_PHONES: usize = 8;
const MAX_REQUEST_LINE: usize = 4096;
/// A device must send its request line this quickly (no slow-loris).
const FIRST_LINE_TIME: Duration = Duration::from_secs(10);
/// A device removed this recently can't ask to pair again (so it can't
/// burn every new pairing code).
const REMOVED_LOCKOUT: Duration = Duration::from_secs(60 * 60);

// ---------------------------------------------------------------- pure parts

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Phone {
    pub id: String,
    pub name: String,
    /// May answer this PC's "Allow?" questions (while the PC's switch is
    /// on too). Off for each device until switched on here, which asks on
    /// this PC; records saved before this existed have none: off.
    #[serde(default, rename = "mayAnswer", skip_serializing_if = "std::ops::Not::not")]
    pub may_answer: bool,
    /// May ask this PC for pictures (while the PC's switch is on too). Off
    /// for each device until switched on here, which asks on this PC.
    #[serde(default, rename = "mayPicture", skip_serializing_if = "std::ops::Not::not")]
    pub may_picture: bool,
    /// May use this PC's read-only tools (PC info, the workspace's files;
    /// while the PC's tools switch is on too). Off for each device until
    /// switched on here, which asks on this PC.
    #[serde(default, rename = "mayRead", skip_serializing_if = "std::ops::Not::not")]
    pub may_read: bool,
    /// May ask this PC to act (ACT_TOOLS: open or print a workspace file,
    /// a media key, the clipboard; each asks here every time; while the
    /// PC's tools switch is on too). Off for each device until switched on
    /// here, which asks on this PC.
    #[serde(default, rename = "mayAct", skip_serializing_if = "std::ops::Not::not")]
    pub may_act: bool,
    /// May ask this PC to run commands (COMMAND_TOOLS; each shown whole and
    /// asked here every time; while the PC's tools switch is on too). Its
    /// own flag, separate from "may act": a command can do anything the
    /// user can. Off for each device until switched on here, which asks on
    /// this PC.
    #[serde(default, rename = "mayCommand", skip_serializing_if = "std::ops::Not::not")]
    pub may_command: bool,
    /// May ask this PC to write in its workspace (WRITE_TOOLS: text files
    /// only, each change shown before and after and asked here every time;
    /// while the PC's tools switch is on too). Its own flag, separate from
    /// the others. Off for each device until switched on here, which asks
    /// on this PC.
    #[serde(default, rename = "mayWrite", skip_serializing_if = "std::ops::Not::not")]
    pub may_write: bool,
    /// When it was paired (seconds since 1970, this PC's clock), for "Your
    /// devices". Records saved before this existed have none.
    #[serde(default, rename = "pairedAt", skip_serializing_if = "Option::is_none")]
    pub paired_at: Option<u64>,
}

impl Phone {
    /// A newly paired device: the model only, every other right off until
    /// switched on here (each asked on this PC).
    pub fn new(id: String, name: String, paired_at: u64) -> Self {
        Phone {
            id,
            name,
            may_answer: false,
            may_picture: false,
            may_read: false,
            may_act: false,
            may_command: false,
            may_write: false,
            paired_at: Some(paired_at),
        }
    }
}

/// Whether this paired device may ask this PC to write in its workspace.
pub fn may_write(phones: &[Phone], id: &str) -> bool {
    phones.iter().any(|p| p.id == id && p.may_write)
}

/// Sets one device's "may write"; false if it isn't paired.
pub fn set_may_write(phones: &mut [Phone], id: &str, allowed: bool) -> bool {
    match phones.iter_mut().find(|p| p.id == id) {
        Some(p) => {
            p.may_write = allowed;
            true
        }
        None => false,
    }
}

/// Whether this paired device may ask this PC to run commands.
pub fn may_command(phones: &[Phone], id: &str) -> bool {
    phones.iter().any(|p| p.id == id && p.may_command)
}

/// Sets one device's "may run commands"; false if it isn't paired.
pub fn set_may_command(phones: &mut [Phone], id: &str, allowed: bool) -> bool {
    match phones.iter_mut().find(|p| p.id == id) {
        Some(p) => {
            p.may_command = allowed;
            true
        }
        None => false,
    }
}

/// Whether this paired device may ask this PC to act (ACT_TOOLS).
pub fn may_act(phones: &[Phone], id: &str) -> bool {
    phones.iter().any(|p| p.id == id && p.may_act)
}

/// Sets one device's "may act"; false if it isn't paired.
pub fn set_may_act(phones: &mut [Phone], id: &str, allowed: bool) -> bool {
    match phones.iter_mut().find(|p| p.id == id) {
        Some(p) => {
            p.may_act = allowed;
            true
        }
        None => false,
    }
}

/// Whether this paired device may use this PC's read-only tools.
pub fn may_read(phones: &[Phone], id: &str) -> bool {
    phones.iter().any(|p| p.id == id && p.may_read)
}

/// Sets one device's "may read"; false if it isn't paired.
pub fn set_may_read(phones: &mut [Phone], id: &str, allowed: bool) -> bool {
    match phones.iter_mut().find(|p| p.id == id) {
        Some(p) => {
            p.may_read = allowed;
            true
        }
        None => false,
    }
}

/// Whether this paired device may ask this PC for pictures.
pub fn may_picture(phones: &[Phone], id: &str) -> bool {
    phones.iter().any(|p| p.id == id && p.may_picture)
}

/// Sets one device's "may make pictures"; false if it isn't paired.
pub fn set_may_picture(phones: &mut [Phone], id: &str, allowed: bool) -> bool {
    match phones.iter_mut().find(|p| p.id == id) {
        Some(p) => {
            p.may_picture = allowed;
            true
        }
        None => false,
    }
}

/// Whether this paired device may answer this PC's questions.
pub fn may_answer(phones: &[Phone], id: &str) -> bool {
    phones.iter().any(|p| p.id == id && p.may_answer)
}

/// Sets one device's "may answer"; false if it isn't paired.
pub fn set_may_answer(phones: &mut [Phone], id: &str, allowed: bool) -> bool {
    match phones.iter_mut().find(|p| p.id == id) {
        Some(p) => {
            p.may_answer = allowed;
            true
        }
        None => false,
    }
}

/// What a phone asks for on each new stream (one JSON line).
#[derive(Debug, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Request {
    Pair { code: String, name: String },
    Status,
    /// Start the model this PC last ran (takes nothing from the phone).
    Start,
    /// Keep the system prompt and memory in step (the items follow the
    /// request line; only while the user allows it on this PC).
    Sync,
    /// The "Allow?" questions waiting on this PC (only while the user lets
    /// devices answer them; remote_ask.rs).
    Questions,
    /// A device's yes or no to one of them.
    Answer { id: u64, yes: bool },
    /// A picture made on this PC (only while the user allows it here, for
    /// this device). Never a model or a path: the PC uses its own first
    /// downloaded picture model; sizes and steps are capped as for its own
    /// tool (image_gen::check_request).
    Picture {
        prompt: String,
        #[serde(default)]
        width: Option<u32>,
        #[serde(default)]
        height: Option<u32>,
        #[serde(default)]
        steps: Option<u32>,
    },
    /// One of this PC's tools (only while the user allows device tools
    /// here, for this device: "may read" for the read-only ones, "may act"
    /// for ACT_TOOLS, "may run commands" for COMMAND_TOOLS, "may write" for
    /// WRITE_TOOLS; only names on REMOTE_TOOLS). `chat`: the device's own
    /// random id for the chat asking, so reading the workspace is asked
    /// here once per chat (an action, a command or a change asks every
    /// time). Arguments are named fields only (anything else is ignored); a
    /// file is a workspace name, never a path (pc_files::check_name); a key
    /// one of the media keys; a command passes pc::check_command; the text
    /// a device writes follows the request line, exactly `bytes` of it (at
    /// most pc_write::MAX_WRITE), read only once all the checks passed.
    Tool {
        name: String,
        chat: String,
        #[serde(default)]
        args: ToolArgs,
    },
    /// Removal notices a device hands on (device circle stage 2): each is
    /// checked here (homelink::circle::check_removal) and can only remove.
    Removal {
        notices: Vec<homelink::circle::Removal>,
    },
    Http,
}

pub fn parse_request(line: &[u8]) -> Option<Request> {
    if line.len() > MAX_REQUEST_LINE {
        return None;
    }
    serde_json::from_slice(line).ok()
}

/// The only arguments a device's tool request carries.
#[derive(Debug, Default, PartialEq, Deserialize)]
pub struct ToolArgs {
    /// workspace_read, pc_open, pc_print: the file's name in the workspace.
    #[serde(default)]
    pub file: Option<String>,
    /// pc_media: one of the media keys (pc_extra::media_vk).
    #[serde(default)]
    pub key: Option<String>,
    /// pc_run_command: the command (pc::check_command).
    #[serde(default)]
    pub command: Option<String>,
    /// workspace_write, workspace_append: how many bytes of text follow
    /// the request line (at most pc_write::MAX_WRITE).
    #[serde(default)]
    pub bytes: Option<u64>,
    /// The device's model's thinking from just before the request: shown
    /// in this PC's question under approval::MODEL_THINKING and kept in
    /// the answers log (approval::ask_for), never parsed or acted on.
    #[serde(default)]
    pub thinking: Option<String>,
}

/// A device's tool request, checked.
#[derive(Debug, PartialEq)]
pub enum RemoteCall {
    PcInfo,
    WorkspaceList,
    WorkspaceRead(String),
    Open(String),
    Print(String),
    Media(String),
    ClipboardRead,
    Command(String),
    /// A change to a workspace file; `bytes` of text follow (none to undo).
    Write { file: String, kind: crate::pc_write::WriteKind, bytes: usize },
}

/// What a device may do with this PC's tools (its own flags).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct DeviceMay {
    pub read: bool,
    pub act: bool,
    pub command: bool,
    pub write: bool,
}

const OFF_TOOLS: &str = "Using this PC's tools from paired devices is off on the PC (Settings → Use this PC's model from your phone → Let paired devices use this PC's tools)";
const NOT_THIS_DEVICE_TOOLS: &str = "This device may not use this PC's tools; allow it on the PC (Settings → Use this PC's model from your phone → Paired phones → May read)";
const NOT_THIS_DEVICE_ACT: &str = "This device may not ask this PC to open, print, press media keys or read the clipboard; allow it on the PC (Settings → Use this PC's model from your phone → Paired phones → May act)";
const NOT_THIS_DEVICE_COMMAND: &str = "This device may not ask this PC to run commands; allow it on the PC (Settings → Use this PC's model from your phone → Paired phones → May run commands)";
const NOT_THIS_DEVICE_WRITE: &str = "This device may not ask this PC to write in its workspace; allow it on the PC (Settings → Use this PC's model from your phone → Paired phones → May write)";
const NOT_A_REMOTE_TOOL: &str = "The PC offers only pc_info, workspace_list, workspace_read, pc_open, pc_print, pc_media, pc_clipboard_read, pc_run_command, workspace_write, workspace_append and workspace_undo to paired devices";

/// A chat id from a device: random, opaque, 16-64 letters, digits, `-`, `_`.
pub fn check_chat(chat: &str) -> Result<&str, String> {
    if (16..=64).contains(&chat.len()) && chat.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        Ok(chat)
    } else {
        Err("The request has no valid chat id".into())
    }
}

/// Checks a device's tool request, in this order: the PC's switch, this
/// device's flag for that tool ("may write" for WRITE_TOOLS, "may run
/// commands" for COMMAND_TOOLS, "may act" for ACT_TOOLS, "may read" for the
/// others; for a name on no list, any flag), the tool on REMOTE_TOOLS, then
/// its arguments. (Only paired devices get here at all.)
pub fn check_tool(tools_on: bool, may: DeviceMay, name: &str, chat: &str, args: &ToolArgs) -> Result<RemoteCall, String> {
    if !tools_on {
        return Err(OFF_TOOLS.into());
    }
    let writes = WRITE_TOOLS.contains(&name);
    let commands = COMMAND_TOOLS.contains(&name);
    let acts = ACT_TOOLS.contains(&name);
    let device_may = if writes {
        may.write
    } else if commands {
        may.command
    } else if acts {
        may.act
    } else if REMOTE_TOOLS.contains(&name) {
        may.read
    } else {
        may.read || may.act || may.command || may.write
    };
    if !device_may {
        return Err(if writes {
            NOT_THIS_DEVICE_WRITE
        } else if commands {
            NOT_THIS_DEVICE_COMMAND
        } else if acts {
            NOT_THIS_DEVICE_ACT
        } else {
            NOT_THIS_DEVICE_TOOLS
        }
        .into());
    }
    if !REMOTE_TOOLS.contains(&name) {
        return Err(NOT_A_REMOTE_TOOL.into());
    }
    check_chat(chat)?;
    let file = || -> Result<String, String> {
        let file = args.file.as_deref().ok_or("Give the file's name in the PC's workspace")?;
        Ok(crate::pc_files::check_name(file)?.to_string())
    };
    match name {
        "pc_info" => Ok(RemoteCall::PcInfo),
        "workspace_list" => Ok(RemoteCall::WorkspaceList),
        "workspace_read" => Ok(RemoteCall::WorkspaceRead(file()?)),
        "pc_open" => Ok(RemoteCall::Open(file()?)),
        "pc_print" => Ok(RemoteCall::Print(file()?)),
        "pc_media" => {
            let key = args.key.as_deref().unwrap_or("");
            if crate::pc_extra::media_vk(key).is_none() {
                return Err("Give one media key: play_pause, next, previous, stop, volume_up, volume_down or mute".into());
            }
            Ok(RemoteCall::Media(key.to_string()))
        }
        "pc_clipboard_read" => Ok(RemoteCall::ClipboardRead),
        "pc_run_command" => {
            let command = args.command.as_deref().ok_or("Give the command to run on the PC")?;
            Ok(RemoteCall::Command(crate::pc::check_command(command)?))
        }
        "workspace_write" | "workspace_append" | "workspace_undo" => {
            use crate::pc_write::WriteKind;
            let file = file()?;
            if !crate::pc_write::writable(&file) {
                return Err(crate::pc_write::WRITE_KINDS.into());
            }
            let kind = match name {
                "workspace_write" => WriteKind::Write,
                "workspace_append" => WriteKind::Append,
                _ => WriteKind::Undo,
            };
            let bytes = match (kind, args.bytes) {
                (WriteKind::Undo, None) => 0,
                (WriteKind::Undo, Some(_)) => return Err("Undo takes no text".into()),
                (_, None) => return Err("Give the text to write".into()),
                (WriteKind::Append, Some(0)) => return Err("Give the text to add".into()),
                (_, Some(n)) if n > crate::pc_write::MAX_WRITE as u64 => {
                    return Err(format!("The text is too large (at most {} KB)", crate::pc_write::MAX_WRITE / 1024));
                }
                (_, Some(n)) => n as usize,
            };
            Ok(RemoteCall::Write { file, kind, bytes })
        }
        _ => Err(NOT_A_REMOTE_TOOL.into()),
    }
}

/// Chats allowed to read the workspace, by (device, chat id), and when.
#[derive(Default)]
pub struct ReadGrants {
    map: std::collections::HashMap<(String, String), Instant>,
}

impl ReadGrants {
    /// Allowed for this chat of this device within READ_GRANT_TIME.
    pub fn has(&mut self, device: &str, chat: &str, now: Instant) -> bool {
        self.map.retain(|_, at| now.saturating_duration_since(*at) < READ_GRANT_TIME);
        self.map.contains_key(&(device.to_string(), chat.to_string()))
    }

    pub fn add(&mut self, device: &str, chat: &str, now: Instant) {
        self.map.insert((device.to_string(), chat.to_string()), now);
        // At most MAX_CHAT_GRANTS_PER_DEVICE per device: its oldest goes.
        loop {
            let mine: Vec<_> = self.map.iter().filter(|((d, _), _)| d == device).map(|(k, at)| (k.clone(), *at)).collect();
            if mine.len() <= MAX_CHAT_GRANTS_PER_DEVICE {
                break;
            }
            if let Some((k, _)) = mine.into_iter().min_by_key(|(_, at)| *at) {
                self.map.remove(&k);
            }
        }
        while self.map.len() > MAX_READ_GRANTS {
            let oldest = self.map.iter().min_by_key(|(_, at)| **at).map(|(k, _)| k.clone());
            match oldest {
                Some(k) => self.map.remove(&k),
                None => break,
            };
        }
    }

    /// How many of this device's chats may read now.
    pub fn count(&mut self, device: &str, now: Instant) -> usize {
        self.map.retain(|_, at| now.saturating_duration_since(*at) < READ_GRANT_TIME);
        self.map.keys().filter(|(d, _)| d == device).count()
    }

    /// Forgets one device's chats (removed, or may no longer read).
    pub fn forget_device(&mut self, device: &str) {
        self.map.retain(|(d, _), _| d != device);
    }

    pub fn clear(&mut self) {
        self.map.clear();
    }
}

/// An error as a device may see it: this PC's own folders (`known`: a
/// folder and the placeholder said instead) replaced, longest first, and
/// any other absolute path left (a drive path, a UNC path, a home folder)
/// shown as `<path>`. sd-cli's last lines and file errors name the user's
/// home and model folders (security review 2).
pub fn without_paths(text: &str, known: &[(String, &str)]) -> String {
    let mut out = text.to_string();
    let mut known: Vec<&(String, &str)> = known.iter().filter(|(dir, _)| dir.len() >= 3).collect();
    known.sort_by_key(|(dir, _)| std::cmp::Reverse(dir.len()));
    for (dir, placeholder) in known {
        let trimmed = dir.trim_end_matches(['/', '\\']);
        for form in [trimmed.to_string(), trimmed.replace('\\', "/"), trimmed.replace('/', "\\")] {
            if form.len() >= 3 {
                out = replace_ignoring_case(&out, &form, placeholder);
            }
        }
    }
    // Anything still looking like an absolute path, up to the next space
    // or quote: `C:\...`, `\\server\...`, `/home/...`, `/Users/...`.
    let mut cleaned = String::new();
    for (i, word) in out.split(' ').enumerate() {
        if i > 0 {
            cleaned.push(' ');
        }
        let start = word.find(|c: char| !matches!(c, '"' | '\'' | '(' | '[' | '`' | '\n')).unwrap_or(word.len());
        let (lead, rest) = word.split_at(start);
        let b = rest.as_bytes();
        let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/');
        let unc = rest.starts_with("\\\\");
        let home = ["/home/", "/Users/", "/root/", "/var/", "/tmp/", "/opt/", "/mnt/", "/media/", "/usr/"]
            .iter()
            .any(|p| rest.starts_with(p));
        if drive || unc || home {
            cleaned.push_str(lead);
            let end = rest.find(['"', '\'', ')', ']', '`', ',', ';', '\n']).unwrap_or(rest.len());
            cleaned.push_str("<path>");
            cleaned.push_str(&rest[end..]);
        } else {
            cleaned.push_str(word);
        }
    }
    cleaned
}

/// `text` with every `what` (in any letter case, as Windows paths are) as `with`.
fn replace_ignoring_case(text: &str, what: &str, with: &str) -> String {
    let lower_text = text.to_lowercase();
    let lower_what = what.to_lowercase();
    // Lowercasing can change byte lengths outside ASCII: then exact only.
    if lower_text.len() != text.len() || lower_what.len() != what.len() {
        return text.replace(what, with);
    }
    let mut out = String::new();
    let mut at = 0;
    while let Some(found) = lower_text[at..].find(&lower_what) {
        let start = at + found;
        out.push_str(&text[at..start]);
        out.push_str(with);
        at = start + what.len();
    }
    out.push_str(&text[at..]);
    out
}

/// A phone's name as shown in the dialog: short, plain characters only.
pub fn clean_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || " -_'.".contains(*c))
        .take(40)
        .collect();
    let cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() {
        "a phone".into()
    } else {
        cleaned
    }
}

/// Same length and every byte compared, so timing gives nothing away.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The one-time pairing code: used up by the right code, by more than
/// PAIR_CODE_WRONG_TRIES wrong ones, or after 10 minutes.
pub struct PairCode {
    code: String,
    made: Instant,
    wrong: u32,
}

impl PairCode {
    pub fn new(code: String) -> Self {
        Self {
            code,
            made: Instant::now(),
            wrong: 0,
        }
    }
}

/// True if the code matched in time (it is then used up). A wrong code is
/// counted; the code is used up at the (PAIR_CODE_WRONG_TRIES + 1)th wrong
/// try, or when it has expired. Compared in constant time.
pub fn try_code(slot: &Mutex<Option<PairCode>>, offered: &str) -> bool {
    let mut slot = slot.lock().unwrap();
    let Some(pc) = slot.as_mut() else {
        return false;
    };
    if pc.made.elapsed() >= PAIR_CODE_LIFETIME {
        *slot = None;
        return false;
    }
    if same(&pc.code, offered) {
        *slot = None;
        return true;
    }
    pc.wrong += 1;
    if pc.wrong > PAIR_CODE_WRONG_TRIES {
        *slot = None;
    }
    false
}

pub fn add_phone(phones: &mut Vec<Phone>, phone: Phone) {
    phones.retain(|p| p.id != phone.id);
    phones.push(phone);
    while phones.len() > MAX_PHONES {
        phones.remove(0);
    }
}

pub fn qr_text(pc_id: &str, code: &str) -> String {
    format!("{QR_PREFIX}{pc_id}:{code}")
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

// -------------------------------------------------------- credential store

/// Keeps the link's own secrets where the app's screens can't write.
/// Windows: Credential Manager. Linux: a private file (owner only) in the
/// app's settings folder (~/.config/...), which is not the data folder the
/// screens' file commands reach (the kernel keyring proved unreliable: an
/// entry could get stuck so it could be neither read nor written).
#[cfg(windows)]
pub(crate) fn read_entry(_app: &AppHandle, name: &str) -> Option<String> {
    keyring::Entry::new(name, "link").ok()?.get_password().ok()
}

#[cfg(windows)]
pub(crate) fn write_entry(_app: &AppHandle, name: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(name, "link")
        .map_err(|e| e.to_string())?
        .set_password(value)
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn entry_file(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // Never inside the folder the screens can reach.
    if config.starts_with(&data) || data.starts_with(&config) {
        return Err("No private folder for the link on this system".into());
    }
    let file: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    Ok(config.join("link").join(file))
}

#[cfg(not(windows))]
pub(crate) fn read_entry(app: &AppHandle, name: &str) -> Option<String> {
    std::fs::read_to_string(entry_file(app, name).ok()?).ok()
}

#[cfg(not(windows))]
pub(crate) fn write_entry(app: &AppHandle, name: &str, value: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = entry_file(app, name)?;
    let dir = file.parent().ok_or("Bad folder")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("new");
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    out.write_all(value.as_bytes()).map_err(|e| e.to_string())?;
    drop(out);
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

fn load_phones(app: &AppHandle) -> Vec<Phone> {
    read_entry(app, PHONES_ENTRY)
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn save_phones(app: &AppHandle, phones: &[Phone]) -> Result<(), String> {
    let json = serde_json::to_string(phones).map_err(|e| e.to_string())?;
    write_entry(app, PHONES_ENTRY, &json)
}

/// One line of the pairing history: a pairing code was made, a phone was
/// paired or removed. Paired phones get this list with every status, so a
/// code made while you are away from home shows up on your phone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LinkEvent {
    /// Counts up; the phone remembers the last one it showed.
    pub n: u64,
    /// Seconds since 1970 (the PC's clock).
    pub at: u64,
    /// "code" | "paired" | "removed" | "removed-by-notice" | "may-answer" …
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

pub fn add_event(events: &mut Vec<LinkEvent>, at: u64, kind: &str, name: Option<String>) {
    let n = events.last().map(|e| e.n + 1).unwrap_or(1);
    events.push(LinkEvent {
        n,
        at,
        kind: kind.into(),
        name,
    });
    while events.len() > MAX_EVENTS {
        events.remove(0);
    }
}

fn load_events(app: &AppHandle) -> Vec<LinkEvent> {
    read_entry(app, EVENTS_ENTRY)
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn record(app: &AppHandle, kind: &str, name: Option<String>) {
    let at = now_secs();
    let mut events = load_events(app);
    add_event(&mut events, at, kind, name);
    if let Ok(json) = serde_json::to_string(&events) {
        let _ = write_entry(app, EVENTS_ENTRY, &json);
    }
}

// ------------------------------------------------- device circle, stage 2

use homelink::circle;

/// Splits text into parts of at most `units` UTF-16 units each (the
/// credential store counts those), never inside a character.
pub fn split_parts(text: &str, units: usize) -> Vec<String> {
    let mut parts = Vec::new();
    let mut part = String::new();
    let mut used = 0;
    for c in text.chars() {
        if used + c.len_utf16() > units {
            parts.push(std::mem::take(&mut part));
            used = 0;
        }
        part.push(c);
        used += c.len_utf16();
    }
    if !part.is_empty() {
        parts.push(part);
    }
    parts
}

/// Makes the state fit the store: the oldest news, then notices to pass
/// on, then numbers seen go first.
pub fn fit_circle(state: &mut circle::State) -> Vec<String> {
    loop {
        let parts = split_parts(&state.to_json(), CIRCLE_PART_UNITS);
        if parts.len() <= CIRCLE_PARTS {
            return parts;
        }
        if !state.news.is_empty() {
            state.news.remove(0);
        } else if !state.outbox.is_empty() {
            state.outbox.remove(0);
        } else if !state.seen.is_empty() {
            state.seen.remove(0);
        } else {
            state.uses.clear();
        }
    }
}

fn load_circle(app: &AppHandle) -> circle::State {
    let Some(count) = read_entry(app, CIRCLE_ENTRY).and_then(|c| c.trim().parse::<usize>().ok()) else {
        return circle::State::default();
    };
    let mut text = String::new();
    for i in 0..count.min(CIRCLE_PARTS) {
        match read_entry(app, &format!("{CIRCLE_ENTRY}.{i}")) {
            Some(part) => text.push_str(&part),
            None => return circle::State::default(),
        }
    }
    circle::State::from_json(&text)
}

fn save_circle(app: &AppHandle, state: &mut circle::State) -> Result<(), String> {
    let parts = fit_circle(state);
    for (i, part) in parts.iter().enumerate() {
        write_entry(app, &format!("{CIRCLE_ENTRY}.{i}"), part)?;
    }
    write_entry(app, CIRCLE_ENTRY, &parts.len().to_string())
}

/// One change to the circle's state at a time (devices and the screens).
static CIRCLE_LOCK: Mutex<()> = Mutex::new(());

fn with_circle<T>(app: &AppHandle, f: impl FnOnce(&mut circle::State) -> T) -> T {
    let _turn = CIRCLE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = load_circle(app);
    state.prune(circle::now());
    let out = f(&mut state);
    let _ = save_circle(app, &mut state);
    out
}

/// This PC's own keys: its link key, and its old device key while it still
/// uses one (link_client.rs). A notice about either is about this PC.
fn own_keys(app: &AppHandle) -> Vec<iroh::SecretKey> {
    let mut keys: Vec<iroh::SecretKey> = secret_key(app).into_iter().collect();
    if let Some(own) = crate::link_client::device_key_in_use(app) {
        keys.push(own);
    }
    keys
}

/// A good notice (Verdict::Apply): its key is removed here exactly as
/// "Remove here" removes it (a device that uses this PC is cut off at once
/// and kept from pairing for an hour; a Home PC this PC uses is left to the
/// screens, as news), and the user is told. Nothing else changes.
fn apply_removal(app: &AppHandle, state: &mut circle::State, notice: &circle::Removal) {
    let phones = load_phones(app);
    let name_of = |key: &str| phones.iter().find(|p| p.id == key).map(|p| p.name.clone());
    let removed_name = name_of(&notice.removed);
    let by_name = name_of(&notice.by);
    let used_here = state.uses(&notice.removed);
    state.forget_used(&notice.removed);
    let paired_here = removed_name.is_some() && forget_here(app, &notice.removed, "removed-by-notice").is_ok();
    let told = paired_here || used_here;
    if told {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title("Removed on another of your devices")
            .body(removal_note(by_name.as_deref(), removed_name.as_deref()))
            .show();
    }
    state.add_news(circle::News {
        removed: notice.removed.clone(),
        by: notice.by.clone(),
        at: notice.at,
        removed_name,
        by_name,
        told,
    });
}

/// What the user is told when a notice removed a device here.
pub fn removal_note(by: Option<&str>, removed: Option<&str>) -> String {
    format!(
        "\u{201c}{}\u{201d} removed \u{201c}{}\u{201d} from your devices; removed here too.",
        by.unwrap_or("Another of your devices"),
        removed.unwrap_or("a device")
    )
}

/// Notices handed over by `from` (a paired device's "removal", or a Home
/// PC's status). Trusted: the devices paired here, the Home PCs this PC
/// uses, and `from` when it is a Home PC this PC just reached.
fn take_removals(app: &AppHandle, from: &str, from_is_home_pc: bool, notices: &[circle::Removal]) {
    let me: Vec<String> = own_keys(app).iter().map(|k| k.public().to_string()).collect();
    with_circle(app, |state| {
        for notice in notices.iter().take(circle::MAX_NOTICES) {
            let mut trusted: Vec<String> = load_phones(app).into_iter().map(|p| p.id).collect();
            trusted.extend(state.uses.iter().cloned());
            if from_is_home_pc {
                trusted.push(from.to_string());
            }
            if state.take(notice, &me, &trusted, Some(from), circle::now()) == circle::Verdict::Apply {
                apply_removal(app, state, notice);
            }
        }
    });
}

/// The notices for a device asking for its status (each once).
fn removals_for(app: &AppHandle, device: &str) -> Vec<circle::Removal> {
    with_circle(app, |state| {
        let out = state.outgoing_for(device, circle::now());
        state.mark_sent(device, &out);
        out
    })
}

/// This PC as a device of another PC (link_client.rs): after its status,
/// takes what that PC passed on and hands it this PC's own notices.
pub fn circle_round(app: &AppHandle, phone: &homelink::Phone, pc: &str, removals: &[circle::Removal]) {
    take_removals(app, pc, true, removals);
    let out = with_circle(app, |state| state.outgoing_for(pc, circle::now()));
    if !out.is_empty() && phone.send_removals(pc, &out).is_ok() {
        with_circle(app, |state| state.mark_sent(pc, &out));
    }
}

/// The screens' circle calls (the same JSON as the phone's, homelink
/// circle_call): "remove" (the user removed a device here; a notice signed
/// with each of this PC's keys waits to be passed on, and a device that
/// uses this PC is removed as link_forget does) and "news" (removals
/// applied here since last asked). `homePcs`: the Home PCs this PC uses
/// now. Nothing here adds a device or a right. No network.
pub fn circle_call(app: &AppHandle, request: &str) -> serde_json::Value {
    let fail = |e: &str| serde_json::json!({"ok": false, "error": e});
    let Ok(request) = serde_json::from_str::<serde_json::Value>(request) else {
        return fail("Not a circle request");
    };
    let home_pcs: Vec<String> = request
        .get("homePcs")
        .and_then(|v| v.as_array())
        .map(|list| list.iter().filter_map(|k| k.as_str().map(String::from)).collect())
        .unwrap_or_default();
    match request.get("op").and_then(|o| o.as_str()) {
        Some("remove") => {
            let key = request.get("key").and_then(|k| k.as_str()).unwrap_or("").to_string();
            if circle::canonical_key(&key).is_none() {
                return fail("Not a device key");
            }
            if load_phones(app).iter().any(|p| p.id == key) {
                if let Err(e) = forget_here(app, &key, "removed") {
                    return fail(&e);
                }
            }
            let keys = own_keys(app);
            with_circle(app, |state| {
                state.set_uses(&home_pcs);
                let now = circle::now();
                let signed = keys.iter().filter(|k| state.sign(k, &key, now).is_ok()).count();
                if signed > 0 {
                    serde_json::json!({"ok": true})
                } else {
                    fail("Could not sign the removal")
                }
            })
        }
        Some("news") => with_circle(app, |state| {
            state.set_uses(&home_pcs);
            serde_json::json!({"ok": true, "news": state.take_news()})
        }),
        _ => fail("Not a circle request"),
    }
}

/// Which commit this PC app was built from (scripts/build-info/write.js runs
/// before the build); "dev" for local builds.
pub fn pc_build() -> String {
    serde_json::from_str::<serde_json::Value>(include_str!("../../src/assets/build-info.json"))
        .ok()
        .and_then(|v| v.get("commit").and_then(|c| c.as_str()).map(String::from))
        .unwrap_or_else(|| "dev".into())
}

// ------------------------------------------------------------ the endpoint

#[derive(Default)]
pub struct Link {
    /// This PC's endpoint (its link key) and what takes devices'
    /// connections on it. Kept while the link is off only when this PC uses
    /// it as a device too (`shared`); devices are refused then.
    running: tokio::sync::Mutex<Option<iroh::protocol::Router>>,
    /// The user's switch: the link is on (paired devices are let in).
    on: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// This PC uses its link key as a device of another PC too (one key per
    /// PC, link_client.rs): the endpoint stays while the link is off.
    shared: std::sync::atomic::AtomicBool,
    pair_code: Mutex<Option<PairCode>>,
    /// Paired devices may keep the system prompt and memory in step (the
    /// user's switch on this PC; off by default).
    sync_allowed: std::sync::atomic::AtomicBool,
    /// Syncs waiting for the screens' answer, by id.
    sync_waiting: Mutex<std::collections::HashMap<u64, tokio::sync::oneshot::Sender<String>>>,
    sync_next: std::sync::atomic::AtomicU64,
    /// Devices with a sync under way (one at a time per device).
    syncing: Mutex<std::collections::HashSet<String>>,
    /// Open connections by device id, so removing a device cuts it off.
    connections: Mutex<std::collections::HashMap<String, Vec<iroh::endpoint::Connection>>>,
    /// Devices removed lately, and when.
    removed: Mutex<std::collections::HashMap<String, Instant>>,
    /// Chats allowed to read this PC's workspace (in memory only: asked
    /// again after a restart).
    read_grants: Mutex<ReadGrants>,
    /// One "read the workspace?" question at a time.
    read_asking: tokio::sync::Mutex<()>,
}

impl Link {
    fn recently_removed(&self, id: &str) -> bool {
        let mut removed = self.removed.lock().unwrap();
        removed.retain(|_, at| at.elapsed() < REMOVED_LOCKOUT);
        removed.contains_key(id)
    }

    /// Closes every open connection from this device (its tunnels and
    /// syncs end at once).
    fn cut_off(&self, id: &str) {
        let open = self.connections.lock().unwrap().remove(id);
        for connection in open.unwrap_or_default() {
            connection.close(0u32.into(), b"removed");
        }
    }

    /// Closes every device's open connections (the link was switched off
    /// while the endpoint stays for this PC's own use as a device).
    fn cut_off_all(&self) {
        let open: Vec<_> = self.connections.lock().unwrap().drain().collect();
        for connection in open.into_iter().flat_map(|(_, list)| list) {
            connection.close(0u32.into(), b"off");
        }
    }

    fn is_on(&self) -> bool {
        self.on.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// A device's one sync at a time: held while it runs, freed when dropped.
struct SyncTurn<'a> {
    set: &'a Mutex<std::collections::HashSet<String>>,
    id: String,
}

impl<'a> SyncTurn<'a> {
    fn take(set: &'a Mutex<std::collections::HashSet<String>>, id: &str) -> Option<Self> {
        if set.lock().unwrap().insert(id.to_string()) {
            Some(SyncTurn { set, id: id.to_string() })
        } else {
            None
        }
    }
}

impl Drop for SyncTurn<'_> {
    fn drop(&mut self) {
        self.set.lock().unwrap().remove(&self.id);
    }
}

const OFF_ANSWERS: &str = "Answering this PC's questions is off on the PC (Settings → Use this PC's model from your phone)";
const NOT_THIS_DEVICE: &str = "This device may not answer this PC's questions; allow it on the PC (Settings → Use this PC's model from your phone → Paired phones → May answer)";
const OFF_PICTURES: &str = "Making pictures for paired devices is off on the PC (Settings → Use this PC's model from your phone → Let paired devices make pictures)";
const NOT_THIS_DEVICE_PICTURES: &str = "This device may not make pictures on this PC; allow it on the PC (Settings → Use this PC's model from your phone → Paired phones → Pictures)";

/// The PC's switch for pictures (kept where the screens can't write).
fn pictures_allowed(app: &AppHandle) -> bool {
    read_entry(app, PICTURES_ENTRY).as_deref() == Some("on")
}

/// What the PC user is told when a device starts a picture.
pub fn picture_note(device: &str, prompt: &str) -> String {
    let mut cut: String = prompt.chars().take(100).collect();
    if prompt.chars().count() > 100 {
        cut.push('…');
    }
    format!("{device} is making a picture: {cut}")
}

/// A picture for a paired device: the same maker, checks, caps, word check
/// and one-at-a-time slot as the PC's own tool. Stops the maker if the
/// device goes away (or is removed) meanwhile. The JSON header line, then
/// the PNG.
async fn picture_for(
    app: &AppHandle,
    device: &str,
    request: (String, Option<u32>, Option<u32>, Option<u32>),
    send: &mut iroh::endpoint::SendStream,
) -> Result<(serde_json::Value, Vec<u8>), String> {
    let (prompt, width, height, steps) = request;
    let set = crate::image_gen::first_downloaded_set(app)?;
    let size = crate::image_gen::default_size(&set);
    let note_app = app.clone();
    let device = device.to_string();
    let making = crate::image_gen::make(
        app.clone(),
        set,
        &prompt,
        width.unwrap_or(size),
        height.unwrap_or(size),
        steps,
        None,
        None,
        move |req| {
            use tauri_plugin_notification::NotificationExt;
            let _ = note_app
                .notification()
                .builder()
                .title(format!("Picture for {device}"))
                .body(picture_note(&device, &req.prompt))
                .show();
        },
    );
    // Dropping the maker's future frees its slot and ends sd-cli (Slot).
    let made = tokio::select! {
        made = making => made?,
        _ = send.stopped() => return Err("The device went away".into()),
    };
    let size = std::fs::metadata(&made.file).map_err(|e| e.to_string())?.len();
    if size > MAX_PICTURE as u64 {
        return Err("The picture is too large to send".into());
    }
    let bytes = tokio::fs::read(&made.file).await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PICTURE || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The picture could not be sent".into());
    }
    Ok((
        serde_json::json!({
            "ok": true,
            "bytes": bytes.len(),
            "name": made.name,
            "seed": made.seed,
            "seconds": made.seconds,
            "width": made.width,
            "height": made.height,
        }),
        bytes,
    ))
}

/// This PC's folders that errors may name, and what a device sees instead.
fn local_folders(app: &AppHandle) -> Vec<(String, &'static str)> {
    let p = app.path();
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.to_path_buf()));
    [
        (crate::pc::workspace(app).ok(), "<workspace>"),
        (p.app_data_dir().ok(), "<app folder>"),
        (p.app_local_data_dir().ok(), "<app folder>"),
        (p.app_config_dir().ok(), "<app folder>"),
        (p.app_cache_dir().ok(), "<app folder>"),
        (p.resource_dir().ok(), "<app folder>"),
        (exe_dir, "<app folder>"),
        (p.temp_dir().ok(), "<temp>"),
        (p.home_dir().ok(), "<home>"),
    ]
    .into_iter()
    .filter_map(|(dir, name)| dir.map(|d| (d.to_string_lossy().into_owned(), name)))
    .collect()
}

/// An error for a device: without this PC's paths (`without_paths`).
fn error_for_device(app: &AppHandle, error: &str) -> String {
    without_paths(error, &local_folders(app))
}

/// The PC's switch for device tools (kept where the screens can't write).
fn tools_allowed(app: &AppHandle) -> bool {
    read_entry(app, TOOLS_ENTRY).as_deref() == Some("on")
}

/// The question asked on this PC (and, while allowed, on devices that may
/// answer) before a device's chat reads the workspace.
pub fn read_question(device: &str, chat: &str, allowed_now: usize) -> String {
    let short: String = chat.chars().take(8).collect();
    let others = if allowed_now >= MAX_CHAT_GRANTS_PER_DEVICE {
        format!("\n\nThis device already has {allowed_now} chats allowed (at most {MAX_CHAT_GRANTS_PER_DEVICE}); allowing this one ends the oldest.")
    } else if allowed_now > 0 {
        format!("\n\nThis device already has {allowed_now} other chat{} allowed (at most {MAX_CHAT_GRANTS_PER_DEVICE}).", if allowed_now == 1 { "" } else { "s" })
    } else {
        String::new()
    };
    format!(
        "\u{201c}{device}\u{201d} asks to read files in your workspace for this chat.\n\nDuring this one chat on that device (12 hours at most) it may list the files in DesktopAgent's workspace folder and read text files and documents there. Nothing outside the workspace, and nothing is changed. This PC shows a notification for each file read.{others}\n\nChat: {short}…"
    )
}

/// What the PC user is told when a device read a workspace file, with how
/// many of that device's chats may read now.
pub fn read_note(device: &str, file: &str, chats: usize) -> String {
    format!("{device} read {file} from the workspace ({chats} of at most {MAX_CHAT_GRANTS_PER_DEVICE} chats allowed to read)")
}

/// Whether this chat of this device may read the workspace: allowed
/// before (within 12 hours), else asked now. Checked again after the
/// question, as the switches may have changed meanwhile.
async fn may_read_now(app: &AppHandle, remote: &str, device: &str, chat: &str) -> bool {
    let link = app.state::<Link>();
    if link.read_grants.lock().unwrap().has(remote, chat, Instant::now()) {
        return true;
    }
    let _one = link.read_asking.lock().await;
    if link.read_grants.lock().unwrap().has(remote, chat, Instant::now()) {
        return true;
    }
    let allowed_now = link.read_grants.lock().unwrap().count(remote, Instant::now());
    if !crate::approval::ask(app, &read_question(device, chat, allowed_now)).await {
        return false;
    }
    if !tools_allowed(app) || !may_read(&load_phones(app), remote) {
        return false;
    }
    link.read_grants.lock().unwrap().add(remote, chat, Instant::now());
    true
}

/// Runs file and system reads off the async runtime.
async fn blocking(
    f: impl FnOnce() -> Result<serde_json::Value, String> + Send + 'static,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// What the PC user is told when a device's action was done (the
/// clipboard by its length only, never its text).
pub fn act_note(device: &str, call: &RemoteCall, clipboard_chars: usize) -> String {
    match call {
        RemoteCall::Open(file) => format!("{device} opened {file} on this PC"),
        RemoteCall::Print(file) => format!("{device} printed {file} on this PC"),
        RemoteCall::Media(key) => format!("{device} pressed {} on this PC", crate::pc_extra::media_name(key)),
        RemoteCall::ClipboardRead => format!("{device} got the text on this PC's clipboard ({clipboard_chars} characters)"),
        _ => format!("{device} used this PC's tools"),
    }
}

/// An action for a paired device (ACT_TOOLS): the very same function as
/// this PC's own tool (pc::open_file, pc_extra::print_workspace_file,
/// press_media_key, read_clipboard), which asks natively every time with
/// the device named and checks again after the answer that tools are
/// still on here and this device may still act. Logged (the clipboard by
/// its length only) and told in a notification.
async fn act_for(app: &AppHandle, remote: &str, device: &str, call: RemoteCall, thinking: Option<&str>) -> Result<serde_json::Value, String> {
    let still_allowed = || tools_allowed(app) && may_act(&load_phones(app), remote);
    let by = crate::approval::Device { name: device, still_allowed: &still_allowed };
    let (answer, clipboard_chars) = match &call {
        RemoteCall::Open(file) => {
            crate::pc::open_file(app, file, Some(&by), thinking).await?;
            (serde_json::json!({"done": true}), 0)
        }
        RemoteCall::Print(file) => {
            crate::pc_extra::print_workspace_file(app, file, Some(&by), thinking).await?;
            (serde_json::json!({"done": true}), 0)
        }
        RemoteCall::Media(key) => {
            crate::pc_extra::press_media_key(app, key, Some(&by), thinking).await?;
            (serde_json::json!({"done": true}), 0)
        }
        RemoteCall::ClipboardRead => {
            let text = crate::pc_extra::read_clipboard(app, Some(&by), thinking).await?;
            let chars = text.chars().count();
            (serde_json::json!({"text": text}), chars)
        }
        _ => return Err(NOT_A_REMOTE_TOOL.into()),
    };
    let note = act_note(device, &call, clipboard_chars);
    crate::remote_ask::log_use(app, device, &note);
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(format!("{device} used this PC")).body(note).show();
    Ok(answer)
}

/// Most bytes of a command's output sent to a device (as this PC's own
/// tool returns: pc::run caps it at 32 KB; capped again after the paths
/// are taken out).
pub const MAX_DEVICE_OUTPUT: usize = 32 * 1024;

/// `text` cut to at most `max` bytes (at a character boundary), saying so.
pub fn cap_text(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[… output cut]", &text[..end])
}

/// A command's output as a device may see it: this PC's own folders and
/// any other absolute path taken out (`without_paths`, line by line and
/// cell by cell, so a path at the start of a line or after a tab goes
/// too), then capped.
pub fn output_for_device(text: &str, known: &[(String, &str)]) -> String {
    let clean: Vec<String> = text
        .split('\n')
        .map(|line| line.split('\t').map(|cell| without_paths(cell, known)).collect::<Vec<_>>().join("\t"))
        .collect();
    cap_text(&clean.join("\n"), MAX_DEVICE_OUTPUT)
}

/// What the PC user is told when a device ran a command: the device, the
/// command's first 60 characters (escaped, one line) and how it ended.
pub fn command_note(device: &str, command: &str, exit_code: Option<i32>, timed_out: bool) -> String {
    let shown = crate::remote_ask::one_line(command);
    let mut start: String = shown.chars().take(60).collect();
    if shown.chars().count() > 60 {
        start.push('…');
    }
    format!("{device} ran a command on this PC ({}): {start}", command_end(exit_code, timed_out))
}

/// How a command ended, in plain words.
fn command_end(exit_code: Option<i32>, timed_out: bool) -> String {
    match (timed_out, exit_code) {
        (true, _) => "stopped after 60 s".to_string(),
        (false, Some(code)) => format!("exit code {code}"),
        (false, None) => "no exit code".to_string(),
    }
}

/// A command for a paired device (COMMAND_TOOLS): the very same function
/// as this PC's own run_command (pc::run_checked_command: the same checks,
/// the whole command in the native "Allow?" every time naming the device,
/// never "always", the workspace folder, 60 s, the output capped), which
/// checks again after the answer that tools are still on here and this
/// device may still run commands. The whole command goes to the answers
/// log (escaped, one line); a notification shows its start. The output
/// goes back without this PC's paths.
async fn command_for(app: &AppHandle, remote: &str, device: &str, command: &str, thinking: Option<&str>) -> Result<serde_json::Value, String> {
    let still_allowed = || tools_allowed(app) && may_command(&load_phones(app), remote);
    let by = crate::approval::Device { name: device, still_allowed: &still_allowed };
    let ran = crate::pc::run_checked_command(app, command, Some(&by), thinking).await?;
    let how = command_end(ran.exit_code, ran.timed_out);
    crate::remote_ask::log_use(app, device, &format!("ran a command ({how}): {command}"));
    use tauri_plugin_notification::NotificationExt;
    let _ = app
        .notification()
        .builder()
        .title(format!("{device} ran a command on this PC"))
        .body(command_note(device, command, ran.exit_code, ran.timed_out))
        .show();
    Ok(serde_json::json!({
        "exitCode": ran.exit_code,
        "timedOut": ran.timed_out,
        "output": output_for_device(&ran.output, &local_folders(app)),
    }))
}

/// A change to a workspace file for a paired device (WRITE_TOOLS): worked
/// out first (pc_write::plan: the name and kind checked again, the file
/// now, at most MAX_WRITE in all), then the native "Allow?" every time
/// (approval::ask_for: Allow or Don't allow, never "always"), naming the
/// device, with the before/after view; the switch and "may write" checked
/// again after the answer. Then written (pc_write::apply: refused if the
/// file changed meanwhile, the previous version kept in the file history
/// first, read back). Logged and told in a notification: the device, the
/// file and the line counts, never the text.
async fn write_for(
    app: &AppHandle,
    remote: &str,
    device: &str,
    file: String,
    kind: crate::pc_write::WriteKind,
    text: String,
    thinking: Option<&str>,
) -> Result<serde_json::Value, String> {
    let still_allowed = || tools_allowed(app) && may_write(&load_phones(app), remote);
    let by = crate::approval::Device { name: device, still_allowed: &still_allowed };
    let workspace = crate::pc::workspace(app)?;
    let history = app.path().app_data_dir().map_err(|e| e.to_string())?.join(crate::pc_write::HISTORY);
    let (w, h) = (workspace.clone(), history.clone());
    let plan = tauri::async_runtime::spawn_blocking(move || crate::pc_write::plan(&w, &h, &file, kind, &text))
        .await
        .map_err(|e| e.to_string())??;
    if plan.unchanged() {
        return Ok(serde_json::json!({"done": false, "unchanged": true, "file": plan.file}));
    }
    if !crate::approval::ask_for(app, &crate::pc_write::question(device, &plan), Some(&by), thinking).await {
        return Err("The user said no on the PC. Nothing was written.".into());
    }
    let plan = tauri::async_runtime::spawn_blocking(move || crate::pc_write::apply(&workspace, &history, &plan).map(|_| plan))
        .await
        .map_err(|e| e.to_string())??;
    let note = crate::pc_write::note(device, &plan);
    crate::remote_ask::log_use(app, device, &note);
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(format!("{device} changed a file on this PC")).body(note).show();
    Ok(serde_json::json!({
        "done": true,
        "file": plan.file,
        "created": plan.previous.is_none(),
        "added": plan.change.added,
        "removed": plan.change.removed,
    }))
}

/// The text a device writes: exactly `bytes` more bytes after the request
/// line (within WRITE_BODY_TIME), read only after every check passed;
/// plain UTF-8 text (pc_write::check_text).
async fn read_text(recv: &mut iroh::endpoint::RecvStream, bytes: usize) -> Result<String, String> {
    if bytes > crate::pc_write::MAX_WRITE {
        return Err("The text is too large".into());
    }
    let mut body = vec![0u8; bytes];
    match tokio::time::timeout(WRITE_BODY_TIME, recv.read_exact(&mut body)).await {
        Ok(Ok(())) => {}
        _ => return Err("The text did not arrive whole".into()),
    }
    let text = String::from_utf8(body).map_err(|_| "The text is not UTF-8 text".to_string())?;
    crate::pc_write::check_text(&text)?;
    Ok(text)
}

/// Runs a checked tool request for a paired device: the same functions as
/// this PC's own tools (pc::pc_info, pc::workspace_file, docs.rs through
/// pc_files::read; actions through act_for; a command through
/// command_for; a change through write_for, with the device's `text`).
/// Each use is logged with the answers log.
async fn tool_for(
    app: &AppHandle,
    remote: &str,
    device: &str,
    chat: &str,
    call: RemoteCall,
    text: String,
    thinking: Option<&str>,
) -> Result<serde_json::Value, String> {
    if let RemoteCall::Command(command) = &call {
        return command_for(app, remote, device, command, thinking).await;
    }
    if matches!(call, RemoteCall::Open(_) | RemoteCall::Print(_) | RemoteCall::Media(_) | RemoteCall::ClipboardRead) {
        return act_for(app, remote, device, call, thinking).await;
    }
    if let RemoteCall::Write { file, kind, .. } = call {
        return write_for(app, remote, device, file, kind, text, thinking).await;
    }
    if call != RemoteCall::PcInfo && !may_read_now(app, remote, device, chat).await {
        return Err("Not allowed on the PC: reading its workspace for this chat was refused".into());
    }
    match call {
        RemoteCall::PcInfo => {
            let a = app.clone();
            let info = blocking(move || serde_json::to_value(crate::pc::pc_info(a)).map_err(|e| e.to_string())).await?;
            crate::remote_ask::log_use(app, device, "pc_info");
            Ok(info)
        }
        RemoteCall::WorkspaceList => {
            let dir = crate::pc::workspace(app)?;
            let listing = blocking(move || {
                serde_json::to_value(crate::pc_files::list(&dir)?).map_err(|e| e.to_string())
            })
            .await?;
            crate::remote_ask::log_use(app, device, "listed the workspace");
            Ok(listing)
        }
        RemoteCall::WorkspaceRead(file) => {
            let path = crate::pc::workspace_file(app, &file)?;
            let name = file.clone();
            // No PDFs, its own thread with a large stack, at most 30 s
            // (pc_files::read_for_device): a hostile file can't stop the app.
            let read = blocking(move || {
                let file = crate::pc_files::read_for_device(&path, &name, crate::pc_files::DEVICE_READ_TIME)?;
                serde_json::to_value(file).map_err(|e| e.to_string())
            })
            .await?;
            crate::remote_ask::log_use(app, device, &format!("read workspace file {file}"));
            use tauri_plugin_notification::NotificationExt;
            let chats = app.state::<Link>().read_grants.lock().unwrap().count(remote, Instant::now());
            let _ = app
                .notification()
                .builder()
                .title(format!("{device} read a file on this PC"))
                .body(read_note(device, &file, chats))
                .show();
            Ok(read)
        }
        // Actions went to act_for above.
        _ => Err(NOT_A_REMOTE_TOOL.into()),
    }
}

/// Most bytes one sync may carry (the device library's own limit too).
pub const MAX_SYNC: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    on: bool,
    /// "Let paired devices make pictures on this PC".
    pictures_allowed: bool,
    /// "Let paired devices use this PC's tools".
    tools_allowed: bool,
    pc_id: Option<String>,
    phones: Vec<Phone>,
    events: Vec<LinkEvent>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    qr: String,
    /// The QR code as an SVG picture (a data: address, for an <img>).
    qr_image: String,
    expires_in_secs: u64,
}

/// The QR code as a data: SVG picture, black on white.
pub fn qr_image(text: &str) -> Result<String, String> {
    use base64::Engine;
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .build();
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg)
    ))
}

fn secret_key(app: &AppHandle) -> Result<iroh::SecretKey, String> {
    if let Some(hex) = read_entry(app, KEY_ENTRY) {
        if let Ok(key) = hex.trim().parse::<iroh::SecretKey>() {
            return Ok(key);
        }
    }
    let key = iroh::SecretKey::generate();
    let hex: String = key.to_bytes().iter().map(|b| format!("{b:02x}")).collect();
    write_entry(app, KEY_ENTRY, &hex)?;
    Ok(key)
}

#[derive(Debug, Clone)]
struct Handler {
    app: AppHandle,
}

impl iroh::protocol::ProtocolHandler for Handler {
    async fn accept(
        &self,
        connection: iroh::endpoint::Connection,
    ) -> Result<(), iroh::protocol::AcceptError> {
        let remote = connection.remote_id().to_string();
        let link = self.app.state::<Link>();
        // Switched off (the endpoint stays only for this PC's own use as a
        // device): nobody comes in. The incoming filter refuses first.
        if !link.is_on() {
            connection.close(0u32.into(), b"off");
            return Ok(());
        }
        // Kept so that removing this device closes it at once (link_forget).
        link.connections
            .lock()
            .unwrap()
            .entry(remote.clone())
            .or_default()
            .push(connection.clone());
        let this = connection.stable_id();
        loop {
            let Ok((send, recv)) = connection.accept_bi().await else {
                let mut open = link.connections.lock().unwrap();
                if let Some(list) = open.get_mut(&remote) {
                    list.retain(|c| c.stable_id() != this);
                    if list.is_empty() {
                        open.remove(&remote);
                    }
                }
                return Ok(());
            };
            let app = self.app.clone();
            let remote = remote.clone();
            tauri::async_runtime::spawn(async move {
                let _ = serve_stream(app, remote, send, recv).await;
            });
        }
    }
}

async fn read_line(recv: &mut iroh::endpoint::RecvStream) -> Option<Vec<u8>> {
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    while line.len() <= MAX_REQUEST_LINE {
        match recv.read(&mut byte).await {
            Ok(Some(1)) if byte[0] == b'\n' => return Some(line),
            Ok(Some(1)) => line.push(byte[0]),
            _ => return None,
        }
    }
    None
}

/// Model requests a paired phone may pass to this PC's model server.
const MODEL_REQUESTS: &[(&str, &str)] = &[
    ("GET", "/health"),
    ("GET", "/props"),
    ("GET", "/models"),
    ("GET", "/v1/models"),
    ("POST", "/chat/completions"),
    ("POST", "/v1/chat/completions"),
    ("POST", "/completions"),
    ("POST", "/v1/completions"),
];
const MAX_HEAD: usize = 16 * 1024;
/// Largest request body passed on (pictures in a chat are sent inline).
pub const MAX_BODY: usize = 16 * 1024 * 1024;
/// How long a device has to send its whole request.
const REQUEST_TIME: Duration = Duration::from_secs(120);

/// The request's head (up to and including the blank line), and whatever
/// came after it in the same reads (the start of the body).
async fn read_head(recv: &mut iroh::endpoint::RecvStream) -> Option<Vec<u8>> {
    let mut head = Vec::new();
    let mut chunk = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        if head.len() > MAX_HEAD {
            return None;
        }
        match recv.read(&mut chunk).await {
            Ok(Some(n)) if n > 0 => head.extend_from_slice(&chunk[..n]),
            _ => return None,
        }
    }
    Some(head)
}

/// A model request (a known path) with the model's current password.
pub fn check_head(head: &[u8], key: &str) -> Result<(), &'static str> {
    let text = std::str::from_utf8(head).map_err(|_| "not text")?;
    let mut lines = text.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let path = target.split('?').next().unwrap_or("");
    if !MODEL_REQUESTS.contains(&(method, path)) {
        return Err("not a model request");
    }
    let expected = format!("Bearer {key}");
    let authorised = !key.is_empty()
        && lines.any(|l| {
            l.split_once(':').is_some_and(|(name, value)| {
                name.trim().eq_ignore_ascii_case("authorization") && value.trim() == expected
            })
        });
    if authorised {
        Ok(())
    } else {
        Err("no password")
    }
}

/// One checked model request, ready for the model server.
#[derive(Debug, PartialEq)]
pub struct ModelRequest {
    /// The head as passed on: the device's headers minus the ones that
    /// would keep the connection open or change how the body is read, plus
    /// `Connection: close` and the exact `Content-Length`.
    pub head: Vec<u8>,
    pub body_len: usize,
    pub path: String,
    /// The device waits for "100 Continue" before it sends the body.
    pub expect_continue: bool,
}

/// Headers never passed on: each would keep the connection open for a
/// second request (which would then skip these checks) or change how the
/// body is read.
const DROPPED_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-connection",
    "upgrade",
    "http2-settings",
    "te",
    "trailer",
    "expect",
    "content-length",
];

/// Exactly one request per stream (SECURITY.md rule 6): the head must be a
/// model request with the password (check_head), its body must have a
/// plain length (no chunks), and the model server is told to close after
/// answering, so nothing after this request ever reaches it unchecked.
pub fn prepare_head(head: &[u8], key: &str) -> Result<ModelRequest, &'static str> {
    check_head(head, key)?;
    let text = std::str::from_utf8(head).map_err(|_| "not text")?;
    let text = text.strip_suffix("\r\n\r\n").ok_or("unfinished head")?;
    let mut lines = text.split("\r\n");
    let first = lines.next().unwrap_or("");
    let parts: Vec<&str> = first.split(' ').collect();
    if parts.len() != 3 || !matches!(parts[2], "HTTP/1.1" | "HTTP/1.0") {
        return Err("not a plain HTTP/1.1 request");
    }
    let path = parts[1].split('?').next().unwrap_or("").to_string();
    let mut out = format!("{first}\r\n");
    let mut length: Option<usize> = None;
    let mut expect_continue = false;
    for line in lines {
        // No folded lines, lone line breaks or other control characters:
        // the model server must see exactly the headers checked here.
        if line.starts_with([' ', '\t']) || line.chars().any(|c| c.is_control() && c != '\t') {
            return Err("bad header");
        }
        let (name, value) = line.split_once(':').ok_or("bad header")?;
        if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b)) {
            return Err("bad header");
        }
        let lower = name.to_ascii_lowercase();
        let value = value.trim();
        match lower.as_str() {
            "transfer-encoding" => return Err("send the body with a Content-Length"),
            "content-length" => {
                if length.is_some() || value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
                    return Err("bad Content-Length");
                }
                let n: usize = value.parse().map_err(|_| "bad Content-Length")?;
                if n > MAX_BODY {
                    return Err("request too large");
                }
                length = Some(n);
            }
            "expect" => expect_continue = value.eq_ignore_ascii_case("100-continue"),
            _ => {}
        }
        if !DROPPED_HEADERS.contains(&lower.as_str()) {
            out.push_str(line);
            out.push_str("\r\n");
        }
    }
    let body_len = length.unwrap_or(0);
    if length.is_some() || parts[0] == "POST" {
        out.push_str(&format!("Content-Length: {body_len}\r\n"));
    }
    out.push_str("Connection: close\r\n\r\n");
    Ok(ModelRequest {
        head: out.into_bytes(),
        body_len,
        path,
        expect_continue,
    })
}

/// Keys whose text value is a picture, sound or video for the model.
const MEDIA_KEYS: &[&str] = &[
    "url",
    "image_url",
    "input_image",
    "video_url",
    "input_video",
    "audio_url",
    "input_audio",
    "file_url",
    "uri",
];

/// Pictures, sound and video in a device's request must be inline
/// (`data:`): the model server would fetch any other address itself, from
/// inside the PC's home network (routers, cameras, other PCs).
fn inline_media_only(value: &serde_json::Value) -> Result<(), &'static str> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, inner) in map {
                let media = MEDIA_KEYS.contains(&key.to_ascii_lowercase().as_str());
                match inner {
                    serde_json::Value::String(text) if media && !text.starts_with("data:") => {
                        return Err("Pictures, sound and video must be sent inline (data:), never as an address the PC would fetch");
                    }
                    _ => inline_media_only(inner)?,
                }
            }
            Ok(())
        }
        serde_json::Value::Array(items) => items.iter().try_for_each(inline_media_only),
        _ => Ok(()),
    }
}

/// The body of a chat or completion request: JSON, and every picture,
/// sound or video in a message (or a completion prompt) inline.
pub fn check_body(path: &str, body: &[u8]) -> Result<(), &'static str> {
    if !path.ends_with("completions") {
        return Ok(());
    }
    let json: serde_json::Value = serde_json::from_slice(body).map_err(|_| "The request is not JSON")?;
    if let Some(messages) = json.get("messages").and_then(|m| m.as_array()) {
        for message in messages {
            if let Some(content) = message.get("content") {
                if !content.is_string() {
                    inline_media_only(content)?;
                }
            }
        }
    }
    if let Some(prompt) = json.get("prompt") {
        inline_media_only(prompt)?;
    }
    Ok(())
}

/// A refusal the device's app shows as the error (OpenAI style).
fn forbidden(message: &str) -> Vec<u8> {
    let body = serde_json::json!({"error": {"message": message, "type": "forbidden"}}).to_string();
    format!(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

/// Reads one whole request from the device and checks it: the head, then
/// exactly Content-Length body bytes. Anything sent after it (a second,
/// pipelined request) is refused.
async fn read_request(
    recv: &mut iroh::endpoint::RecvStream,
    send: &mut iroh::endpoint::SendStream,
    key: &str,
) -> Result<(ModelRequest, Vec<u8>), &'static str> {
    let read = read_head(recv).await.ok_or("no request")?;
    let end = read.windows(4).position(|w| w == b"\r\n\r\n").ok_or("no request")? + 4;
    let request = prepare_head(&read[..end], key)?;
    let mut body = read[end..].to_vec();
    if body.len() > request.body_len {
        return Err("one request at a time");
    }
    if request.expect_continue && body.len() < request.body_len {
        send.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await.map_err(|_| "closed")?;
    }
    let have = body.len();
    body.resize(request.body_len, 0);
    recv.read_exact(&mut body[have..]).await.map_err(|_| "the request ended early")?;
    check_body(&request.path, &body)?;
    Ok((request, body))
}

async fn reply(send: &mut iroh::endpoint::SendStream, value: serde_json::Value) {
    let mut text = value.to_string();
    text.push('\n');
    let _ = send.write_all(text.as_bytes()).await;
}

async fn serve_stream(
    app: AppHandle,
    remote: String,
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
) -> Result<(), String> {
    let request = tokio::time::timeout(FIRST_LINE_TIME, read_line(&mut recv))
        .await
        .ok()
        .flatten()
        .and_then(|line| parse_request(&line));
    let paired = load_phones(&app).iter().any(|p| p.id == remote);
    match request {
        // A device already paired, or removed lately, can't use up the
        // one-time code (a wrong code from a new device counts as one of
        // its PAIR_CODE_WRONG_TRIES).
        Some(Request::Pair { .. }) if paired || app.state::<Link>().recently_removed(&remote) => {
            let error = if paired {
                "This device is already paired with this PC"
            } else {
                "This device was removed on the PC lately; try again later"
            };
            reply(&mut send, serde_json::json!({"ok": false, "error": error})).await;
        }
        Some(Request::Pair { code, name }) => {
            let link = app.state::<Link>();
            let code_ok = try_code(&link.pair_code, &code);
            let allowed = code_ok && {
                let name = clean_name(&name);
                let question = format!(
                    "Pair with the phone \u{201c}{name}\u{201d}?\n\nIt will be able to use the model running on this PC, from anywhere. It can't reach your files or anything else on this PC.\n\nPhone key: {}",
                    &remote[..remote.len().min(16)]
                );
                if crate::approval::ask_on_this_pc(&app, &question).await {
                    let mut phones = load_phones(&app);
                    add_phone(&mut phones, Phone::new(remote.clone(), name.clone(), now_secs()));
                    let saved = save_phones(&app, &phones).is_ok();
                    if saved {
                        record(&app, "paired", Some(name));
                    }
                    saved
                } else {
                    false
                }
            };
            reply(&mut send, serde_json::json!({"ok": allowed})).await;
        }
        Some(Request::Status) if paired => {
            let address = app.state::<crate::model_server::ModelServer>().address();
            reply(
                &mut send,
                serde_json::json!({
                    "ok": true,
                    "running": address.is_some(),
                    "apiKey": address.map(|(_, key)| key),
                    // So the phone notices pairing codes made while away.
                    "events": load_events(&app),
                    // Removal notices for this device (device circle).
                    "removals": removals_for(&app, &remote),
                    // So the phone can say when the two apps' builds differ.
                    "build": pc_build(),
                    // The model a phone may start ("start"), by file name.
                    "lastModel": crate::model_server::load_last_model(&app)
                        .map(|m| m.model_path.rsplit(['/', '\\']).next().unwrap_or("").to_string()),
                }),
            )
            .await;
        }
        Some(Request::Start) if paired => {
            let answer = if app.state::<crate::model_server::ModelServer>().address().is_some() {
                serde_json::json!({"ok": true})
            } else {
                match crate::model_server::load_last_model(&app) {
                    None => serde_json::json!({"ok": false, "error": "No model has been run on the PC yet"}),
                    Some(last) => match crate::model_server::start_model(
                        &app,
                        last.model_path,
                        Some(last.context),
                        last.projection_path,
                        // The adapter the PC user chose (never one from the phone).
                        last.lora_path.map(|p| (p, last.lora_scale.unwrap_or(1.0))),
                        crate::model_server::StartedBy::Phone,
                    )
                    .await
                    {
                        Ok(_) => serde_json::json!({"ok": true}),
                        Err(error) => serde_json::json!({"ok": false, "error": error}),
                    },
                }
            };
            reply(&mut send, answer).await;
        }
        Some(Request::Sync) if paired => {
            use std::sync::atomic::Ordering;
            let link = app.state::<Link>();
            let turn = SyncTurn::take(&link.syncing, &remote);
            let answer = if !link.sync_allowed.load(Ordering::SeqCst) {
                serde_json::json!({"ok": false, "error": "Keeping in step is off on the PC (Settings → Use this PC's model from your phone)"}).to_string()
            } else if turn.is_none() {
                serde_json::json!({"ok": false, "error": "This device is already keeping in step; try again in a moment"}).to_string()
            } else {
                match recv.read_to_end(MAX_SYNC).await {
                    Err(_) => serde_json::json!({"ok": false, "error": "Too much to keep in step"}).to_string(),
                    Ok(body) => {
                        // The screens hold the prompt and memory: they merge
                        // and answer (src/services/sync/hostSync.web.ts).
                        let id = link.sync_next.fetch_add(1, Ordering::SeqCst);
                        let (tx, rx) = tokio::sync::oneshot::channel();
                        link.sync_waiting.lock().unwrap().insert(id, tx);
                        let name = load_phones(&app)
                            .into_iter()
                            .find(|p| p.id == remote)
                            .map(|p| p.name)
                            .unwrap_or_default();
                        use tauri::Emitter;
                        let _ = app.emit(
                            "link-sync",
                            serde_json::json!({"id": id, "device": name, "body": String::from_utf8_lossy(&body)}),
                        );
                        let reply = tokio::time::timeout(Duration::from_secs(30), rx).await;
                        link.sync_waiting.lock().unwrap().remove(&id);
                        match reply {
                            Ok(Ok(text)) => text,
                            _ => serde_json::json!({"ok": false, "error": "The PC app did not answer"}).to_string(),
                        }
                    }
                }
            };
            let _ = send.write_all(answer.as_bytes()).await;
        }
        Some(Request::Questions) if paired => {
            let questions = app.state::<crate::remote_ask::RemoteQuestions>();
            let answer = if !questions.allowed() {
                serde_json::json!({"ok": false, "error": OFF_ANSWERS})
            } else if !may_answer(&load_phones(&app), &remote) {
                serde_json::json!({"ok": false, "error": NOT_THIS_DEVICE})
            } else {
                serde_json::json!({"ok": true, "questions": questions.list()})
            };
            reply(&mut send, answer).await;
        }
        Some(Request::Answer { id, yes }) if paired => {
            let questions = app.state::<crate::remote_ask::RemoteQuestions>();
            let phones = load_phones(&app);
            let answer = if !questions.allowed() {
                serde_json::json!({"ok": false, "error": OFF_ANSWERS})
            } else if !may_answer(&phones, &remote) {
                serde_json::json!({"ok": false, "error": NOT_THIS_DEVICE})
            } else {
                let name = phones
                    .into_iter()
                    .find(|p| p.id == remote)
                    .map(|p| p.name)
                    .unwrap_or_else(|| "a device".into());
                if questions.answer(id, yes, &name) {
                    serde_json::json!({"ok": true})
                } else {
                    serde_json::json!({"ok": false, "error": "That question was already answered or has expired"})
                }
            };
            reply(&mut send, answer).await;
        }
        Some(Request::Picture { prompt, width, height, steps }) if paired => {
            let phones = load_phones(&app);
            if !pictures_allowed(&app) {
                reply(&mut send, serde_json::json!({"ok": false, "error": OFF_PICTURES})).await;
            } else if !may_picture(&phones, &remote) {
                reply(&mut send, serde_json::json!({"ok": false, "error": NOT_THIS_DEVICE_PICTURES})).await;
            } else {
                let name = phones
                    .into_iter()
                    .find(|p| p.id == remote)
                    .map(|p| p.name)
                    .unwrap_or_else(|| "a device".into());
                // Nothing more is read from the device on this stream.
                let _ = recv.stop(0u32.into());
                match picture_for(&app, &name, (prompt, width, height, steps), &mut send).await {
                    Ok((header, png)) => {
                        reply(&mut send, header).await;
                        let _ = send.write_all(&png).await;
                    }
                    Err(error) => {
                        // Never this PC's paths (sd-cli's last lines name them).
                        let error = error_for_device(&app, &error);
                        reply(&mut send, serde_json::json!({"ok": false, "error": error})).await;
                    }
                }
            }
        }
        Some(Request::Tool { name, chat, args }) if paired => {
            let phones = load_phones(&app);
            let may = DeviceMay {
                read: may_read(&phones, &remote),
                act: may_act(&phones, &remote),
                command: may_command(&phones, &remote),
                write: may_write(&phones, &remote),
            };
            let checked = check_tool(tools_allowed(&app), may, &name, &chat, &args);
            let answer = match checked {
                Err(error) => Err(error),
                Ok(call) => {
                    let device = phones
                        .into_iter()
                        .find(|p| p.id == remote)
                        .map(|p| p.name)
                        .unwrap_or_else(|| "a device".into());
                    // The text a device writes follows the request line:
                    // read only now, after every check, exactly as long as
                    // announced.
                    let text = match &call {
                        RemoteCall::Write { bytes, .. } => read_text(&mut recv, *bytes).await,
                        _ => Ok(String::new()),
                    };
                    // Nothing more is read from the device on this stream.
                    let _ = recv.stop(0u32.into());
                    match text {
                        Err(error) => Err(error),
                        Ok(text) => tool_for(&app, &remote, &device, &chat, call, text, args.thinking.as_deref()).await,
                    }
                }
            };
            // A JSON line saying how long the answer is, then the answer.
            match answer.and_then(|value| {
                let body = value.to_string();
                if body.len() > MAX_TOOL_ANSWER {
                    Err("The answer is too large to send".to_string())
                } else {
                    Ok(body)
                }
            }) {
                Ok(body) => {
                    reply(&mut send, serde_json::json!({"ok": true, "bytes": body.len()})).await;
                    let _ = send.write_all(body.as_bytes()).await;
                }
                Err(error) => {
                    // Never this PC's paths (a file error may name them).
                    let error = error_for_device(&app, &error);
                    reply(&mut send, serde_json::json!({"ok": false, "error": error})).await
                }
            }
        }
        Some(Request::Removal { notices }) if paired => {
            // Each checked: signed by a device this PC trusts, new, in
            // time, not about this PC; it can only remove.
            take_removals(&app, &remote, false, &notices);
            reply(&mut send, serde_json::json!({"ok": true})).await;
        }
        Some(Request::Http) if paired => {
            let Some((port, _)) = app.state::<crate::model_server::ModelServer>().address() else {
                reply(&mut send, serde_json::json!({"ok": false, "error": "no model running"})).await;
                return Ok(());
            };
            reply(&mut send, serde_json::json!({"ok": true})).await;
            // One request per stream, read whole and checked before a byte
            // reaches the model server: a model request with the model's
            // current password (anything else, e.g. another app on the
            // phone that found the phone's local port, is refused), a plain
            // Content-Length body, pictures inline only, nothing after it.
            // The model server closes after answering, and so does the
            // phone's local port, so the next request comes on a new stream
            // and is checked the same way.
            let (_, key) = app.state::<crate::model_server::ModelServer>().address().unwrap_or_default();
            let (request, body) = match tokio::time::timeout(REQUEST_TIME, read_request(&mut recv, &mut send, &key)).await {
                Ok(Ok(checked)) => checked,
                Ok(Err(why)) => {
                    let _ = send.write_all(&forbidden(why)).await;
                    let _ = send.finish();
                    return Ok(());
                }
                Err(_) => {
                    let _ = send.write_all(&forbidden("The request took too long")).await;
                    let _ = send.finish();
                    return Ok(());
                }
            };
            // Nothing more is read from the device on this stream.
            let _ = recv.stop(0u32.into());
            // Only ever this PC's own model server.
            let tcp = tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .map_err(|e| e.to_string())?;
            let (mut from_model, mut to_model) = tcp.into_split();
            tokio::io::AsyncWriteExt::write_all(&mut to_model, &request.head)
                .await
                .map_err(|e| e.to_string())?;
            tokio::io::AsyncWriteExt::write_all(&mut to_model, &body)
                .await
                .map_err(|e| e.to_string())?;
            // The answer (streamed as it comes, for chats that stream).
            let _ = tokio::io::copy(&mut from_model, &mut send).await;
            let _ = send.finish();
        }
        _ if paired => {
            reply(&mut send, serde_json::json!({"ok": false, "error": "not allowed"})).await;
        }
        _ => {
            reply(&mut send, serde_json::json!({"ok": false, "error": "not paired"})).await;
        }
    }
    let _ = send.finish();
    Ok(())
}

/// This PC's endpoint with its link key, made once. While the link is off,
/// it takes no devices' connections (no protocol offered, and refused).
async fn bind(app: &AppHandle, running: &mut Option<iroh::protocol::Router>) -> Result<iroh::Endpoint, String> {
    if let Some(router) = running.as_ref() {
        return Ok(router.endpoint().clone());
    }
    let link = app.state::<Link>();
    let endpoint = iroh::Endpoint::builder(iroh::endpoint::presets::N0)
        .secret_key(secret_key(app)?)
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(|e| e.to_string())?;
    let on = link.on.clone();
    let router = iroh::protocol::Router::builder(endpoint.clone())
        .incoming_filter(std::sync::Arc::new(move |_| {
            if on.load(std::sync::atomic::Ordering::SeqCst) {
                iroh::protocol::IncomingFilterOutcome::Accept
            } else {
                iroh::protocol::IncomingFilterOutcome::Reject
            }
        }))
        .accept(ALPN, Handler { app: app.clone() })
        .spawn();
    if !link.is_on() {
        endpoint.set_alpns(Vec::new());
    }
    *running = Some(router);
    Ok(endpoint)
}

async fn start(app: &AppHandle) -> Result<String, String> {
    let link = app.state::<Link>();
    let mut running = link.running.lock().await;
    let endpoint = bind(app, &mut running).await?;
    link.on.store(true, std::sync::atomic::Ordering::SeqCst);
    endpoint.set_alpns(vec![ALPN.to_vec()]);
    Ok(endpoint.id().to_string())
}

/// One key per PC (device-circle stage 1): this PC's own link endpoint, for
/// use as a device of another PC (link_client.rs). Made if needed; while
/// the link is off it still lets no device in.
pub async fn device_endpoint(app: &AppHandle) -> Result<iroh::Endpoint, String> {
    let link = app.state::<Link>();
    let mut running = link.running.lock().await;
    let endpoint = bind(app, &mut running).await?;
    link.shared.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(endpoint)
}

/// This PC's link key, public half (no endpoint needed).
pub fn link_key_id(app: &AppHandle) -> Result<String, String> {
    Ok(secret_key(app)?.public().to_string())
}

// ------------------------------------------------------------- commands

/// Switches the link on (if it was off) and makes a fresh pairing QR code.
#[tauri::command]
pub async fn link_pair(app: AppHandle) -> Result<Pairing, String> {
    let id = start(&app).await?;
    let code = random_hex(16)?;
    *app.state::<Link>().pair_code.lock().unwrap() = Some(PairCode::new(code.clone()));
    // Paired phones will see that a code was made (and when).
    record(&app, "code", None);
    let qr = qr_text(&id, &code);
    Ok(Pairing {
        qr_image: qr_image(&qr)?,
        qr,
        expires_in_secs: PAIR_CODE_LIFETIME.as_secs(),
    })
}

/// Switches the link on for already paired phones (no new pairing).
/// The user's switch on this PC: may paired devices keep in step?
#[tauri::command(async)]
pub fn link_sync_allow(link: State<'_, Link>, allowed: bool) {
    link.sync_allowed.store(allowed, std::sync::atomic::Ordering::SeqCst);
}

/// The screens' answer to a sync (the agreed items, as JSON).
#[tauri::command(async)]
pub fn link_sync_reply(link: State<'_, Link>, id: u64, body: String) -> Result<(), String> {
    if body.len() > MAX_SYNC {
        return Err("Too much to keep in step".into());
    }
    match link.sync_waiting.lock().unwrap().remove(&id) {
        Some(tx) => {
            let _ = tx.send(body);
            Ok(())
        }
        None => Err("That sync is no longer waiting".into()),
    }
}

#[tauri::command]
pub async fn link_on(app: AppHandle) -> Result<(), String> {
    start(&app).await.map(|_| ())
}

#[tauri::command]
pub async fn link_off(link: State<'_, Link>) -> Result<(), String> {
    *link.pair_code.lock().unwrap() = None;
    let mut running = link.running.lock().await;
    link.on.store(false, std::sync::atomic::Ordering::SeqCst);
    if link.shared.load(std::sync::atomic::Ordering::SeqCst) {
        // This PC uses the same endpoint as a device: it stays, but offers
        // no protocol and refuses devices; what they have open ends now.
        if let Some(router) = running.as_ref() {
            router.endpoint().set_alpns(Vec::new());
        }
        link.cut_off_all();
    } else if let Some(router) = running.take() {
        let _ = router.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn link_status(app: AppHandle, link: State<'_, Link>) -> Result<LinkStatus, String> {
    let running = link.running.lock().await;
    let on = running.is_some() && link.is_on();
    Ok(LinkStatus {
        on,
        pictures_allowed: pictures_allowed(&app),
        tools_allowed: tools_allowed(&app),
        pc_id: running.as_ref().filter(|_| on).map(|r| r.endpoint().id().to_string()),
        phones: load_phones(&app),
        events: load_events(&app),
    })
}

/// Removes a paired phone: it can't connect any more, and what it has open
/// (a model request, a sync) is cut off at once.
#[tauri::command]
pub async fn link_forget(app: AppHandle, id: String) -> Result<(), String> {
    forget_here(&app, &id, "removed")
}

/// Removing a device here, by the user ("removed") or by a removal notice
/// ("removed-by-notice"): the same every time. Its record goes, its open
/// connections close at once, it can't ask to pair again for an hour, its
/// chats' reading rights go, and the pairing history says so.
fn forget_here(app: &AppHandle, id: &str, kind: &str) -> Result<(), String> {
    let mut phones = load_phones(app);
    let name = phones.iter().find(|p| p.id == id).map(|p| p.name.clone());
    phones.retain(|p| p.id != id);
    save_phones(app, &phones)?;
    let link = app.state::<Link>();
    link.removed.lock().unwrap().insert(id.to_string(), Instant::now());
    link.cut_off(id);
    link.read_grants.lock().unwrap().forget_device(id);
    record(app, kind, name);
    Ok(())
}

/// The screens' circle calls (circle_call): JSON in, JSON out.
#[tauri::command]
pub async fn link_circle(app: AppHandle, request: String) -> String {
    circle_call(&app, &request).to_string()
}

/// Lets one paired device answer this PC's "Allow?" questions, or stops
/// it. Letting it is asked on this PC (a native dialog no device can
/// answer); paired devices see it in the pairing history. Stopping it
/// asks nothing.
#[tauri::command]
pub async fn link_device_may_answer(app: AppHandle, id: String, allowed: bool) -> Result<(), String> {
    const NOT_PAIRED: &str = "That device is not paired with this PC";
    let name = load_phones(&app)
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.name)
        .ok_or(NOT_PAIRED)?;
    if allowed {
        let key: String = id.chars().take(16).collect();
        let question = format!(
            "Let \u{201c}{name}\u{201d} answer this PC's \u{201c}Allow?\u{201d} questions?\n\nWhile answering is on, it will see each question this PC asks (commands to run, files, pages) and can allow it once or refuse it, from anywhere. Only allow a device you own and keep locked.\n\nDevice key: {key}"
        );
        if !crate::approval::ask_on_this_pc(&app, &question).await {
            return Err("Not allowed on this PC".into());
        }
    }
    // Read again after the dialog (the list may have changed meanwhile).
    let mut phones = load_phones(&app);
    if !set_may_answer(&mut phones, &id, allowed) {
        return Err(NOT_PAIRED.into());
    }
    save_phones(&app, &phones)?;
    if allowed {
        record(&app, "may-answer", Some(name));
    }
    Ok(())
}

/// The PC's switch: may paired devices ask for pictures at all? (Each
/// device must be allowed too: link_device_may_picture, asked here.)
#[tauri::command]
pub async fn link_pictures_allow(app: AppHandle, allowed: bool) -> Result<(), String> {
    write_entry(&app, PICTURES_ENTRY, if allowed { "on" } else { "off" })
}

/// Lets one paired device ask this PC for pictures, or stops it. Letting
/// it is asked on this PC (a native dialog no device can answer); paired
/// devices see it in the pairing history. Stopping it asks nothing.
#[tauri::command]
pub async fn link_device_may_picture(app: AppHandle, id: String, allowed: bool) -> Result<(), String> {
    const NOT_PAIRED: &str = "That device is not paired with this PC";
    let name = load_phones(&app)
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.name)
        .ok_or(NOT_PAIRED)?;
    if allowed {
        let key: String = id.chars().take(16).collect();
        let question = format!(
            "Let \u{201c}{name}\u{201d} make pictures on this PC?\n\nWhile pictures are on, it can ask this PC to make a picture from a text description, with the picture model downloaded here (the same limits and word check as here, one picture at a time; a copy stays in the workspace's images folder). This PC shows a notification each time.\n\nDevice key: {key}"
        );
        if !crate::approval::ask_on_this_pc(&app, &question).await {
            return Err("Not allowed on this PC".into());
        }
    }
    // Read again after the dialog (the list may have changed meanwhile).
    let mut phones = load_phones(&app);
    if !set_may_picture(&mut phones, &id, allowed) {
        return Err(NOT_PAIRED.into());
    }
    save_phones(&app, &phones)?;
    if allowed {
        record(&app, "may-picture", Some(name));
    }
    Ok(())
}

/// The PC's switch: may paired devices use this PC's tools at all? (Each
/// device must be allowed too: link_device_may_read, asked here.) Kept
/// across restarts; switching it off forgets every chat allowed to read.
#[tauri::command]
pub async fn link_tools_allow(app: AppHandle, allowed: bool) -> Result<(), String> {
    write_entry(&app, TOOLS_ENTRY, if allowed { "on" } else { "off" })?;
    if !allowed {
        app.state::<Link>().read_grants.lock().unwrap().clear();
    }
    Ok(())
}

/// Lets one paired device use this PC's read-only tools (PC info, the
/// workspace's files), or stops it. Letting it is asked on this PC (a
/// native dialog no device can answer); paired devices see it in the
/// pairing history. Stopping it asks nothing and forgets its chats.
#[tauri::command]
pub async fn link_device_may_read(app: AppHandle, id: String, allowed: bool) -> Result<(), String> {
    const NOT_PAIRED: &str = "That device is not paired with this PC";
    let name = load_phones(&app)
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.name)
        .ok_or(NOT_PAIRED)?;
    if allowed {
        let key: String = id.chars().take(16).collect();
        let question = format!(
            "Let \u{201c}{name}\u{201d} use this PC's tools?\n\nWhile this is on, it can ask for this PC's information (system, memory, disks, graphics) and, after this PC asks once per chat, list and read the text files and documents in DesktopAgent's workspace folder. Nothing outside the workspace, and nothing is changed or run. This PC shows a notification for each file read.\n\nDevice key: {key}"
        );
        if !crate::approval::ask_on_this_pc(&app, &question).await {
            return Err("Not allowed on this PC".into());
        }
    }
    // Read again after the dialog (the list may have changed meanwhile).
    let mut phones = load_phones(&app);
    if !set_may_read(&mut phones, &id, allowed) {
        return Err(NOT_PAIRED.into());
    }
    save_phones(&app, &phones)?;
    if allowed {
        record(&app, "may-read", Some(name));
    } else {
        app.state::<Link>().read_grants.lock().unwrap().forget_device(&id);
    }
    Ok(())
}

/// The question asked on this PC before a device may act here.
pub fn may_act_question(name: &str, key: &str) -> String {
    format!(
        "Let \u{201c}{name}\u{201d} ask to act on this PC?\n\nWhile this is on, it can ask this PC to open or print a file in DesktopAgent's workspace folder (documents, pictures, text and media; never programs or scripts), press a media key (play, pause, next, volume) or give it the text on the clipboard. This PC asks you every time, naming the device, before anything is done (a device that may answer this PC's questions can answer it, this one too). This PC shows a notification for each.\n\nDevice key: {key}"
    )
}

/// Lets one paired device ask this PC to act (ACT_TOOLS: open or print a
/// workspace file, a media key, the clipboard; each still asks here every
/// time), or stops it. Letting it is asked on this PC (a native dialog no
/// device can answer); paired devices see it in the pairing history.
/// Stopping it asks nothing.
#[tauri::command]
pub async fn link_device_may_act(app: AppHandle, id: String, allowed: bool) -> Result<(), String> {
    const NOT_PAIRED: &str = "That device is not paired with this PC";
    let name = load_phones(&app)
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.name)
        .ok_or(NOT_PAIRED)?;
    if allowed {
        let key: String = id.chars().take(16).collect();
        let question = may_act_question(&name, &key);
        if !crate::approval::ask_on_this_pc(&app, &question).await {
            return Err("Not allowed on this PC".into());
        }
    }
    // Read again after the dialog (the list may have changed meanwhile).
    let mut phones = load_phones(&app);
    if !set_may_act(&mut phones, &id, allowed) {
        return Err(NOT_PAIRED.into());
    }
    save_phones(&app, &phones)?;
    if allowed {
        record(&app, "may-act", Some(name));
    }
    Ok(())
}

/// The question asked on this PC before a device may ask to run commands
/// here (a strong warning: a command can do anything the user can).
pub fn may_command_question(name: &str, key: &str) -> String {
    format!(
        "Let \u{201c}{name}\u{201d} ask to run commands on this PC?\n\nWARNING: with this on, \u{201c}{name}\u{201d} can run anything you can on this PC, after you allow each command. A command can read, change or delete your files, install programs or send your data anywhere.\n\nEach command is shown whole in this PC's \u{201c}Allow?\u{201d} window, naming the device, every time (never \u{201c}always\u{201d}); it runs in DesktopAgent's workspace folder and is stopped after 60 seconds. A device that may answer this PC's questions can answer it, this one too. This PC shows a notification for each command and keeps every one in its log.\n\nOnly allow this for a device you keep locked and with you.\n\nDevice key: {key}"
    )
}

/// Lets one paired device ask this PC to run commands (COMMAND_TOOLS; each
/// still shown whole and asked here every time), or stops it. Letting it
/// is asked on this PC (a native dialog no device can answer); paired
/// devices see it in the pairing history. Stopping it asks nothing.
#[tauri::command]
pub async fn link_device_may_command(app: AppHandle, id: String, allowed: bool) -> Result<(), String> {
    const NOT_PAIRED: &str = "That device is not paired with this PC";
    let name = load_phones(&app)
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.name)
        .ok_or(NOT_PAIRED)?;
    if allowed {
        let key: String = id.chars().take(16).collect();
        let question = may_command_question(&name, &key);
        if !crate::approval::ask_on_this_pc(&app, &question).await {
            return Err("Not allowed on this PC".into());
        }
    }
    // Read again after the dialog (the list may have changed meanwhile).
    let mut phones = load_phones(&app);
    if !set_may_command(&mut phones, &id, allowed) {
        return Err(NOT_PAIRED.into());
    }
    save_phones(&app, &phones)?;
    if allowed {
        record(&app, "may-command", Some(name));
    }
    Ok(())
}

/// The question asked on this PC before a device may ask to write in the
/// workspace here.
pub fn may_write_question(name: &str, key: &str) -> String {
    format!(
        "Let \u{201c}{name}\u{201d} ask to write in this PC's workspace?\n\nWhile this is on, it can ask to make or change text files (.txt, .md, .csv, .json, .xml, .html, .log) in DesktopAgent's workspace folder, add text at their end, or undo its last change; never programs or scripts, nothing outside the workspace, nothing deleted. This PC shows you each change before and after and asks you every time, naming the device (never \u{201c}always\u{201d}; a device that may answer this PC's questions can answer it, this one too). The previous version of each file is kept so a change can be undone. This PC shows a notification for each change.\n\nDevice key: {key}"
    )
}

/// Lets one paired device ask this PC to write in its workspace
/// (WRITE_TOOLS; each change still shown and asked here every time), or
/// stops it. Letting it is asked on this PC (a native dialog no device can
/// answer); paired devices see it in the pairing history. Stopping it asks
/// nothing.
#[tauri::command]
pub async fn link_device_may_write(app: AppHandle, id: String, allowed: bool) -> Result<(), String> {
    const NOT_PAIRED: &str = "That device is not paired with this PC";
    let name = load_phones(&app)
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.name)
        .ok_or(NOT_PAIRED)?;
    if allowed {
        let key: String = id.chars().take(16).collect();
        let question = may_write_question(&name, &key);
        if !crate::approval::ask_on_this_pc(&app, &question).await {
            return Err("Not allowed on this PC".into());
        }
    }
    // Read again after the dialog (the list may have changed meanwhile).
    let mut phones = load_phones(&app);
    if !set_may_write(&mut phones, &id, allowed) {
        return Err(NOT_PAIRED.into());
    }
    save_phones(&app, &phones)?;
    if allowed {
        record(&app, "may-write", Some(name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_model_requests_with_the_password_pass() {
        let ok = b"POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer k1\r\n\r\n";
        assert!(check_head(ok, "k1").is_ok());
        let health = b"GET /health HTTP/1.1\r\nauthorization:  Bearer k1 \r\n\r\n";
        assert!(check_head(health, "k1").is_ok());
        // No password, a wrong one, or none set on the PC: refused.
        assert!(check_head(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n", "k1").is_err());
        assert!(check_head(b"GET /health HTTP/1.1\r\nAuthorization: Bearer nope\r\n\r\n", "k1").is_err());
        assert!(check_head(b"GET /health HTTP/1.1\r\nAuthorization: Bearer \r\n\r\n", "").is_err());
        // Anything but the model's requests: refused, even with the password.
        for bad in ["GET /slots", "POST /slots/0?action=save", "GET /metrics", "POST /v1/chat/completions/../../x", "DELETE /v1/models"] {
            let head = format!("{bad} HTTP/1.1\r\nAuthorization: Bearer k1\r\n\r\n");
            assert!(check_head(head.as_bytes(), "k1").is_err(), "{bad}");
        }
    }

    #[test]
    fn one_request_per_stream_and_the_server_closes_after_it() {
        let head = b"POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer k1\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5\r\nContent-Length: 12\r\n\r\n";
        let r = prepare_head(head, "k1").unwrap();
        let text = String::from_utf8(r.head.clone()).unwrap();
        assert_eq!(r.body_len, 12);
        assert_eq!(r.path, "/v1/chat/completions");
        assert!(!r.expect_continue);
        assert!(text.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
        assert!(text.ends_with("Content-Length: 12\r\nConnection: close\r\n\r\n"));
        assert!(text.contains("Authorization: Bearer k1\r\n"));
        assert!(!text.to_ascii_lowercase().contains("keep-alive"));
        assert_eq!(text.matches("Connection:").count(), 1);
        // A GET with no body stays without one.
        let get = prepare_head(b"GET /health HTTP/1.1\r\nAuthorization: Bearer k1\r\n\r\n", "k1").unwrap();
        assert_eq!(get.body_len, 0);
        assert!(!String::from_utf8(get.head).unwrap().contains("Content-Length"));
        // A POST with no length gets an empty body, said out loud.
        let post = prepare_head(b"POST /v1/completions HTTP/1.1\r\nAuthorization: Bearer k1\r\n\r\n", "k1").unwrap();
        assert!(String::from_utf8(post.head).unwrap().contains("Content-Length: 0\r\n"));
        // "100 Continue" is answered here, not by the server.
        let expect = prepare_head(
            b"POST /v1/completions HTTP/1.1\r\nAuthorization: Bearer k1\r\nExpect: 100-continue\r\nContent-Length: 2\r\n\r\n",
            "k1",
        )
        .unwrap();
        assert!(expect.expect_continue);
        assert!(!String::from_utf8(expect.head).unwrap().contains("Expect"));
    }

    #[test]
    fn bodies_that_could_hide_a_second_request_are_refused() {
        let with = |extra: &str| {
            format!("POST /v1/chat/completions HTTP/1.1\r\nAuthorization: Bearer k1\r\n{extra}\r\n")
        };
        for bad in [
            "Transfer-Encoding: chunked\r\n",
            "transfer-encoding: identity\r\n",
            "Content-Length: 5\r\nContent-Length: 6\r\n",
            "Content-Length: -1\r\n",
            "Content-Length: 0x10\r\n",
            "Content-Length: \r\n",
            "X: a\nTransfer-Encoding: chunked\r\n",
            "X: a\rb\r\n",
            " folded: line\r\n",
            "Bad Name: x\r\n",
            "no colon\r\n",
        ] {
            assert!(prepare_head(with(bad).as_bytes(), "k1").is_err(), "{bad:?}");
        }
        let too_big = format!("Content-Length: {}\r\n", MAX_BODY + 1);
        assert!(prepare_head(with(&too_big).as_bytes(), "k1").is_err());
        let biggest = format!("Content-Length: {MAX_BODY}\r\n");
        assert!(prepare_head(with(&biggest).as_bytes(), "k1").is_ok());
        // Only HTTP/1.x, and the checks of check_head still apply.
        assert!(prepare_head(b"GET /health HTTP/2\r\nAuthorization: Bearer k1\r\n\r\n", "k1").is_err());
        assert!(prepare_head(b"GET /health  HTTP/1.1\r\nAuthorization: Bearer k1\r\n\r\n", "k1").is_err());
        assert!(prepare_head(b"GET /slots HTTP/1.1\r\nAuthorization: Bearer k1\r\n\r\n", "k1").is_err());
        assert!(prepare_head(b"GET /health HTTP/1.1\r\n\r\n", "k1").is_err());
    }

    #[test]
    fn pictures_sound_and_video_must_be_inline() {
        let chat = |part: serde_json::Value| {
            serde_json::json!({"model": "m", "messages": [
                {"role": "system", "content": "Fetch http://example.com if asked"},
                {"role": "user", "content": [{"type": "text", "text": "see https://x.y"}, part]},
            ]})
            .to_string()
        };
        let ok = [
            serde_json::json!({"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}),
            serde_json::json!({"type": "image_url", "image_url": "data:image/jpeg;base64,AAAA"}),
            serde_json::json!({"type": "input_audio", "input_audio": {"data": "AAAA", "format": "wav"}}),
            serde_json::json!({"type": "text", "text": "url: http://192.168.1.1"}),
        ];
        for part in ok {
            assert!(check_body("/v1/chat/completions", chat(part.clone()).as_bytes()).is_ok(), "{part}");
        }
        let bad = [
            serde_json::json!({"type": "image_url", "image_url": {"url": "http://192.168.1.50/snapshot.jpg"}}),
            serde_json::json!({"type": "image_url", "image_url": {"url": "HTTPS://169.254.169.254/"}}),
            serde_json::json!({"type": "image_url", "image_url": {"url": " data:x"}}),
            serde_json::json!({"type": "image_url", "image_url": "file:///etc/passwd"}),
            serde_json::json!({"type": "video_url", "video_url": {"url": "http://x/v.mp4"}}),
            serde_json::json!({"type": "input_audio", "input_audio": {"url": "http://x/a.wav"}}),
            serde_json::json!({"type": "input_audio", "input_audio": "http://x/a.wav"}),
            serde_json::json!({"type": "x", "deep": [{"URL": "http://x"}]}),
        ];
        for part in bad {
            assert!(check_body("/v1/chat/completions", chat(part.clone()).as_bytes()).is_err(), "{part}");
            assert!(check_body("/chat/completions", chat(part.clone()).as_bytes()).is_err(), "{part}");
        }
        // Completions: a prompt with media follows the same rule.
        let prompt = serde_json::json!({"prompt": {"prompt_string": "x", "image_url": "http://x"}}).to_string();
        assert!(check_body("/v1/completions", prompt.as_bytes()).is_err());
        assert!(check_body("/completions", br#"{"prompt": "plain text http://x"}"#).is_ok());
        // Tools may describe a "url" parameter (a schema, not a picture).
        let tools = serde_json::json!({
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [{"type": "function", "function": {"name": "open", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}}}}],
        })
        .to_string();
        assert!(check_body("/v1/chat/completions", tools.as_bytes()).is_ok());
        // Not JSON: refused. Other requests have no body to check.
        assert!(check_body("/v1/chat/completions", b"{not json").is_err());
        assert!(check_body("/health", b"").is_ok());
        let refusal = String::from_utf8(forbidden("no")).unwrap();
        assert!(refusal.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert!(refusal.contains("Connection: close"));
    }

    #[test]
    fn one_sync_at_a_time_per_device() {
        let set = Mutex::new(std::collections::HashSet::new());
        let first = SyncTurn::take(&set, "a").unwrap();
        assert!(SyncTurn::take(&set, "a").is_none());
        assert!(SyncTurn::take(&set, "b").is_some());
        drop(first);
        assert!(SyncTurn::take(&set, "a").is_some());
    }

    #[test]
    fn a_removed_device_is_kept_out_of_pairing_for_an_hour() {
        let link = Link::default();
        assert!(!link.recently_removed("a"));
        link.removed.lock().unwrap().insert("a".into(), Instant::now());
        assert!(link.recently_removed("a"));
        link.removed
            .lock()
            .unwrap()
            .insert("b".into(), Instant::now() - REMOVED_LOCKOUT - Duration::from_secs(1));
        assert!(!link.recently_removed("b"));
        // Cutting off a device with nothing open is harmless.
        link.cut_off("a");
    }

    #[test]
    fn requests_are_one_small_json_line() {
        assert_eq!(parse_request(br#"{"op":"status"}"#), Some(Request::Status));
        assert_eq!(parse_request(br#"{"op":"http"}"#), Some(Request::Http));
        assert_eq!(parse_request(br#"{"op":"start"}"#), Some(Request::Start));
        assert_eq!(parse_request(br#"{"op":"sync"}"#), Some(Request::Sync));
        assert_eq!(parse_request(br#"{"op":"questions"}"#), Some(Request::Questions));
        assert_eq!(
            parse_request(br#"{"op":"answer","id":3,"yes":true}"#),
            Some(Request::Answer { id: 3, yes: true })
        );
        // An answer must say which question and yes or no, nothing else.
        assert_eq!(parse_request(br#"{"op":"answer","id":3}"#), None);
        assert_eq!(parse_request(br#"{"op":"answer","id":3,"yes":"always"}"#), None);
        // "start" takes nothing from the phone: any file it names is ignored.
        assert_eq!(
            parse_request(br#"{"op":"start","model":"C:/x.gguf"}"#),
            Some(Request::Start)
        );
        assert_eq!(
            parse_request(br#"{"op":"pair","code":"ab","name":"Pixel"}"#),
            Some(Request::Pair { code: "ab".into(), name: "Pixel".into() })
        );
        // "picture": a prompt, and at most sizes and steps; a model or a
        // path the device names is ignored (the PC uses its own).
        assert_eq!(
            parse_request(br#"{"op":"picture","prompt":"a cat","width":512,"height":768,"steps":4}"#),
            Some(Request::Picture { prompt: "a cat".into(), width: Some(512), height: Some(768), steps: Some(4) })
        );
        assert_eq!(
            parse_request(br#"{"op":"picture","prompt":"a cat","model":"C:/x.gguf","out":"C:/y.png"}"#),
            Some(Request::Picture { prompt: "a cat".into(), width: None, height: None, steps: None })
        );
        assert_eq!(parse_request(br#"{"op":"picture"}"#), None);
        assert_eq!(parse_request(br#"{"op":"picture","prompt":"a","width":-1}"#), None);
        assert_eq!(parse_request(br#"{"op":"files"}"#), None);
        assert_eq!(parse_request(b"GET / HTTP/1.1"), None);
        assert_eq!(parse_request(&vec![b' '; MAX_REQUEST_LINE + 1]), None);
    }

    /// Device circle stage 2: "removal" carries notices only, each exactly
    /// a notice (no device to add, no right, no name).
    #[test]
    fn a_removal_request_is_notices_and_nothing_else() {
        let key = iroh::SecretKey::from_bytes(&[7; 32]);
        let removed = iroh::SecretKey::from_bytes(&[8; 32]).public().to_string();
        let notice = circle::sign_removal(&key, &removed, 5, 1_800_000_000).unwrap();
        let line = serde_json::json!({"op": "removal", "notices": [notice]}).to_string();
        assert!(line.len() < MAX_REQUEST_LINE);
        assert_eq!(parse_request(line.as_bytes()), Some(Request::Removal { notices: vec![notice.clone()] }));
        // A notice with more in it (a right, a device to add) is no request.
        let mut more = serde_json::to_value(&notice).unwrap();
        more["mayCommand"] = serde_json::json!(true);
        let line = serde_json::json!({"op": "removal", "notices": [more]}).to_string();
        assert_eq!(parse_request(line.as_bytes()), None);
        assert_eq!(parse_request(br#"{"op":"removal"}"#), None);
        // The most a device hands on at once fits in one request line.
        let many: Vec<_> = (0..circle::MAX_NOTICES as u64)
            .map(|n| circle::sign_removal(&key, &removed, n + 1, u64::MAX / 2).unwrap())
            .collect();
        assert!(serde_json::json!({"op": "removal", "notices": many}).to_string().len() < MAX_REQUEST_LINE);
    }

    /// A notice taken here removes exactly as "Remove here" does (one
    /// function: cut off, kept from pairing for an hour, history), and can
    /// only remove: nothing on its path adds a device or sets a right.
    #[test]
    fn a_removal_notice_only_removes_as_remove_here_does() {
        // The Windows checkout has "\r\n" line ends; compare with "\n".
        let source = &include_str!("link.rs").replace("\r\n", "\n");
        let code = &source[..source.find("#[cfg(test)]").unwrap()];
        let forget = &code[code.find("pub async fn link_forget(").unwrap()..];
        let forget = &forget[..forget.find("\n}").unwrap()];
        assert!(forget.contains("forget_here(&app, &id, \"removed\")"));
        let here = &code[code.find("fn forget_here(").unwrap()..];
        let here = &here[..here.find("\n}").unwrap()];
        for step in ["phones.retain(|p| p.id != id);", "link.removed.lock().unwrap().insert(", "link.cut_off(id);", "forget_device(id);", "record(app, kind, name);"] {
            assert!(here.contains(step), "{step}");
        }
        let circle_code = &code[code.find("// ------------------------------------------------- device circle, stage 2").unwrap()..code.find("/// Which commit this PC app was built from").unwrap()];
        for never in ["add_phone(", "Phone::new(", "set_may_", "write_entry(app, PICTURES_ENTRY", "write_entry(app, TOOLS_ENTRY", "sync_allowed", "ask_on_this_pc"] {
            assert!(!circle_code.contains(never), "{never}");
        }
        // Applying is only ever after the check said so.
        assert_eq!(circle_code.matches("apply_removal(app, state, notice)").count(), 1);
        assert!(circle_code.contains("if state.take(notice, &me, &trusted, Some(from), circle::now()) == circle::Verdict::Apply {\n                apply_removal(app, state, notice);"));
        assert!(circle_code.contains("forget_here(app, &notice.removed, \"removed-by-notice\")"));
        // Paired devices only, at most MAX_NOTICES at once.
        assert!(code.contains("Some(Request::Removal { notices }) if paired => {"));
        assert!(circle_code.contains("notices.iter().take(circle::MAX_NOTICES)"));
    }

    #[test]
    fn the_user_is_told_who_removed_what() {
        assert_eq!(
            removal_note(Some("Laptop"), Some("Pixel 8")),
            "\u{201c}Laptop\u{201d} removed \u{201c}Pixel 8\u{201d} from your devices; removed here too."
        );
        assert!(removal_note(None, None).contains("Another of your devices"));
    }

    /// The circle's state is kept in parts small enough for a credential
    /// (UTF-16), never split inside a character, and shrunk to fit.
    #[test]
    fn the_circle_state_fits_the_credential_store() {
        let parts = split_parts("ab\u{1F600}cd", 3);
        assert_eq!(parts, ["ab", "\u{1F600}c", "d"]);
        assert_eq!(parts.concat(), "ab\u{1F600}cd");
        assert!(split_parts("", 3).is_empty());
        let key = iroh::SecretKey::from_bytes(&[7; 32]);
        let mut state = circle::State::default();
        for i in 0..40u8 {
            let removed = iroh::SecretKey::from_bytes(&[100 + i; 32]).public().to_string();
            state.sign(&key, &removed, 1_800_000_000).unwrap();
            state.seen.push((removed.clone(), 1));
            state.uses.push(removed.clone());
            state.add_news(circle::News {
                removed: removed.clone(),
                by: removed,
                at: 1,
                removed_name: Some("\u{1F600}".repeat(40)),
                by_name: Some("Laptop".into()),
                told: false,
            });
        }
        let parts = fit_circle(&mut state);
        assert!(parts.len() <= CIRCLE_PARTS);
        assert!(parts.iter().all(|p| p.encode_utf16().count() <= CIRCLE_PART_UNITS));
        // Within Windows' limit for one credential (2560 bytes of UTF-16).
        assert!(CIRCLE_PART_UNITS * 2 <= 2560);
        assert_eq!(circle::State::from_json(&parts.concat()), state);
        assert_eq!(state.outbox.len(), circle::MAX_OUTBOX);
    }

    #[test]
    fn a_pairing_code_works_once_and_only_when_right() {
        let slot = Mutex::new(Some(PairCode::new("abc123".into())));
        for _ in 0..=PAIR_CODE_WRONG_TRIES {
            assert!(!try_code(&slot, "wrong!"));
        }
        // Too many wrong tries: even the right code fails now.
        assert!(slot.lock().unwrap().is_none());
        assert!(!try_code(&slot, "abc123"));
        let slot = Mutex::new(Some(PairCode::new("abc123".into())));
        assert!(try_code(&slot, "abc123"));
        assert!(!try_code(&slot, "abc123"));
        let empty = Mutex::new(None);
        assert!(!try_code(&empty, ""));
    }

    #[test]
    fn an_old_code_has_expired() {
        let old = PairCode {
            code: "abc".into(),
            made: Instant::now() - PAIR_CODE_LIFETIME - Duration::from_secs(1),
            wrong: 0,
        };
        assert!(!try_code(&Mutex::new(Some(old)), "abc"));
    }

    #[test]
    fn a_used_code_is_gone_for_good() {
        let slot = Mutex::new(Some(PairCode::new("c0ffee".into())));
        assert!(try_code(&slot, "c0ffee"));
        // Nothing is left to try against: a replay of the same code fails.
        assert!(slot.lock().unwrap().is_none());
        for _ in 0..3 {
            assert!(!try_code(&slot, "c0ffee"));
        }
    }

    #[test]
    fn an_expired_code_is_refused_and_used_up() {
        let expired = PairCode {
            code: "c0ffee".into(),
            made: Instant::now() - PAIR_CODE_LIFETIME,
            wrong: 0,
        };
        let slot = Mutex::new(Some(expired));
        assert!(!try_code(&slot, "c0ffee"));
        assert!(slot.lock().unwrap().is_none());
        // Still inside its 10 minutes: accepted.
        let fresh = PairCode {
            code: "c0ffee".into(),
            made: Instant::now() - PAIR_CODE_LIFETIME + Duration::from_secs(30),
            wrong: 0,
        };
        assert!(try_code(&Mutex::new(Some(fresh)), "c0ffee"));
    }

    #[test]
    fn a_new_code_replaces_the_old_one() {
        let slot = Mutex::new(Some(PairCode::new("old111".into())));
        *slot.lock().unwrap() = Some(PairCode::new("new222".into()));
        assert!(!try_code(&slot, "old111"));
        // The new code survives that wrong try.
        assert!(try_code(&slot, "new222"));
    }

    #[test]
    fn a_few_wrong_tries_from_new_keys_dont_burn_the_code() {
        // Each try could come from a fresh device key: counted all together.
        let slot = Mutex::new(Some(PairCode::new("c0ffee".into())));
        for _ in 0..PAIR_CODE_WRONG_TRIES {
            assert!(!try_code(&slot, "bad"));
            assert!(!try_code(&Mutex::new(None), "c0ffee"));
        }
        assert!(slot.lock().unwrap().is_some());
        assert!(try_code(&slot, "c0ffee"));
        assert!(slot.lock().unwrap().is_none());
        // The 4th wrong try uses it up.
        let slot = Mutex::new(Some(PairCode::new("c0ffee".into())));
        for _ in 0..=PAIR_CODE_WRONG_TRIES {
            assert!(!try_code(&slot, "bad"));
        }
        assert!(!try_code(&slot, "c0ffee"));
        // Wrong tries don't stretch its 10 minutes.
        let slot = Mutex::new(Some(PairCode {
            code: "c0ffee".into(),
            made: Instant::now() - PAIR_CODE_LIFETIME,
            wrong: 0,
        }));
        assert!(!try_code(&slot, "c0ffee"));
        assert!(slot.lock().unwrap().is_none());
    }

    #[test]
    fn codes_are_compared_whole() {
        assert!(same("abc123", "abc123"));
        assert!(!same("abc123", "abc12"));
        assert!(!same("abc12", "abc123"));
        assert!(!same("abc123", "abc124"));
        assert!(!same("abc123", "ABC123"));
        assert!(!same("", "abc123"));
        let slot = Mutex::new(Some(PairCode::new("abc123".into())));
        assert!(!try_code(&slot, "abc"));
        let slot = Mutex::new(Some(PairCode::new("abc123".into())));
        assert!(!try_code(&slot, ""));
    }

    #[test]
    fn names_are_cleaned_and_phones_capped() {
        assert_eq!(clean_name("Jo's Pixel 9"), "Jo's Pixel 9");
        assert_eq!(clean_name("<script>\n\u{202e}"), "script");
        assert_eq!(clean_name(""), "a phone");
        assert_eq!(clean_name(&"x".repeat(100)).len(), 40);
        let mut phones = Vec::new();
        for i in 0..(MAX_PHONES + 3) {
            add_phone(&mut phones, Phone { id: format!("{i}"), name: "p".into(), may_answer: false, may_picture: false, may_read: false, may_act: false, may_command: false, may_write: false, paired_at: None });
        }
        assert_eq!(phones.len(), MAX_PHONES);
        add_phone(&mut phones, Phone { id: "5".into(), name: "again".into(), may_answer: false, may_picture: false, may_read: false, may_act: false, may_command: false, may_write: false, paired_at: None });
        assert_eq!(phones.iter().filter(|p| p.id == "5").count(), 1);
    }

    #[test]
    fn each_device_may_answer_only_once_allowed() {
        // Saved before the field existed: not allowed.
        let old: Vec<Phone> = serde_json::from_str(r#"[{"id":"a","name":"Pixel"},{"id":"b","name":"Laptop"}]"#).unwrap();
        assert!(!may_answer(&old, "a") && !may_answer(&old, "b"));
        let mut phones = old;
        assert!(set_may_answer(&mut phones, "a", true));
        assert!(may_answer(&phones, "a") && !may_answer(&phones, "b"));
        assert!(!may_answer(&phones, "unknown"));
        assert!(!set_may_answer(&mut phones, "unknown", true));
        // Kept with the record; "off" is left out (the store is small).
        let json = serde_json::to_string(&phones).unwrap();
        assert_eq!(
            json,
            r#"[{"id":"a","name":"Pixel","mayAnswer":true},{"id":"b","name":"Laptop"}]"#
        );
        let back: Vec<Phone> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, phones);
        assert!(set_may_answer(&mut phones, "a", false));
        assert!(!may_answer(&phones, "a"));
        // Pairing again starts over (not allowed).
        add_phone(&mut phones, Phone { id: "a".into(), name: "Pixel".into(), may_answer: false, may_picture: false, may_read: false, may_act: false, may_command: false, may_write: false, paired_at: None });
        assert!(!may_answer(&phones, "a"));
    }

    #[test]
    fn each_device_may_make_pictures_only_once_allowed() {
        let old: Vec<Phone> = serde_json::from_str(r#"[{"id":"a","name":"Pixel","mayAnswer":true},{"id":"b","name":"Laptop"}]"#).unwrap();
        // Saved before the field existed (even a device that may answer): not allowed.
        assert!(!may_picture(&old, "a") && !may_picture(&old, "b"));
        let mut phones = old;
        assert!(set_may_picture(&mut phones, "b", true));
        assert!(may_picture(&phones, "b") && !may_picture(&phones, "a"));
        assert!(!may_picture(&phones, "unknown"));
        assert!(!set_may_picture(&mut phones, "unknown", true));
        // Each flag on its own.
        assert!(may_answer(&phones, "a") && !may_answer(&phones, "b"));
        let json = serde_json::to_string(&phones).unwrap();
        assert_eq!(
            json,
            r#"[{"id":"a","name":"Pixel","mayAnswer":true},{"id":"b","name":"Laptop","mayPicture":true}]"#
        );
        let back: Vec<Phone> = serde_json::from_str(&json).unwrap();
        assert_eq!(back, phones);
        // Pairing again starts over (not allowed).
        add_phone(&mut phones, Phone { id: "b".into(), name: "Laptop".into(), may_answer: false, may_picture: false, may_read: false, may_act: false, may_command: false, may_write: false, paired_at: None });
        assert!(!may_picture(&phones, "b"));
    }

    #[test]
    fn the_pc_is_told_who_makes_which_picture() {
        assert_eq!(picture_note("Pixel", "a cat"), "Pixel is making a picture: a cat");
        let long = "x".repeat(300);
        let note = picture_note("Pixel", &long);
        assert!(note.ends_with('…'));
        assert_eq!(note.chars().count(), "Pixel is making a picture: ".len() + 101);
    }

    #[test]
    fn the_pairing_history_counts_up_and_stays_short() {
        let mut events = Vec::new();
        add_event(&mut events, 100, "code", None);
        add_event(&mut events, 101, "paired", Some("Pixel".into()));
        assert_eq!(events[0].n, 1);
        assert_eq!(events[1].n, 2);
        assert_eq!(events[1].name.as_deref(), Some("Pixel"));
        for i in 0..(MAX_EVENTS + 5) {
            add_event(&mut events, 200 + i as u64, "code", None);
        }
        assert_eq!(events.len(), MAX_EVENTS);
        // Numbers keep counting up after old lines drop off.
        assert_eq!(events.last().unwrap().n, (MAX_EVENTS + 7) as u64);
    }

    #[test]
    fn the_pc_knows_its_build() {
        assert!(!pc_build().is_empty());
    }

    #[test]
    fn qr_text_holds_the_key_and_code() {
        assert_eq!(qr_text("pk", "c0de"), "PA1:P:pk:c0de");
        let image = qr_image(&qr_text(&"a".repeat(64), &"b".repeat(32))).unwrap();
        assert!(image.starts_with("data:image/svg+xml;base64,"));
    }

    const CHAT: &str = "c0ffee-chat_0123456789";

    #[test]
    fn a_tool_request_carries_a_name_a_chat_and_a_file_only() {
        assert_eq!(
            parse_request(br#"{"op":"tool","name":"workspace_read","chat":"c0ffee-chat_0123456789","args":{"file":"notes.md","path":"C:/x"}}"#),
            Some(Request::Tool {
                name: "workspace_read".into(),
                chat: CHAT.into(),
                args: ToolArgs { file: Some("notes.md".into()), key: None, command: None, bytes: None, thinking: None },
            })
        );
        assert_eq!(
            parse_request(br#"{"op":"tool","name":"pc_media","chat":"c0ffee-chat_0123456789","args":{"key":"mute","path":"x"}}"#),
            Some(Request::Tool { name: "pc_media".into(), chat: CHAT.into(), args: ToolArgs { file: None, key: Some("mute".into()), command: None, bytes: None, thinking: None } })
        );
        assert_eq!(
            parse_request(br#"{"op":"tool","name":"pc_run_command","chat":"c0ffee-chat_0123456789","args":{"command":"Get-Date","cwd":"C:/","always":true}}"#),
            Some(Request::Tool {
                name: "pc_run_command".into(),
                chat: CHAT.into(),
                args: ToolArgs { file: None, key: None, command: Some("Get-Date".into()), bytes: None, thinking: None },
            })
        );
        // The device's model's thinking: carried for the question only.
        assert_eq!(
            parse_request(br#"{"op":"tool","name":"pc_run_command","chat":"c0ffee-chat_0123456789","args":{"command":"Get-Date","thinking":"the user asked"}}"#),
            Some(Request::Tool {
                name: "pc_run_command".into(),
                chat: CHAT.into(),
                args: ToolArgs { command: Some("Get-Date".into()), thinking: Some("the user asked".into()), ..ToolArgs::default() },
            })
        );
        assert_eq!(
            parse_request(br#"{"op":"tool","name":"pc_info","chat":"c0ffee-chat_0123456789"}"#),
            Some(Request::Tool { name: "pc_info".into(), chat: CHAT.into(), args: ToolArgs::default() })
        );
        assert_eq!(parse_request(br#"{"op":"tool","name":"pc_info"}"#), None);
        assert_eq!(parse_request(br#"{"op":"tool","chat":"c0ffee-chat_0123456789"}"#), None);
    }

    #[test]
    fn tool_checks_go_switch_then_device_then_list_then_arguments() {
        let read = |file: &str| ToolArgs { file: Some(file.into()), key: None, command: None, bytes: None, thinking: None };
        const NONE: DeviceMay = DeviceMay { read: false, act: false, command: false, write: false };
        const READ: DeviceMay = DeviceMay { read: true, act: false, command: false, write: false };
        const ACT: DeviceMay = DeviceMay { read: false, act: true, command: false, write: false };
        const BOTH: DeviceMay = DeviceMay { read: true, act: true, command: false, write: false };
        const COMMAND: DeviceMay = DeviceMay { read: false, act: false, command: true, write: false };
        const ALL: DeviceMay = DeviceMay { read: true, act: true, command: true, write: true };
        let run = |c: &str| ToolArgs { file: None, key: None, command: Some(c.into()), bytes: None, thinking: None };
        // Each check wins over every later one, whatever else is wrong.
        assert_eq!(check_tool(false, BOTH, "pc_info", CHAT, &ToolArgs::default()), Err(OFF_TOOLS.into()));
        assert_eq!(check_tool(false, NONE, "run_command", "x", &read("../x")), Err(OFF_TOOLS.into()));
        assert_eq!(check_tool(false, BOTH, "pc_open", "x", &read("../x")), Err(OFF_TOOLS.into()));
        assert_eq!(check_tool(false, ALL, "pc_run_command", "x", &run("a\u{202e}b")), Err(OFF_TOOLS.into()));
        assert_eq!(check_tool(true, NONE, "run_command", "x", &read("../x")), Err(NOT_THIS_DEVICE_TOOLS.into()));
        assert_eq!(check_tool(true, NONE, "pc_open", "x", &read("../x")), Err(NOT_THIS_DEVICE_ACT.into()));
        assert_eq!(check_tool(true, BOTH, "pc_run_command", "x", &run("a\u{202e}b")), Err(NOT_THIS_DEVICE_COMMAND.into()));
        assert_eq!(check_tool(true, BOTH, "run_command", "x", &read("../x")), Err(NOT_A_REMOTE_TOOL.into()));
        assert_eq!(check_tool(true, READ, "run_command", "x", &read("../x")), Err(NOT_A_REMOTE_TOOL.into()));
        assert_eq!(check_tool(true, ACT, "run_command", "x", &read("../x")), Err(NOT_A_REMOTE_TOOL.into()));
        assert_eq!(check_tool(true, COMMAND, "run_command", "x", &run("x")), Err(NOT_A_REMOTE_TOOL.into()));
        assert!(check_tool(true, BOTH, "workspace_read", "x", &read("notes.md")).is_err());
        assert!(check_tool(true, BOTH, "pc_open", "x", &read("notes.md")).is_err());
        assert!(check_tool(true, COMMAND, "pc_run_command", "x", &run("Get-Date")).is_err());
        // Only the fixed list: stage 1's reads, stage 2's actions, stage 3's
        // command and stage 4's writes, nothing else.
        assert_eq!(
            REMOTE_TOOLS,
            [
                "pc_info",
                "workspace_list",
                "workspace_read",
                "pc_open",
                "pc_print",
                "pc_media",
                "pc_clipboard_read",
                "pc_run_command",
                "workspace_write",
                "workspace_append",
                "workspace_undo",
            ]
        );
        assert_eq!(ACT_TOOLS, &REMOTE_TOOLS[3..7]);
        assert_eq!(COMMAND_TOOLS, &REMOTE_TOOLS[7..8]);
        assert_eq!(WRITE_TOOLS, &REMOTE_TOOLS[8..]);
        for name in [
            "run_command", "open_file", "print_file", "clipboard_read", "media_key", "take_screenshot", "fs_read", "", "PC_INFO", "PC_OPEN",
            "PC_RUN_COMMAND", "pc_shell", "file_create", "file_edit", "file_delete", "workspace_delete", "workspace_rename", "fs_write",
            "pc_workspace_write", "WORKSPACE_WRITE",
        ] {
            assert_eq!(check_tool(true, ALL, name, CHAT, &run("Get-Date")), Err(NOT_A_REMOTE_TOOL.into()), "{name}");
        }
        // Each flag opens its own tools only: "may read" and "may act"
        // (alone or together) can't run a command, "may run commands"
        // alone can't read or act.
        for name in ACT_TOOLS {
            assert_eq!(check_tool(true, READ, name, CHAT, &read("notes.md")), Err(NOT_THIS_DEVICE_ACT.into()), "{name}");
            assert_eq!(check_tool(true, COMMAND, name, CHAT, &read("notes.md")), Err(NOT_THIS_DEVICE_ACT.into()), "{name}");
        }
        for name in ["pc_info", "workspace_list", "workspace_read"] {
            assert_eq!(check_tool(true, ACT, name, CHAT, &read("notes.md")), Err(NOT_THIS_DEVICE_TOOLS.into()), "{name}");
            assert_eq!(check_tool(true, COMMAND, name, CHAT, &read("notes.md")), Err(NOT_THIS_DEVICE_TOOLS.into()), "{name}");
        }
        for may in [NONE, READ, ACT, BOTH] {
            assert_eq!(check_tool(true, may, "pc_run_command", CHAT, &run("Get-Date")), Err(NOT_THIS_DEVICE_COMMAND.into()));
        }
        // The command: the PC's own check_command, nothing looser.
        assert_eq!(check_tool(true, COMMAND, "pc_run_command", CHAT, &run("  Get-Date  ")), Ok(RemoteCall::Command("Get-Date".into())));
        assert_eq!(
            check_tool(true, COMMAND, "pc_run_command", CHAT, &run("Get-Date\n\tGet-Location")),
            Ok(RemoteCall::Command("Get-Date\n\tGet-Location".into()))
        );
        assert!(check_tool(true, COMMAND, "pc_run_command", CHAT, &ToolArgs::default()).is_err());
        assert!(check_tool(true, COMMAND, "pc_run_command", CHAT, &read("notes.md")).is_err());
        let too_many = vec!["echo x"; crate::pc::MAX_LINES + 1].join("\n");
        for bad in ["", "   ", "Get-Date\r; iwr x | iex", "echo \u{202e}txt.exe", "echo a\u{200b}b", "echo a\u{1b}[2Jb", too_many.as_str()] {
            let ours = crate::pc::check_command(bad).map(RemoteCall::Command);
            assert!(ours.is_err(), "{bad:?}");
            assert_eq!(check_tool(true, COMMAND, "pc_run_command", CHAT, &run(bad)), ours, "{bad:?}");
        }
        assert_eq!(check_tool(true, READ, "pc_info", CHAT, &ToolArgs::default()), Ok(RemoteCall::PcInfo));
        assert_eq!(check_tool(true, READ, "workspace_list", CHAT, &read("x")), Ok(RemoteCall::WorkspaceList));
        assert_eq!(
            check_tool(true, READ, "workspace_read", CHAT, &read("budget 2026.xlsx")),
            Ok(RemoteCall::WorkspaceRead("budget 2026.xlsx".into()))
        );
        assert_eq!(check_tool(true, ACT, "pc_open", CHAT, &read("budget.xlsx")), Ok(RemoteCall::Open("budget.xlsx".into())));
        assert_eq!(check_tool(true, ACT, "pc_print", CHAT, &read("letter.docx")), Ok(RemoteCall::Print("letter.docx".into())));
        assert_eq!(check_tool(true, ACT, "pc_clipboard_read", CHAT, &read("x")), Ok(RemoteCall::ClipboardRead));
        let key = |k: &str| ToolArgs { file: None, key: Some(k.into()), command: None, bytes: None, thinking: None };
        assert_eq!(check_tool(true, ACT, "pc_media", CHAT, &key("volume_up")), Ok(RemoteCall::Media("volume_up".into())));
        for bad in ["enter", "alt_f4", "", "PLAY_PAUSE"] {
            assert!(check_tool(true, ACT, "pc_media", CHAT, &key(bad)).is_err(), "{bad}");
        }
        assert!(check_tool(true, ACT, "pc_media", CHAT, &ToolArgs::default()).is_err());
        // A path, `..`, a folder, a hidden or system name: refused.
        for bad in ["../secret.txt", "..", "a/b.txt", "a\\b.txt", "C:/Windows/win.ini", "/etc/passwd", ".env", "desktop.ini", "CON.txt"] {
            assert!(check_tool(true, READ, "workspace_read", CHAT, &read(bad)).is_err(), "{bad}");
            assert!(check_tool(true, ACT, "pc_open", CHAT, &read(bad)).is_err(), "{bad}");
            assert!(check_tool(true, ACT, "pc_print", CHAT, &read(bad)).is_err(), "{bad}");
        }
        assert!(check_tool(true, READ, "workspace_read", CHAT, &ToolArgs::default()).is_err());
        assert!(check_tool(true, ACT, "pc_open", CHAT, &ToolArgs::default()).is_err());
    }

    #[test]
    fn writes_need_their_own_flag_a_workspace_text_name_and_a_size() {
        use crate::pc_write::{WriteKind, MAX_WRITE};
        const WRITE: DeviceMay = DeviceMay { read: false, act: false, command: false, write: true };
        const OTHERS: DeviceMay = DeviceMay { read: true, act: true, command: true, write: false };
        let text = |file: &str, bytes: Option<u64>| ToolArgs { file: Some(file.into()), key: None, command: None, bytes, thinking: None };
        // The order holds: switch, then this device's "may write", then
        // the list, then the arguments, whatever else is wrong.
        for name in WRITE_TOOLS {
            assert_eq!(check_tool(false, WRITE, name, "x", &text("../x", Some(u64::MAX))), Err(OFF_TOOLS.into()));
            assert_eq!(check_tool(true, OTHERS, name, "x", &text("../x", Some(u64::MAX))), Err(NOT_THIS_DEVICE_WRITE.into()));
            assert!(check_tool(true, WRITE, name, "x", &text("notes.md", Some(1))).is_err(), "{name}: chat id");
        }
        // "May write" alone can't read, act or run a command.
        for name in ["pc_info", "workspace_list", "workspace_read"] {
            assert_eq!(check_tool(true, WRITE, name, CHAT, &text("notes.md", None)), Err(NOT_THIS_DEVICE_TOOLS.into()), "{name}");
        }
        for name in ACT_TOOLS {
            assert_eq!(check_tool(true, WRITE, name, CHAT, &text("notes.md", None)), Err(NOT_THIS_DEVICE_ACT.into()), "{name}");
        }
        assert_eq!(check_tool(true, WRITE, "pc_run_command", CHAT, &text("notes.md", None)), Err(NOT_THIS_DEVICE_COMMAND.into()));
        // The arguments: a workspace name (the same check as reads), a
        // text kind that opens in a viewer, the size announced and capped.
        assert_eq!(
            check_tool(true, WRITE, "workspace_write", CHAT, &text("notes.md", Some(12))),
            Ok(RemoteCall::Write { file: "notes.md".into(), kind: WriteKind::Write, bytes: 12 })
        );
        assert_eq!(
            check_tool(true, WRITE, "workspace_write", CHAT, &text("empty.txt", Some(0))),
            Ok(RemoteCall::Write { file: "empty.txt".into(), kind: WriteKind::Write, bytes: 0 })
        );
        assert_eq!(
            check_tool(true, WRITE, "workspace_append", CHAT, &text("log.txt", Some(MAX_WRITE as u64))),
            Ok(RemoteCall::Write { file: "log.txt".into(), kind: WriteKind::Append, bytes: MAX_WRITE })
        );
        assert_eq!(
            check_tool(true, WRITE, "workspace_undo", CHAT, &text("notes.md", None)),
            Ok(RemoteCall::Write { file: "notes.md".into(), kind: WriteKind::Undo, bytes: 0 })
        );
        assert!(check_tool(true, WRITE, "workspace_write", CHAT, &text("notes.md", Some(MAX_WRITE as u64 + 1))).is_err());
        assert!(check_tool(true, WRITE, "workspace_write", CHAT, &text("notes.md", None)).is_err());
        assert!(check_tool(true, WRITE, "workspace_append", CHAT, &text("notes.md", Some(0))).is_err());
        assert!(check_tool(true, WRITE, "workspace_undo", CHAT, &text("notes.md", Some(3))).is_err());
        for name in WRITE_TOOLS {
            assert!(check_tool(true, WRITE, name, CHAT, &ToolArgs { bytes: Some(1), ..Default::default() }).is_err());
            for bad in [
                "../secret.txt", "..", "a/b.txt", "a\\b.txt", "C:/Windows/win.ini", "/etc/passwd.txt", ".env", ".notes.md", "desktop.ini",
                "CON.txt", "nul.md", "run.js", "x.ps1", "x.bat", "x.exe", "x.sh", "x.py", "report.docx", "noext", "notes.md ",
            ] {
                assert!(check_tool(true, WRITE, name, CHAT, &text(bad, Some(1))).is_err(), "{name} {bad}");
            }
        }
        // The size comes as a named field; the text never in the line.
        assert_eq!(
            parse_request(br#"{"op":"tool","name":"workspace_write","chat":"c0ffee-chat_0123456789","args":{"file":"a.md","bytes":5,"content":"x","path":"C:/"}}"#),
            Some(Request::Tool { name: "workspace_write".into(), chat: CHAT.into(), args: text("a.md", Some(5)) })
        );
    }

    #[test]
    fn each_device_may_write_only_once_allowed() {
        // Off for old records (even with every other flag on) and by default.
        let old: Vec<Phone> = serde_json::from_str(
            r#"[{"id":"a","name":"Pixel","mayAnswer":true,"mayPicture":true,"mayRead":true,"mayAct":true,"mayCommand":true}]"#,
        )
        .unwrap();
        assert!(!may_write(&old, "a"));
        assert!(!Phone::new("n".into(), "New".into(), 1).may_write);
        let mut phones = old;
        assert!(set_may_write(&mut phones, "a", true));
        assert!(may_write(&phones, "a") && !may_write(&phones, "b"));
        assert!(!set_may_write(&mut phones, "b", true));
        assert!(serde_json::to_string(&phones).unwrap().contains(r#""mayWrite":true"#));
        // Separate from the other flags.
        assert!(set_may_command(&mut phones, "a", false) && set_may_act(&mut phones, "a", false) && set_may_read(&mut phones, "a", false));
        assert!(may_write(&phones, "a"));
        assert!(set_may_write(&mut phones, "a", false));
        assert!(!may_write(&phones, "a"));
        assert!(!serde_json::to_string(&phones).unwrap().contains("mayWrite"));
        // Pairing anew starts with it off.
        assert!(set_may_write(&mut phones, "a", true));
        add_phone(&mut phones, Phone::new("a".into(), "Pixel".into(), 2));
        assert!(!may_write(&phones, "a"));
        // Turning it on says what it allows and that each change is asked.
        let q = may_write_question("Pixel", "abcd");
        assert!(q.starts_with("Let \u{201c}Pixel\u{201d} ask to write in this PC's workspace?"), "{q}");
        assert!(q.contains("before and after and asks you every time") && q.contains("never \u{201c}always\u{201d}"), "{q}");
        assert!(q.contains("never programs or scripts, nothing outside the workspace, nothing deleted"), "{q}");
        assert!(q.ends_with("Device key: abcd"));
    }

    /// Stage 4: a change is worked out, then asked (approval::ask_for,
    /// every time, never "always", the device named, still allowed after
    /// the answer), then written; logged and told without the text.
    #[test]
    fn a_write_asks_every_time_before_anything_is_written() {
        // The Windows checkout has "\r\n" line ends; compare with "\n".
        let source = &include_str!("link.rs").replace("\r\n", "\n");
        let body = &source[source.find("async fn write_for(").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let still = body.find("let still_allowed = || tools_allowed(app) && may_write(&load_phones(app), remote);").unwrap();
        let plan = body.find("crate::pc_write::plan(").unwrap();
        let ask = body
            .find("if !crate::approval::ask_for(app, &crate::pc_write::question(device, &plan), Some(&by), thinking).await {")
            .unwrap();
        let apply = body.find("crate::pc_write::apply(").unwrap();
        let log = body.find("crate::remote_ask::log_use(app, device, &note);").unwrap();
        assert!(still < plan && plan < ask && ask < apply && apply < log);
        assert_eq!(body.matches("crate::pc_write::apply(").count(), 1);
        assert!(!body.contains("ask_with_always") && !body.contains("Always") && !body.contains("plan.next"));
        // The text is read only after every check passed.
        let tool = &source[source.find("Some(Request::Tool { name, chat, args }) if paired => {").unwrap()..];
        let check = tool.find("let checked = check_tool(").unwrap();
        let read = tool.find("RemoteCall::Write { bytes, .. } => read_text(&mut recv, *bytes).await,").unwrap();
        assert!(check < read);
    }

    #[test]
    fn each_device_may_act_only_once_allowed() {
        let old: Vec<Phone> = serde_json::from_str(r#"[{"id":"a","name":"Pixel","mayAnswer":true,"mayRead":true}]"#).unwrap();
        assert!(!may_act(&old, "a"));
        let mut phones = old;
        assert!(set_may_act(&mut phones, "a", true));
        assert!(may_act(&phones, "a") && !may_act(&phones, "b"));
        assert!(!set_may_act(&mut phones, "b", true));
        assert!(serde_json::to_string(&phones).unwrap().contains(r#""mayAct":true"#));
        // Pairing anew starts with it off.
        add_phone(&mut phones, Phone { id: "a".into(), name: "Pixel".into(), may_answer: false, may_picture: false, may_read: false, may_act: false, may_command: false, may_write: false, paired_at: None });
        assert!(!may_act(&phones, "a"));
        let q = may_act_question("Pixel", "abcd");
        assert!(q.contains("\u{201c}Pixel\u{201d}") && q.contains("asks you every time") && q.ends_with("Device key: abcd"));
    }

    #[test]
    fn each_device_may_run_commands_only_once_allowed() {
        // Off for old records (even with every other flag on) and by default.
        let old: Vec<Phone> =
            serde_json::from_str(r#"[{"id":"a","name":"Pixel","mayAnswer":true,"mayPicture":true,"mayRead":true,"mayAct":true}]"#).unwrap();
        assert!(!may_command(&old, "a"));
        let mut phones = old;
        assert!(set_may_command(&mut phones, "a", true));
        assert!(may_command(&phones, "a") && !may_command(&phones, "b"));
        assert!(!set_may_command(&mut phones, "b", true));
        assert!(serde_json::to_string(&phones).unwrap().contains(r#""mayCommand":true"#));
        // "May act" off leaves it on, and the other way round: separate flags.
        assert!(set_may_act(&mut phones, "a", false));
        assert!(may_command(&phones, "a"));
        assert!(set_may_command(&mut phones, "a", false));
        assert!(!may_command(&phones, "a"));
        assert!(!serde_json::to_string(&phones).unwrap().contains("mayCommand"));
        // Pairing anew starts with it off.
        assert!(set_may_command(&mut phones, "a", true));
        add_phone(&mut phones, Phone { id: "a".into(), name: "Pixel".into(), may_answer: false, may_picture: false, may_read: false, may_act: false, may_command: false, may_write: false, paired_at: None });
        assert!(!may_command(&phones, "a"));
        // Turning it on warns plainly.
        let q = may_command_question("Pixel", "abcd");
        assert!(q.starts_with("Let \u{201c}Pixel\u{201d} ask to run commands on this PC?"), "{q}");
        assert!(q.contains("can run anything you can on this PC, after you allow each command"), "{q}");
        assert!(q.contains("every time") && q.contains("never \u{201c}always\u{201d}"), "{q}");
        assert!(q.ends_with("Device key: abcd"));
    }

    #[test]
    fn a_command_from_a_device_is_told_and_its_output_names_no_local_paths() {
        assert_eq!(
            command_note("Pixel", "Get-Date", Some(0), false),
            "Pixel ran a command on this PC (exit code 0): Get-Date"
        );
        assert_eq!(command_note("Pixel", "sleep 99", None, true), "Pixel ran a command on this PC (stopped after 60 s): sleep 99");
        // The first 60 characters, on one line, escaped.
        let long = format!("Get-ChildItem\n{}", "x".repeat(100));
        let note = command_note("Pixel", &long, Some(1), false);
        assert_eq!(note.lines().count(), 1);
        assert!(note.ends_with(&format!("Get-ChildItem\\n{}…", "x".repeat(45))), "{note}");
        // The answers log keeps the whole command (escaped, one line).
        let line = crate::remote_ask::use_line(7, "Pixel", &format!("ran a command (exit code 1): {long}"));
        assert_eq!(line.lines().count(), 1);
        assert!(line.ends_with(&format!("Get-ChildItem\\n{}", "x".repeat(100))), "{line}");

        let known = vec![
            (r"C:\Users\Jo\AppData\Roaming\com.pocketagent.desktop\Documents\PocketAgentFiles".to_string(), "<workspace>"),
            (r"C:\Users\Jo".to_string(), "<home>"),
            ("/home/jo/.local/share/pocketagent/Documents/PocketAgentFiles".to_string(), "<workspace>"),
            ("/home/jo".to_string(), "<home>"),
        ];
        let output = "/home/jo/.local/share/pocketagent/Documents/PocketAgentFiles\n\
            Path\n----\nC:\\Users\\Jo\\AppData\\Roaming\\com.pocketagent.desktop\\Documents\\PocketAgentFiles\n\
            notes.md\t/home/jo/notes.md\n/usr/bin/python3\nD:\\Games\\x.exe\nhello world";
        let clean = output_for_device(output, &known);
        assert!(!clean.contains("Jo") && !clean.contains("jo"), "{clean}");
        assert!(!clean.contains("/usr/") && !clean.contains("D:\\"), "{clean}");
        assert_eq!(
            clean,
            "<workspace>\nPath\n----\n<workspace>\nnotes.md\t<home>/notes.md\n<path>\n<path>\nhello world"
        );
        // Capped (at a character boundary), saying so.
        let big = "é".repeat(MAX_DEVICE_OUTPUT);
        let capped = output_for_device(&big, &known);
        assert!(capped.len() <= MAX_DEVICE_OUTPUT + 20 && capped.ends_with("[… output cut]"));
        assert_eq!(cap_text("short", 10), "short");
    }

    #[test]
    fn the_pc_is_told_what_a_device_did_never_the_clipboard() {
        assert_eq!(act_note("Pixel", &RemoteCall::Open("a.md".into()), 0), "Pixel opened a.md on this PC");
        assert_eq!(act_note("Pixel", &RemoteCall::Print("a.md".into()), 0), "Pixel printed a.md on this PC");
        assert_eq!(act_note("Pixel", &RemoteCall::Media("mute".into()), 0), "Pixel pressed Mute on this PC");
        assert_eq!(
            act_note("Pixel", &RemoteCall::ClipboardRead, 12),
            "Pixel got the text on this PC's clipboard (12 characters)"
        );
    }

    #[test]
    fn chat_ids_are_random_looking_and_plain() {
        assert!(check_chat(CHAT).is_ok());
        assert!(check_chat(&"a".repeat(64)).is_ok());
        for bad in ["", "short", &"a".repeat(65), "chat id with spaces!", "c0ffee-chat/0123456789", "c0ffee-chat\n0123456789"] {
            assert!(check_chat(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn each_device_may_read_only_once_allowed() {
        let old: Vec<Phone> = serde_json::from_str(r#"[{"id":"a","name":"Pixel","mayAnswer":true,"mayPicture":true}]"#).unwrap();
        assert!(!may_read(&old, "a"));
        let mut phones = old;
        assert!(set_may_read(&mut phones, "a", true));
        assert!(may_read(&phones, "a") && !may_read(&phones, "b"));
        assert!(!set_may_read(&mut phones, "b", true));
        assert!(serde_json::to_string(&phones).unwrap().contains(r#""mayRead":true"#));
        // Pairing anew starts with it off.
        add_phone(&mut phones, Phone { id: "a".into(), name: "Pixel".into(), may_answer: false, may_picture: false, may_read: false, may_act: false, may_command: false, may_write: false, paired_at: None });
        assert!(!may_read(&phones, "a"));
    }

    #[test]
    fn reading_is_allowed_per_device_and_chat_for_12_hours() {
        let mut grants = ReadGrants::default();
        let start = Instant::now();
        assert!(!grants.has("a", CHAT, start));
        grants.add("a", CHAT, start);
        assert!(grants.has("a", CHAT, start + Duration::from_secs(60)));
        // Another chat, or another device: asked again.
        assert!(!grants.has("a", "another-chat-0123456789", start));
        assert!(!grants.has("b", CHAT, start));
        assert!(!grants.has("a", CHAT, start + READ_GRANT_TIME));
        grants.add("a", CHAT, start);
        grants.add("b", CHAT, start);
        grants.forget_device("a");
        assert!(!grants.has("a", CHAT, start) && grants.has("b", CHAT, start));
        grants.clear();
        assert!(!grants.has("b", CHAT, start));
        for i in 0..(MAX_READ_GRANTS + 10) {
            grants.add(&format!("d{i}"), CHAT, start + Duration::from_millis(i as u64));
        }
        assert_eq!(grants.map.len(), MAX_READ_GRANTS);
        assert!(!grants.has("d0", CHAT, start + Duration::from_secs(1)));
    }

    #[test]
    fn errors_for_devices_name_no_local_paths() {
        let known = vec![
            (r"C:\Users\Jo\AppData\Roaming\com.pocketagent.desktop".to_string(), "<app folder>"),
            (r"C:\Users\Jo".to_string(), "<home>"),
            ("/home/jo/.local/share/pocketagent".to_string(), "<app folder>"),
            ("/home/jo".to_string(), "<home>"),
        ];
        let tail = "The picture maker failed.\n\
            [ERROR] load model from 'C:\\Users\\Jo\\AppData\\Roaming\\com.pocketagent.desktop\\models\\sd.gguf' failed\n\
            open c:/users/jo/Downloads/x.safetensors: not found\n\
            /home/jo/.local/share/pocketagent/models/flux.gguf: bad magic\n\
            see /home/jo/notes.txt and D:\\models\\other.gguf, \\\\server\\share\\m.gguf (and /usr/lib/x.so)";
        let clean = without_paths(tail, &known);
        assert!(!clean.contains("Jo") && !clean.contains("jo"), "{clean}");
        assert!(!clean.contains("D:\\") && !clean.contains("server") && !clean.contains("/usr/"), "{clean}");
        assert!(clean.contains("'<app folder>\\models\\sd.gguf'"), "{clean}");
        assert!(clean.contains("<home>/Downloads/x.safetensors"), "{clean}");
        assert!(clean.contains("<app folder>/models/flux.gguf: bad magic"), "{clean}");
        assert!(clean.contains("<path>, <path> (and <path>)"), "{clean}");
        assert!(clean.starts_with("The picture maker failed.\n[ERROR] load model from"));
        // Plain messages stay as they are.
        assert_eq!(without_paths("Stopped after 10 minutes.", &known), "Stopped after 10 minutes.");
    }

    #[test]
    fn one_device_has_at_most_three_chats_allowed() {
        let mut grants = ReadGrants::default();
        let start = Instant::now();
        let chat = |i: usize| format!("chat-{i:020}");
        for i in 0..MAX_CHAT_GRANTS_PER_DEVICE {
            grants.add("a", &chat(i), start + Duration::from_millis(i as u64));
        }
        grants.add("b", &chat(0), start);
        assert_eq!(grants.count("a", start), MAX_CHAT_GRANTS_PER_DEVICE);
        // A new chat id replaces that device's oldest, not another device's.
        grants.add("a", &chat(99), start + Duration::from_secs(1));
        assert_eq!(grants.count("a", start + Duration::from_secs(1)), MAX_CHAT_GRANTS_PER_DEVICE);
        assert!(!grants.has("a", &chat(0), start + Duration::from_secs(1)));
        assert!(grants.has("a", &chat(1), start + Duration::from_secs(1)));
        assert!(grants.has("a", &chat(99), start + Duration::from_secs(1)));
        assert!(grants.has("b", &chat(0), start + Duration::from_secs(1)));
        // Many made-up ids: still three.
        for i in 100..200 {
            grants.add("a", &chat(i), start + Duration::from_secs(i as u64));
        }
        assert_eq!(grants.count("a", start + Duration::from_secs(200)), MAX_CHAT_GRANTS_PER_DEVICE);
        assert_eq!(grants.count("b", start + Duration::from_secs(200)), 1);
    }

    /// Device-circle stage 1: every right but the model is off for every
    /// record, old (saved before a flag existed) and new (just paired).
    #[test]
    fn rights_are_off_for_old_and_new_records() {
        let off = |p: &Phone| !(p.may_answer || p.may_picture || p.may_read || p.may_act || p.may_command || p.may_write);
        let old: Vec<Phone> = serde_json::from_str(r#"[{"id":"a","name":"Pixel"},{"id":"b","name":"Laptop","mayAnswer":false}]"#).unwrap();
        assert!(old.iter().all(off));
        assert!(old.iter().all(|p| p.paired_at.is_none()));
        let new = Phone::new("c".into(), "Desktop".into(), 1_763_200_000);
        assert!(off(&new));
        assert_eq!(new.paired_at, Some(1_763_200_000));
        // Off flags are not even written; the pairing time is.
        let json = serde_json::to_value(&new).unwrap();
        assert_eq!(json, serde_json::json!({"id": "c", "name": "Desktop", "pairedAt": 1_763_200_000u64}));
        // Pairing again starts over: rights off, a new time.
        let mut phones = vec![Phone { may_command: true, may_read: true, ..new.clone() }];
        add_phone(&mut phones, Phone::new("c".into(), "Desktop".into(), 1_763_300_000));
        assert_eq!(phones.len(), 1);
        assert!(off(&phones[0]));
        assert_eq!(phones[0].paired_at, Some(1_763_300_000));
    }

    /// Device-circle stage 1: a right is saved only after this PC's own
    /// native dialog said yes (turning one off asks nothing); pairing saves
    /// a device only after its dialog too, with every right off.
    #[test]
    fn rights_are_written_only_after_this_pcs_own_dialog() {
        // The Windows checkout has "\r\n" line ends; compare with "\n".
        let source = &include_str!("link.rs").replace("\r\n", "\n");
        for (name, set) in [
            ("answer", "set_may_answer"),
            ("picture", "set_may_picture"),
            ("read", "set_may_read"),
            ("act", "set_may_act"),
            ("command", "set_may_command"),
            ("write", "set_may_write"),
        ] {
            let start = source.find(&format!("pub async fn link_device_may_{name}(")).unwrap();
            let body = &source[start..];
            let end = [body.find("#[tauri::command]"), body.find("#[cfg(test)]")].into_iter().flatten().min().unwrap();
            let body = &body[..end];
            let allowed = body.find("if allowed {").unwrap();
            let ask = body.find("if !crate::approval::ask_on_this_pc(&app, &question).await {").unwrap();
            let refuse = body.find("return Err(\"Not allowed on this PC\".into());").unwrap();
            let set = body.find(&format!("{set}(&mut phones, &id, allowed)")).unwrap();
            let save = body.find("save_phones(&app, &phones)").unwrap();
            assert!(allowed < ask && ask < refuse && refuse < set && set < save, "{name}");
            assert_eq!(body.matches("save_phones(").count(), 1, "{name}");
        }
        let pair = &source[source.find("Some(Request::Pair { code, name }) => {").unwrap()..];
        let pair = &pair[..pair.find("Some(Request::Status) if paired").unwrap()];
        let ask = pair.find("if crate::approval::ask_on_this_pc(&app, &question).await {").unwrap();
        let add = pair.find("add_phone(&mut phones, Phone::new(").unwrap();
        assert!(ask < add);
        // Only these write the paired list: pairing, the six rights, and
        // removing (forget_here, for "Remove here" and removal notices,
        // which only takes a device out).
        let code = &source[..source.find("#[cfg(test)]").unwrap()];
        assert_eq!(code.matches("save_phones(&app, &phones)").count(), 7);
        assert_eq!(code.matches("save_phones(app, &phones)").count(), 1);
        let forget = &code[code.find("fn forget_here(").unwrap()..];
        let forget = &forget[..forget.find("\n}").unwrap()];
        assert!(forget.contains("phones.retain(|p| p.id != id);\n    save_phones(app, &phones)?;"));
    }

    #[test]
    fn the_pc_says_who_reads_what() {
        let q = read_question("Pixel 8", CHAT, 0);
        assert!(q.starts_with("\u{201c}Pixel 8\u{201d} asks to read files in your workspace for this chat."));
        assert!(q.contains("Chat: c0ffee-c…"));
        assert!(!q.contains("already has"));
        assert!(read_question("Pixel 8", CHAT, 1).contains("already has 1 other chat allowed (at most 3)"));
        assert!(read_question("Pixel 8", CHAT, 3).contains("allowing this one ends the oldest"));
        assert_eq!(
            read_note("Pixel 8", "budget.xlsx", 2),
            "Pixel 8 read budget.xlsx from the workspace (2 of at most 3 chats allowed to read)"
        );
    }
}
