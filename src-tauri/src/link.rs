//! Home link: use the model running on this PC from your phone, from
//! anywhere (SECURITY.md rule 6). Off until the user switches it on.
//!
//! Devices dial each other by public key (iroh). Connections are encrypted
//! end to end between the PC and the phone; when no direct path can be found
//! (home routers, mobile networks), a relay passes the encrypted bytes on but
//! can't read them.
//!
//! - Pairing: the PC shows a QR code with its public key and a one-time
//!   code (10 minutes, one try). The phone connects and sends the code; the
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
//!   workspace asks on this PC once per chat (see Request::Tool).
//! - The PC's link key and the paired phones are kept where the screens
//!   can't write: Windows Credential Manager, or on Linux a private file in
//!   the app's settings folder (see read_entry).

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
/// The PC's switch "Let paired devices make pictures on this PC" ("on").
const PICTURES_ENTRY: &str = "DesktopAgent-link:pictures";
/// Largest picture sent back to a device (a 1024 x 1024 PNG is 1-3 MB).
pub const MAX_PICTURE: usize = 8 * 1024 * 1024;
/// The PC's switch "Let paired devices use this PC's tools" ("on"); kept
/// across restarts like the pictures switch.
const TOOLS_ENTRY: &str = "DesktopAgent-link:tools";
/// The only tools a device may ask for (stage 1: read only).
pub const REMOTE_TOOLS: &[&str] = &["pc_info", "workspace_list", "workspace_read"];
/// Largest tool answer sent (a file's text is at most 256 KB, escaped).
pub const MAX_TOOL_ANSWER: usize = 2 * 1024 * 1024;
/// How long "read the workspace for this chat" stays allowed.
const READ_GRANT_TIME: Duration = Duration::from_secs(12 * 60 * 60);
/// Most chats remembered as allowed at once (the oldest go first).
const MAX_READ_GRANTS: usize = 200;
/// Pairing history kept (paired phones see it, so they notice new codes).
const MAX_EVENTS: usize = 30;
const PAIR_CODE_LIFETIME: Duration = Duration::from_secs(10 * 60);
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
    /// One of this PC's read-only tools (only while the user allows device
    /// tools here, for this device; only names on REMOTE_TOOLS). `chat`:
    /// the device's own random id for the chat asking, so reading the
    /// workspace is asked here once per chat. Arguments are named fields
    /// only (anything else is ignored); a file is a workspace name, never
    /// a path (pc_files::check_name).
    Tool {
        name: String,
        chat: String,
        #[serde(default)]
        args: ToolArgs,
    },
    Http,
}

pub fn parse_request(line: &[u8]) -> Option<Request> {
    if line.len() > MAX_REQUEST_LINE {
        return None;
    }
    serde_json::from_slice(line).ok()
}

/// The only argument a device's tool request carries.
#[derive(Debug, Default, PartialEq, Deserialize)]
pub struct ToolArgs {
    /// workspace_read: the file's name in the workspace.
    #[serde(default)]
    pub file: Option<String>,
}

/// A device's tool request, checked.
#[derive(Debug, PartialEq)]
pub enum RemoteCall {
    PcInfo,
    WorkspaceList,
    WorkspaceRead(String),
}

const OFF_TOOLS: &str = "Using this PC's tools from paired devices is off on the PC (Settings → Use this PC's model from your phone → Let paired devices use this PC's tools)";
const NOT_THIS_DEVICE_TOOLS: &str = "This device may not use this PC's tools; allow it on the PC (Settings → Use this PC's model from your phone → Paired phones → May read)";
const NOT_A_REMOTE_TOOL: &str = "The PC offers only pc_info, workspace_list and workspace_read to paired devices";

/// A chat id from a device: random, opaque, 16-64 letters, digits, `-`, `_`.
pub fn check_chat(chat: &str) -> Result<&str, String> {
    if (16..=64).contains(&chat.len()) && chat.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        Ok(chat)
    } else {
        Err("The request has no valid chat id".into())
    }
}

/// Checks a device's tool request, in this order: the PC's switch, this
/// device's "may read", the tool on REMOTE_TOOLS, then its arguments.
/// (Only paired devices get here at all.)
pub fn check_tool(tools_on: bool, device_may_read: bool, name: &str, chat: &str, args: &ToolArgs) -> Result<RemoteCall, String> {
    if !tools_on {
        return Err(OFF_TOOLS.into());
    }
    if !device_may_read {
        return Err(NOT_THIS_DEVICE_TOOLS.into());
    }
    if !REMOTE_TOOLS.contains(&name) {
        return Err(NOT_A_REMOTE_TOOL.into());
    }
    check_chat(chat)?;
    match name {
        "pc_info" => Ok(RemoteCall::PcInfo),
        "workspace_list" => Ok(RemoteCall::WorkspaceList),
        _ => {
            let file = args.file.as_deref().ok_or("Give the file's name in the PC's workspace")?;
            Ok(RemoteCall::WorkspaceRead(crate::pc_files::check_name(file)?.to_string()))
        }
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
        while self.map.len() > MAX_READ_GRANTS {
            let oldest = self.map.iter().min_by_key(|(_, at)| **at).map(|(k, _)| k.clone());
            match oldest {
                Some(k) => self.map.remove(&k),
                None => break,
            };
        }
    }

    /// Forgets one device's chats (removed, or may no longer read).
    pub fn forget_device(&mut self, device: &str) {
        self.map.retain(|(d, _), _| d != device);
    }

    pub fn clear(&mut self) {
        self.map.clear();
    }
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

/// The one-time pairing code: one try only, then it is gone.
pub struct PairCode {
    code: String,
    made: Instant,
}

impl PairCode {
    pub fn new(code: String) -> Self {
        Self {
            code,
            made: Instant::now(),
        }
    }
}

/// Takes the code out (whatever the answer), true if it matched in time.
pub fn try_code(slot: &Mutex<Option<PairCode>>, offered: &str) -> bool {
    match slot.lock().unwrap().take() {
        Some(pc) => pc.made.elapsed() < PAIR_CODE_LIFETIME && same(&pc.code, offered),
        None => false,
    }
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
    /// "code" | "paired" | "removed" | "may-answer"
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

fn record(app: &AppHandle, kind: &str, name: Option<String>) {
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut events = load_events(app);
    add_event(&mut events, at, kind, name);
    if let Ok(json) = serde_json::to_string(&events) {
        let _ = write_entry(app, EVENTS_ENTRY, &json);
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
    running: tokio::sync::Mutex<Option<iroh::protocol::Router>>,
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
        }),
        bytes,
    ))
}

/// The PC's switch for device tools (kept where the screens can't write).
fn tools_allowed(app: &AppHandle) -> bool {
    read_entry(app, TOOLS_ENTRY).as_deref() == Some("on")
}

/// The question asked on this PC (and, while allowed, on devices that may
/// answer) before a device's chat reads the workspace.
pub fn read_question(device: &str, chat: &str) -> String {
    let short: String = chat.chars().take(8).collect();
    format!(
        "\u{201c}{device}\u{201d} asks to read files in your workspace for this chat.\n\nDuring this one chat on that device (12 hours at most) it may list the files in DesktopAgent's workspace folder and read text files and documents there. Nothing outside the workspace, and nothing is changed. This PC shows a notification for each file read.\n\nChat: {short}…"
    )
}

/// What the PC user is told when a device read a workspace file.
pub fn read_note(device: &str, file: &str) -> String {
    format!("{device} read {file} from the workspace")
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
    if !crate::approval::ask(app, &read_question(device, chat)).await {
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

/// Runs a checked tool request for a paired device: the same functions as
/// this PC's own tools (pc::pc_info, pc::workspace_file, docs.rs through
/// pc_files::read). Each use is logged with the answers log.
async fn tool_for(app: &AppHandle, remote: &str, device: &str, chat: &str, call: RemoteCall) -> Result<serde_json::Value, String> {
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
            let read = blocking(move || {
                serde_json::to_value(crate::pc_files::read(&path, &name)?).map_err(|e| e.to_string())
            })
            .await?;
            crate::remote_ask::log_use(app, device, &format!("read workspace file {file}"));
            use tauri_plugin_notification::NotificationExt;
            let _ = app
                .notification()
                .builder()
                .title(format!("{device} read a file on this PC"))
                .body(read_note(device, &file))
                .show();
            Ok(read)
        }
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
        // Kept so that removing this device closes it at once (link_forget).
        let link = self.app.state::<Link>();
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
        // one-time code (only a wrong code from a new device does).
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
                    add_phone(
                        &mut phones,
                        Phone { id: remote.clone(), name: name.clone(), may_answer: false, may_picture: false, may_read: false },
                    );
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
                        reply(&mut send, serde_json::json!({"ok": false, "error": error})).await;
                    }
                }
            }
        }
        Some(Request::Tool { name, chat, args }) if paired => {
            let phones = load_phones(&app);
            let checked = check_tool(tools_allowed(&app), may_read(&phones, &remote), &name, &chat, &args);
            let answer = match checked {
                Err(error) => Err(error),
                Ok(call) => {
                    let device = phones
                        .into_iter()
                        .find(|p| p.id == remote)
                        .map(|p| p.name)
                        .unwrap_or_else(|| "a device".into());
                    // Nothing more is read from the device on this stream.
                    let _ = recv.stop(0u32.into());
                    tool_for(&app, &remote, &device, &chat, call).await
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
                Err(error) => reply(&mut send, serde_json::json!({"ok": false, "error": error})).await,
            }
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

async fn start(app: &AppHandle) -> Result<String, String> {
    let link = app.state::<Link>();
    let mut running = link.running.lock().await;
    if let Some(router) = running.as_ref() {
        return Ok(router.endpoint().id().to_string());
    }
    let endpoint = iroh::Endpoint::builder(iroh::endpoint::presets::N0)
        .secret_key(secret_key(app)?)
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(|e| e.to_string())?;
    let id = endpoint.id().to_string();
    let router = iroh::protocol::Router::builder(endpoint)
        .accept(ALPN, Handler { app: app.clone() })
        .spawn();
    *running = Some(router);
    Ok(id)
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
    if let Some(router) = link.running.lock().await.take() {
        let _ = router.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn link_status(app: AppHandle, link: State<'_, Link>) -> Result<LinkStatus, String> {
    let running = link.running.lock().await;
    Ok(LinkStatus {
        on: running.is_some(),
        pictures_allowed: pictures_allowed(&app),
        tools_allowed: tools_allowed(&app),
        pc_id: running.as_ref().map(|r| r.endpoint().id().to_string()),
        phones: load_phones(&app),
        events: load_events(&app),
    })
}

/// Removes a paired phone: it can't connect any more, and what it has open
/// (a model request, a sync) is cut off at once.
#[tauri::command]
pub async fn link_forget(app: AppHandle, id: String) -> Result<(), String> {
    let mut phones = load_phones(&app);
    let name = phones.iter().find(|p| p.id == id).map(|p| p.name.clone());
    phones.retain(|p| p.id != id);
    save_phones(&app, &phones)?;
    let link = app.state::<Link>();
    link.removed.lock().unwrap().insert(id.clone(), Instant::now());
    link.cut_off(&id);
    link.read_grants.lock().unwrap().forget_device(&id);
    record(&app, "removed", name);
    Ok(())
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

    #[test]
    fn a_pairing_code_works_once_and_only_when_right() {
        let slot = Mutex::new(Some(PairCode::new("abc123".into())));
        assert!(!try_code(&slot, "wrong!"));
        // One try only: even the right code fails now.
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
        };
        let slot = Mutex::new(Some(expired));
        assert!(!try_code(&slot, "c0ffee"));
        assert!(slot.lock().unwrap().is_none());
        // Still inside its 10 minutes: accepted.
        let fresh = PairCode {
            code: "c0ffee".into(),
            made: Instant::now() - PAIR_CODE_LIFETIME + Duration::from_secs(30),
        };
        assert!(try_code(&Mutex::new(Some(fresh)), "c0ffee"));
    }

    #[test]
    fn a_new_code_replaces_the_old_one() {
        let slot = Mutex::new(Some(PairCode::new("old111".into())));
        *slot.lock().unwrap() = Some(PairCode::new("new222".into()));
        assert!(!try_code(&slot, "old111"));
        // The wrong try used the new code up too.
        assert!(!try_code(&slot, "new222"));
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
            add_phone(&mut phones, Phone { id: format!("{i}"), name: "p".into(), may_answer: false, may_picture: false, may_read: false });
        }
        assert_eq!(phones.len(), MAX_PHONES);
        add_phone(&mut phones, Phone { id: "5".into(), name: "again".into(), may_answer: false, may_picture: false, may_read: false });
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
        add_phone(&mut phones, Phone { id: "a".into(), name: "Pixel".into(), may_answer: false, may_picture: false, may_read: false });
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
        add_phone(&mut phones, Phone { id: "b".into(), name: "Laptop".into(), may_answer: false, may_picture: false, may_read: false });
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
                args: ToolArgs { file: Some("notes.md".into()) },
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
        let read = |file: &str| ToolArgs { file: Some(file.into()) };
        // Each check wins over every later one, whatever else is wrong.
        assert_eq!(check_tool(false, true, "pc_info", CHAT, &ToolArgs::default()), Err(OFF_TOOLS.into()));
        assert_eq!(check_tool(false, false, "run_command", "x", &read("../x")), Err(OFF_TOOLS.into()));
        assert_eq!(check_tool(true, false, "run_command", "x", &read("../x")), Err(NOT_THIS_DEVICE_TOOLS.into()));
        assert_eq!(check_tool(true, true, "run_command", "x", &read("../x")), Err(NOT_A_REMOTE_TOOL.into()));
        assert!(check_tool(true, true, "workspace_read", "x", &read("notes.md")).is_err());
        // Only the fixed list, read only.
        assert_eq!(REMOTE_TOOLS, ["pc_info", "workspace_list", "workspace_read"]);
        for name in ["run_command", "open_file", "print_file", "clipboard_read", "fs_read", "", "PC_INFO"] {
            assert_eq!(check_tool(true, true, name, CHAT, &ToolArgs::default()), Err(NOT_A_REMOTE_TOOL.into()), "{name}");
        }
        assert_eq!(check_tool(true, true, "pc_info", CHAT, &ToolArgs::default()), Ok(RemoteCall::PcInfo));
        assert_eq!(check_tool(true, true, "workspace_list", CHAT, &read("x")), Ok(RemoteCall::WorkspaceList));
        assert_eq!(
            check_tool(true, true, "workspace_read", CHAT, &read("budget 2026.xlsx")),
            Ok(RemoteCall::WorkspaceRead("budget 2026.xlsx".into()))
        );
        // A path, `..`, a folder, a hidden or system name: refused.
        for bad in ["../secret.txt", "..", "a/b.txt", "a\\b.txt", "C:/Windows/win.ini", "/etc/passwd", ".env", "desktop.ini", "CON.txt"] {
            assert!(check_tool(true, true, "workspace_read", CHAT, &read(bad)).is_err(), "{bad}");
        }
        assert!(check_tool(true, true, "workspace_read", CHAT, &ToolArgs::default()).is_err());
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
        add_phone(&mut phones, Phone { id: "a".into(), name: "Pixel".into(), may_answer: false, may_picture: false, may_read: false });
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
            grants.add("a", &format!("chat-{i:020}"), start + Duration::from_millis(i as u64));
        }
        assert_eq!(grants.map.len(), MAX_READ_GRANTS);
        assert!(!grants.has("a", &format!("chat-{:020}", 0), start + Duration::from_secs(1)));
    }

    #[test]
    fn the_pc_says_who_reads_what() {
        let q = read_question("Pixel 8", CHAT);
        assert!(q.starts_with("\u{201c}Pixel 8\u{201d} asks to read files in your workspace for this chat."));
        assert!(q.contains("Chat: c0ffee-c…"));
        assert_eq!(read_note("Pixel 8", "budget.xlsx"), "Pixel 8 read budget.xlsx from the workspace");
    }
}
