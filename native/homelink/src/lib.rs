//! Home link, phone side (the PC side is src-tauri/src/link.rs).
//!
//! The phone pairs with the home PC from the PC's QR code, then opens a
//! local port on the phone (127.0.0.1 only) that leads, encrypted end to
//! end, to the PC's model server. The app adds that port as an ordinary
//! server ("Home PC"), so the existing chat code works unchanged.
//!
//! - The QR code is `PA1:P:<pc key>:<one-time code>` (the tag the app's
//!   one QR scanner uses for desktop pairing, see TODO.md).
//! - The phone has its own key; the PC lets it in only after the user
//!   allowed pairing on the PC. Only the model server is reachable.
//! - The local port answers this phone only (127.0.0.1), never the network.
//! - Removal notices (device circle stage 2, circle.rs): signed by the
//!   device that removed a device, passed on to the other paired devices
//!   with the status round trip; they can only remove.

pub mod circle;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use iroh::endpoint::{presets, Connection};
use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};
use serde::Serialize;

/// Must match the PC side (src-tauri/src/link.rs).
pub const ALPN: &[u8] = b"pocketagent/home-link/1";
pub const QR_PREFIX: &str = "PA1:P:";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_LINE: usize = 4096;
/// Most bytes sent or received by one sync (prompt + memories, 256 KiB each).
pub const MAX_SYNC: usize = 4 * 1024 * 1024;
/// Largest picture taken from the PC (the PC's own limit too).
pub const MAX_PICTURE: usize = 8 * 1024 * 1024;
/// How long a picture may take (the PC stops its maker after 10 minutes).
const PICTURE_TIME: Duration = Duration::from_secs(11 * 60);
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

/// A picture made on the PC for this device.
#[derive(Debug, PartialEq)]
pub struct Picture {
    pub png: Vec<u8>,
    pub seed: u64,
    pub seconds: u64,
}

/// Reads the PC's answer to "picture": a JSON line, then exactly the
/// announced bytes (at most MAX_PICTURE), which must be a PNG.
async fn read_picture(recv: &mut iroh::endpoint::RecvStream) -> Result<Picture, String> {
    let line = read_line(recv).await.ok_or("The PC did not answer")?;
    let answer: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if !answer_ok(&answer) {
        return Err(error_of(&answer, "The PC did not make the picture"));
    }
    let size = answer
        .get("bytes")
        .and_then(|b| b.as_u64())
        .ok_or("The PC's answer was not readable")?;
    if size == 0 || size > MAX_PICTURE as u64 {
        return Err("The picture is too large".into());
    }
    let mut png = vec![0u8; size as usize];
    recv.read_exact(&mut png)
        .await
        .map_err(|_| "The picture ended early".to_string())?;
    if !png.starts_with(PNG_MAGIC) {
        return Err("The PC did not send a picture".into());
    }
    Ok(Picture {
        png,
        seed: answer.get("seed").and_then(|v| v.as_u64()).unwrap_or(0),
        seconds: answer.get("seconds").and_then(|v| v.as_u64()).unwrap_or(0),
    })
}

/// Largest tool answer taken from the PC (the PC's own limit too).
pub const MAX_TOOL_ANSWER: usize = 2 * 1024 * 1024;
/// How long a tool may take (the PC may ask its user first).
const TOOL_TIME: Duration = Duration::from_secs(5 * 60);
/// Most text sent for the PC to write into one file (the PC's own limit,
/// link.rs / pc_write.rs MAX_WRITE).
pub const MAX_TOOL_TEXT: usize = 256 * 1024;

/// Reads the PC's answer to "tool": a JSON line, then exactly the
/// announced bytes (at most MAX_TOOL_ANSWER), which must be JSON.
async fn read_tool_answer(recv: &mut iroh::endpoint::RecvStream) -> Result<serde_json::Value, String> {
    let line = read_line(recv).await.ok_or("The PC did not answer")?;
    let answer: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if !answer_ok(&answer) {
        return Err(error_of(&answer, "The PC refused"));
    }
    let size = answer
        .get("bytes")
        .and_then(|b| b.as_u64())
        .ok_or("The PC's answer was not readable")?;
    if size == 0 || size > MAX_TOOL_ANSWER as u64 {
        return Err("The PC's answer is too large".into());
    }
    let mut body = vec![0u8; size as usize];
    recv.read_exact(&mut body)
        .await
        .map_err(|_| "The PC's answer ended early".to_string())?;
    serde_json::from_slice(&body).map_err(|_| "The PC's answer was not readable".to_string())
}

/// What a pairing QR code holds.
#[derive(Debug, PartialEq)]
pub struct PairingCode {
    pub pc: EndpointId,
    pub code: String,
}

/// Reads a pairing QR code; anything else is refused.
pub fn parse_qr(text: &str) -> Result<PairingCode, String> {
    let rest = text
        .trim()
        .strip_prefix(QR_PREFIX)
        .ok_or("This is not a PocketAgent pairing code")?;
    let (pc, code) = rest.split_once(':').ok_or("Incomplete pairing code")?;
    if code.len() != 32 || !code.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Incomplete pairing code".into());
    }
    let pc = pc
        .parse::<EndpointId>()
        .map_err(|_| "The PC's key in this code is not valid".to_string())?;
    Ok(PairingCode {
        pc,
        code: code.to_string(),
    })
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub api_key: Option<String>,
    /// The PC's pairing history (codes made, phones paired / removed), so
    /// the app can tell the user about new ones.
    pub events: serde_json::Value,
    /// Which commit the PC app was built from (to tell when phone and PC differ).
    pub build: Option<String>,
    /// The model the PC would start if asked (its file name), if any.
    pub last_model: Option<String>,
    /// How this phone reaches the PC right now: "direct", "relay", "mixed"
    /// or "unknown".
    pub route: String,
    /// Removal notices the PC passes on (circle.rs; checked by the caller
    /// before anything is removed).
    #[serde(skip)]
    pub removals: Vec<circle::Removal>,
}

pub struct Phone {
    runtime: tokio::runtime::Runtime,
    endpoint: Endpoint,
    /// TEST/LAN only: a direct address for the PC (a real phone dials by key).
    pc_addr_hint: Option<SocketAddr>,
    /// One open connection per PC (a device can use several Home PCs).
    connection: Mutex<HashMap<EndpointId, Connection>>,
    /// One local port per PC, each leading only to its own PC.
    tunnel: Mutex<HashMap<EndpointId, (u16, tokio::task::JoinHandle<()>)>>,
}

fn load_or_make_key(key_file: &Path) -> Result<SecretKey, String> {
    if let Ok(bytes) = std::fs::read(key_file) {
        if let Ok(arr) = <[u8; 32]>::try_from(bytes.as_slice()) {
            return Ok(SecretKey::from_bytes(&arr));
        }
    }
    let key = SecretKey::generate();
    if let Some(dir) = key_file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_private(key_file, &key.to_bytes()).map_err(|e| e.to_string())?;
    Ok(key)
}

/// The key file is readable by its owner only (0600 on Linux and Android).
#[cfg(unix)]
fn write_private(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(file)?;
    // An older file keeps its old mode on open: set it again.
    out.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    out.write_all(bytes)
}

#[cfg(not(unix))]
fn write_private(file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(file, bytes)
}

async fn read_line(recv: &mut iroh::endpoint::RecvStream) -> Option<String> {
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    while line.len() <= MAX_LINE {
        match recv.read(&mut byte).await {
            Ok(Some(1)) if byte[0] == b'\n' => return String::from_utf8(line).ok(),
            Ok(Some(1)) => line.push(byte[0]),
            _ => return None,
        }
    }
    None
}

fn answer_ok(answer: &serde_json::Value) -> bool {
    answer.get("ok").and_then(|v| v.as_bool()).unwrap_or(false)
}

fn error_of(answer: &serde_json::Value, otherwise: &str) -> String {
    answer
        .get("error")
        .and_then(|e| e.as_str())
        .unwrap_or(otherwise)
        .to_string()
}

impl Phone {
    /// `key_file`: where the phone's own key lives (the app's private folder).
    pub fn new(key_file: &Path, pc_addr_hint: Option<SocketAddr>) -> Result<Phone, String> {
        let key = load_or_make_key(key_file)?;
        Self::with_key(key.to_bytes(), pc_addr_hint)
    }

    /// With a key the caller keeps itself (the second PC keeps it in
    /// Windows' Credential Manager, out of the screens' reach).
    pub fn with_key(key: [u8; 32], pc_addr_hint: Option<SocketAddr>) -> Result<Phone, String> {
        let key = SecretKey::from_bytes(&key);
        let runtime = Self::runtime()?;
        let endpoint = runtime
            .block_on(Endpoint::builder(presets::N0).secret_key(key).bind())
            .map_err(|e| e.to_string())?;
        Ok(Self::on(runtime, endpoint, pc_addr_hint))
    }

    /// On an endpoint the caller already runs (a PC with one key: its own
    /// link endpoint, which also takes paired devices' connections), so
    /// the PC is the same key in both roles. One endpoint per key: two
    /// endpoints with one key would push each other off the relay. Closing
    /// the endpoint stays the caller's job.
    pub fn with_endpoint(endpoint: Endpoint, pc_addr_hint: Option<SocketAddr>) -> Result<Phone, String> {
        Ok(Self::on(Self::runtime()?, endpoint, pc_addr_hint))
    }

    fn runtime() -> Result<tokio::runtime::Runtime, String> {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| e.to_string())
    }

    fn on(runtime: tokio::runtime::Runtime, endpoint: Endpoint, pc_addr_hint: Option<SocketAddr>) -> Phone {
        Phone {
            runtime,
            endpoint,
            pc_addr_hint,
            connection: Mutex::new(HashMap::new()),
            tunnel: Mutex::new(HashMap::new()),
        }
    }

    pub fn id(&self) -> String {
        self.endpoint.id().to_string()
    }

    fn address(&self, pc: EndpointId) -> EndpointAddr {
        let addr = EndpointAddr::new(pc);
        match self.pc_addr_hint {
            Some(hint) => addr.with_ip_addr(hint),
            None => addr,
        }
    }

    /// The open connection to this PC, or a new one.
    async fn connection(&self, pc: EndpointId) -> Result<Connection, String> {
        if let Some(conn) = self.connection.lock().unwrap().get(&pc) {
            if conn.close_reason().is_none() {
                return Ok(conn.clone());
            }
        }
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(self.address(pc), ALPN))
            .await
            .map_err(|_| "Could not reach the PC (is the home link on?)".to_string())?
            .map_err(|e| format!("Could not reach the PC: {e}"))?;
        self.connection.lock().unwrap().insert(pc, conn.clone());
        Ok(conn)
    }

    /// Sends one request line and reads the PC's one-line answer.
    async fn ask(&self, pc: EndpointId, request: serde_json::Value) -> Result<serde_json::Value, String> {
        let conn = self.connection(pc).await?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        send.write_all(format!("{request}\n").as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        let _ = send.finish();
        let line = read_line(&mut recv).await.ok_or("The PC did not answer")?;
        serde_json::from_str(&line).map_err(|e| e.to_string())
    }

    /// Pairs with the PC from its QR code. The PC asks its user first; this
    /// waits for that answer. Returns the PC's key.
    pub fn pair(&self, qr: &str, phone_name: &str) -> Result<String, String> {
        let code = parse_qr(qr)?;
        let request = serde_json::json!({"op": "pair", "code": code.code, "name": phone_name});
        let answer = self.runtime.block_on(async {
            // The user may take a while to answer the dialog on the PC.
            tokio::time::timeout(Duration::from_secs(180), self.ask(code.pc, request))
                .await
                .map_err(|_| "No answer from the PC".to_string())?
        })?;
        if answer_ok(&answer) {
            Ok(code.pc.to_string())
        } else {
            Err(error_of(
                &answer,
                "The PC did not pair (the code was used or expired, or pairing was refused)",
            ))
        }
    }

    pub fn status(&self, pc: &str) -> Result<Status, String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        let answer = self
            .runtime
            .block_on(self.ask(pc, serde_json::json!({"op": "status"})))?;
        if !answer_ok(&answer) {
            return Err(answer
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("refused")
                .to_string());
        }
        Ok(Status {
            running: answer.get("running").and_then(|v| v.as_bool()).unwrap_or(false),
            api_key: answer.get("apiKey").and_then(|v| v.as_str()).map(String::from),
            events: answer.get("events").cloned().unwrap_or(serde_json::json!([])),
            build: answer.get("build").and_then(|v| v.as_str()).map(String::from),
            last_model: answer.get("lastModel").and_then(|v| v.as_str()).map(String::from),
            route: self.route(pc),
            removals: circle::notices_in(answer.get("removals")),
        })
    }

    /// This device's own key, for signing removal notices (circle.rs).
    pub fn secret_key(&self) -> iroh::SecretKey {
        self.endpoint.secret_key().clone()
    }

    /// Hands removal notices to the PC ("removal"; the PC checks each one
    /// itself and takes only good ones). At most circle::MAX_NOTICES.
    pub fn send_removals(&self, pc: &str, notices: &[circle::Removal]) -> Result<(), String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        let notices = &notices[..notices.len().min(circle::MAX_NOTICES)];
        let request = serde_json::json!({"op": "removal", "notices": notices});
        if request.to_string().len() + 1 > MAX_LINE {
            return Err("Too many notices at once".into());
        }
        let answer = self.runtime.block_on(self.ask(pc, request))?;
        if answer_ok(&answer) {
            Ok(())
        } else {
            Err(error_of(&answer, "The PC did not take the notices"))
        }
    }

    /// The phone's part of a status round trip for the circle: takes the
    /// notices the PC passed on (`removals`, from status), checked against
    /// the Home PCs this phone uses (the screens' list, and this PC), and
    /// hands this phone's waiting notices to the PC. Applied removals wait
    /// in the state for the screens (news), which remove the Home PC entry
    /// and tell the user. State: `file` (circle::state_file).
    pub fn circle_round(&self, pc: &str, removals: &[circle::Removal], file: &Path, now: u64) -> Result<(), String> {
        let mut state = circle::load(file);
        state.prune(now);
        let me = [self.id()];
        let mut trusted = state.uses.clone();
        trusted.push(pc.to_string());
        for notice in removals {
            if state.take(notice, &me, &trusted, Some(pc), now) == circle::Verdict::Apply {
                state.forget_used(&notice.removed);
                state.add_news(circle::News {
                    removed: notice.removed.clone(),
                    by: notice.by.clone(),
                    at: notice.at,
                    removed_name: None,
                    by_name: None,
                    told: false,
                });
            }
        }
        let out = state.outgoing_for(pc, now);
        if !out.is_empty() && self.send_removals(pc, &out).is_ok() {
            state.mark_sent(pc, &out);
        }
        circle::save(file, &state)
    }

    /// The screens' circle calls on the phone (JSON in, JSON out):
    /// - {"op":"remove","key":K,"homePcs":[...]}: the user removed K here;
    ///   a notice signed with this phone's key waits to be passed on.
    /// - {"op":"news","homePcs":[...]}: removals applied here since last
    ///   asked (once each).
    ///
    /// `homePcs`: the Home PCs this phone uses now (the only devices whose
    /// notices it takes). Nothing here adds a device or a right.
    pub fn circle_call(&self, request: &str, file: &Path, now: u64) -> serde_json::Value {
        let fail = |e: &str| serde_json::json!({"ok": false, "error": e});
        let Ok(request) = serde_json::from_str::<serde_json::Value>(request) else {
            return fail("Not a circle request");
        };
        let home_pcs: Vec<String> = request
            .get("homePcs")
            .and_then(|v| v.as_array())
            .map(|list| list.iter().filter_map(|k| k.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let mut state = circle::load(file);
        state.prune(now);
        state.set_uses(&home_pcs);
        let answer = match request.get("op").and_then(|o| o.as_str()) {
            Some("remove") => {
                let key = request.get("key").and_then(|k| k.as_str()).unwrap_or("");
                match state.sign(&self.secret_key(), key, now) {
                    Ok(_) => serde_json::json!({"ok": true}),
                    Err(e) => return fail(&e),
                }
            }
            Some("news") => serde_json::json!({"ok": true, "news": state.take_news()}),
            _ => return fail("Not a circle request"),
        };
        match circle::save(file, &state) {
            Ok(()) => answer,
            Err(e) => fail(&e),
        }
    }

    /// How the open connection to this PC goes right now: "direct" (straight
    /// to the PC, e.g. over Wi-Fi or a hotspot), "relay" (through a relay
    /// that can't read it), with the round-trip time; "not connected" when
    /// there is no open connection.
    fn route(&self, pc: EndpointId) -> String {
        let guard = self.connection.lock().unwrap();
        let Some(conn) = guard.get(&pc) else {
            return "not connected".into();
        };
        if conn.close_reason().is_some() {
            return "not connected".into();
        }
        let paths = conn.paths();
        let selected = paths.iter().find(|p| p.is_selected());
        match selected {
            Some(p) => {
                let kind = if p.is_ip() { "direct" } else if p.is_relay() { "relay" } else { "other" };
                format!("{kind}, {} ms", p.rtt().as_millis())
            }
            None => "connecting".into(),
        }
    }

    /// Keeps the system prompt and memory in step with the PC (only when the
    /// user switched it on, on both devices; the PC refuses otherwise).
    /// Sends this device's items after the request line; the PC answers with
    /// the agreed items (both are JSON, decided by the app's screens).
    pub fn sync(&self, pc: &str, body: &str) -> Result<String, String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        if body.len() > MAX_SYNC {
            return Err("Too much to keep in step".into());
        }
        self.runtime.block_on(async {
            let conn = self.connection(pc).await?;
            let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
            send.write_all(b"{\"op\":\"sync\"}\n").await.map_err(|e| e.to_string())?;
            send.write_all(body.as_bytes()).await.map_err(|e| e.to_string())?;
            let _ = send.finish();
            let answer = tokio::time::timeout(Duration::from_secs(60), recv.read_to_end(MAX_SYNC))
                .await
                .map_err(|_| "The PC did not answer".to_string())?
                .map_err(|e| e.to_string())?;
            String::from_utf8(answer).map_err(|e| e.to_string())
        })
    }

    /// Asks the PC to start the model it last ran (the PC decides which; it
    /// refuses one that would need an "Allow?" on the PC).
    pub fn start_model(&self, pc: &str) -> Result<(), String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        let answer = self
            .runtime
            .block_on(self.ask(pc, serde_json::json!({"op": "start"})))?;
        if answer_ok(&answer) {
            Ok(())
        } else {
            Err(answer
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("The PC did not start the model")
                .to_string())
        }
    }

    /// The PC's "Allow?" questions waiting for an answer (only while the
    /// user lets devices answer them on the PC). The PC's answer as it is:
    /// {"ok": true, "questions": [{"id", "text", "secondsLeft"}]}.
    pub fn questions(&self, pc: &str) -> Result<serde_json::Value, String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        let answer = self
            .runtime
            .block_on(self.ask(pc, serde_json::json!({"op": "questions"})))?;
        if answer_ok(&answer) {
            Ok(answer)
        } else {
            Err(error_of(&answer, "The PC refused"))
        }
    }

    /// Answers one of the PC's questions: yes or no, for that question only.
    pub fn answer_question(&self, pc: &str, id: u64, yes: bool) -> Result<(), String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        let answer = self.runtime.block_on(
            self.ask(pc, serde_json::json!({"op": "answer", "id": id, "yes": yes})),
        )?;
        if answer_ok(&answer) {
            Ok(())
        } else {
            Err(error_of(&answer, "The PC did not take the answer"))
        }
    }

    /// Asks the PC to make a picture (only while the user allows it on the
    /// PC, for this device; the PC refuses otherwise). The PC picks its own
    /// picture model and checks the prompt, sizes and steps itself; this
    /// sends nothing else. Waits until it is made (up to 11 minutes).
    pub fn picture(
        &self,
        pc: &str,
        prompt: &str,
        width: Option<u32>,
        height: Option<u32>,
        steps: Option<u32>,
    ) -> Result<Picture, String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        let request = serde_json::json!({
            "op": "picture",
            "prompt": prompt,
            "width": width,
            "height": height,
            "steps": steps,
        });
        let line = format!("{request}\n");
        if line.len() > MAX_LINE {
            return Err("The prompt is too long".into());
        }
        self.runtime.block_on(async {
            let conn = self.connection(pc).await?;
            let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
            send.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
            let _ = send.finish();
            tokio::time::timeout(PICTURE_TIME, read_picture(&mut recv))
                .await
                .map_err(|_| "The PC did not finish the picture in time".to_string())?
        })
    }

    /// Asks the PC for one of its tools (only while the user
    /// allows device tools on the PC, for this device; the PC refuses
    /// otherwise and checks everything itself). `chat`: this device's id
    /// for the chat asking (reading the workspace asks on the PC once per
    /// chat; an action, a command or a change asks there every time).
    /// `args_json`: only the named fields the PC takes are sent (a file's
    /// name, a media key, a command); the text to write (`content`, at most
    /// MAX_TOOL_TEXT) goes after the request line, its size in `bytes`.
    /// Waits up to 5 minutes (the PC may be asking its user).
    /// Answers {"ok": true, "result": …}.
    pub fn tool(&self, pc: &str, name: &str, chat: &str, args_json: &str) -> Result<serde_json::Value, String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        let given: serde_json::Value = serde_json::from_str(args_json).unwrap_or(serde_json::json!({}));
        let mut args = serde_json::Map::new();
        for field in ["file", "key", "command"] {
            if let Some(value) = given.get(field).and_then(|v| v.as_str()) {
                args.insert(field.into(), value.into());
            }
        }
        let text = given.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if given.get("content").is_some_and(|v| v.is_string()) {
            if text.len() > MAX_TOOL_TEXT {
                return Err(format!("The text is too large (at most {} KB)", MAX_TOOL_TEXT / 1024));
            }
            args.insert("bytes".into(), text.len().into());
        }
        // The model's thinking from just before the request, for the PC's
        // question only (it is shown there under "The model was
        // thinking:", never parsed): its end, cut so the line still fits.
        if let Some(thinking) = given.get("thinking").and_then(|v| v.as_str()) {
            let base = serde_json::json!({"op": "tool", "name": name, "chat": chat, "args": args}).to_string().len();
            // `,"thinking":""` and the line break.
            let room = MAX_LINE.saturating_sub(base + 16);
            if let Some(fit) = fit_thinking(thinking, room) {
                args.insert("thinking".into(), fit.into());
            }
        }
        let request = serde_json::json!({"op": "tool", "name": name, "chat": chat, "args": args});
        let line = format!("{request}\n");
        if line.len() > MAX_LINE {
            return Err("The request is too long".into());
        }
        let result = self.runtime.block_on(async {
            let conn = self.connection(pc).await?;
            let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
            send.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
            // The PC reads the text only if it accepts the request; if it
            // refused, its answer says why (read below).
            let _ = send.write_all(text.as_bytes()).await;
            let _ = send.finish();
            tokio::time::timeout(TOOL_TIME, read_tool_answer(&mut recv))
                .await
                .map_err(|_| "The PC did not answer in time".to_string())?
        })?;
        Ok(serde_json::json!({"ok": true, "result": result}))
    }

    /// Opens (or returns) the local port on 127.0.0.1 that leads to the
    /// PC's model server.
    pub fn open_tunnel(self: &std::sync::Arc<Self>, pc: &str) -> Result<u16, String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        // This PC's own port only: another PC's port leads to that PC.
        if let Some((port, task)) = self.tunnel.lock().unwrap().get(&pc) {
            if !task.is_finished() {
                return Ok(*port);
            }
        }
        let listener = self
            .runtime
            .block_on(tokio::net::TcpListener::bind(("127.0.0.1", 0)))
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let me = self.clone();
        let task = self.runtime.spawn(async move {
            while let Ok((socket, from)) = listener.accept().await {
                // Only this phone (127.0.0.1), never the network.
                if !from.ip().is_loopback() {
                    continue;
                }
                let me = me.clone();
                tokio::spawn(async move {
                    let _ = me.carry(pc, socket).await;
                });
            }
        });
        if let Some((_, old)) = self.tunnel.lock().unwrap().insert(pc, (port, task)) {
            old.abort();
        }
        Ok(port)
    }

    pub fn close_tunnel(&self) {
        for (_, (_, task)) in self.tunnel.lock().unwrap().drain() {
            task.abort();
        }
    }

    /// One local connection: carried to the PC's model server and back.
    async fn carry(&self, pc: EndpointId, socket: tokio::net::TcpStream) -> Result<(), String> {
        let conn = self.connection(pc).await?;
        let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
        send.write_all(b"{\"op\":\"http\"}\n").await.map_err(|e| e.to_string())?;
        let line = read_line(&mut recv).await.ok_or("The PC did not answer")?;
        let answer: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if !answer_ok(&answer) {
            return Err("The PC refused".into());
        }
        let (mut from_app, mut to_app) = socket.into_split();
        let up = async {
            let _ = tokio::io::copy(&mut from_app, &mut send).await;
            let _ = send.finish();
        };
        let down = async {
            let _ = tokio::io::copy(&mut recv, &mut to_app).await;
            let _ = tokio::io::AsyncWriteExt::shutdown(&mut to_app).await;
        };
        // The PC takes one request per stream and closes after answering
        // (its answer says "Connection: close"). Once the answer is in, the
        // local connection is closed too, so the app's next request comes
        // on a new connection, and so a new stream the PC checks again.
        tokio::pin!(up);
        tokio::pin!(down);
        tokio::select! {
            _ = &mut up => (&mut down).await,
            _ = &mut down => {}
        }
        Ok(())
    }
}

#[cfg(feature = "android")]
mod android;

/// The end of the model's thinking that fits in `room` bytes of JSON
/// (as written in the request line), starting with "…" when cut;
/// None when nothing fits or there is none.
pub fn fit_thinking(thinking: &str, room: usize) -> Option<String> {
    let thinking = thinking.trim();
    let width = |c: char| serde_json::Value::from(c.to_string()).to_string().len() - 2;
    let total: usize = thinking.chars().map(width).sum();
    if total <= room {
        return (!thinking.is_empty()).then(|| thinking.to_string());
    }
    let mark = '…';
    let mut used = width(mark);
    let mut kept: Vec<char> = Vec::new();
    for c in thinking.chars().rev() {
        if used + width(c) > room {
            break;
        }
        used += width(c);
        kept.push(c);
    }
    if kept.is_empty() {
        return None;
    }
    kept.push(mark);
    Some(kept.into_iter().rev().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PC: &str = "01ae154586a00ed5e9ca7df17207d236cbc324d7bd761f9b701a650954eeedcf";

    #[test]
    fn only_pocketagent_pairing_codes_are_read() {
        let code = "f49c4a5283473a85e70e5da15a5e13a9";
        let read = parse_qr(&format!("PA1:P:{PC}:{code}")).unwrap();
        assert_eq!(read.pc.to_string(), PC);
        assert_eq!(read.code, code);
        // A tool QR, a web address, a broken key or code: refused.
        assert!(parse_qr(&format!("PA1:T:{PC}:{code}")).is_err());
        assert!(parse_qr("https://example.com").is_err());
        assert!(parse_qr(&format!("PA1:P:notakey:{code}")).is_err());
        assert!(parse_qr(&format!("PA1:P:{PC}:short")).is_err());
        assert!(parse_qr(&format!("PA1:P:{PC}")).is_err());
    }

    /// A stand-in for the PC (src-tauri/src/link.rs): one request per
    /// stream, an answer streamed in parts, then the stream ends.
    fn fake_pc() -> (EndpointId, SocketAddr, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let streams = std::sync::Arc::new(AtomicUsize::new(0));
        let counted = streams.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let pc = Endpoint::builder(presets::Minimal)
                    .alpns(vec![ALPN.to_vec()])
                    .bind_addr("127.0.0.1:0")
                    .unwrap()
                    .bind()
                    .await
                    .unwrap();
                tx.send((pc.id(), pc.bound_sockets()[0])).unwrap();
                while let Some(incoming) = pc.accept().await {
                    let Ok(conn) = incoming.await else { continue };
                    let counted = counted.clone();
                    tokio::spawn(async move {
                        while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                            counted.fetch_add(1, Ordering::SeqCst);
                            tokio::spawn(async move {
                                assert_eq!(read_line(&mut recv).await.unwrap(), r#"{"op":"http"}"#);
                                send.write_all(b"{\"ok\":true}\n").await.unwrap();
                                let mut head = Vec::new();
                                let mut byte = [0u8; 1];
                                while !head.ends_with(b"\r\n\r\n") {
                                    recv.read_exact(&mut byte).await.unwrap();
                                    head.push(byte[0]);
                                }
                                send.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: 1\n\n")
                                    .await
                                    .unwrap();
                                tokio::time::sleep(Duration::from_millis(100)).await;
                                send.write_all(b"data: 2\n\n").await.unwrap();
                                let _ = send.finish();
                                let _ = send.stopped().await;
                            });
                        }
                    });
                }
            });
        });
        let (id, addr) = rx.recv().unwrap();
        (id, addr, streams)
    }

    #[test]
    fn each_answer_closes_the_local_connection_so_the_next_request_is_a_new_stream() {
        use std::io::{Read, Write};
        let (pc, addr, streams) = fake_pc();
        let dir = std::env::temp_dir().join(format!("homelink-tunnel-{}", std::process::id()));
        let phone = std::sync::Arc::new(Phone::new(&dir.join("key"), Some(addr)).unwrap());
        let port = phone.open_tunnel(&pc.to_string()).unwrap();
        for round in 1..=2 {
            let mut local = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            local.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
            // The app's client would keep this connection for more requests.
            local
                .write_all(b"POST /v1/chat/completions HTTP/1.1\r\nConnection: keep-alive\r\nContent-Length: 0\r\n\r\n")
                .unwrap();
            let mut answer = String::new();
            // Ends (rather than timing out) because the phone closes it.
            local.read_to_string(&mut answer).unwrap();
            assert!(answer.contains("Connection: close"), "{answer}");
            assert!(answer.ends_with("data: 1\n\ndata: 2\n\n"), "{answer}");
            assert_eq!(streams.load(std::sync::atomic::Ordering::SeqCst), round);
        }
        phone.close_tunnel();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Several Home PCs on one device (device-circle stage 1): each PC has
    /// its own local port, which leads only to that PC.
    #[test]
    fn each_home_pc_gets_its_own_local_port() {
        let other = SecretKey::generate().public().to_string();
        let dir = std::env::temp_dir().join(format!("homelink-ports-{}", std::process::id()));
        let phone = std::sync::Arc::new(Phone::new(&dir.join("key"), None).unwrap());
        let first = phone.open_tunnel(PC).unwrap();
        let second = phone.open_tunnel(&other).unwrap();
        assert_ne!(first, second);
        assert_eq!(phone.open_tunnel(PC).unwrap(), first);
        assert_eq!(phone.open_tunnel(&other).unwrap(), second);
        // Closing closes them all.
        phone.close_tunnel();
        assert!(phone.tunnel.lock().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A PC with one key (device-circle stage 1): its own endpoint takes a
    /// paired device's connection and also dials another PC as a device.
    /// The other PC sees the same key that the first PC's devices dial.
    #[test]
    fn one_endpoint_is_one_key_in_both_roles() {
        // The other PC: says which key dialled it.
        let (other_tx, other_rx) = std::sync::mpsc::channel();
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let pc = Endpoint::builder(presets::Minimal)
                    .alpns(vec![ALPN.to_vec()])
                    .bind_addr("127.0.0.1:0")
                    .unwrap()
                    .bind()
                    .await
                    .unwrap();
                other_tx.send((pc.id(), pc.bound_sockets()[0])).unwrap();
                while let Some(incoming) = pc.accept().await {
                    let Ok(conn) = incoming.await else { continue };
                    seen_tx.send(conn.remote_id()).unwrap();
                    while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                        let _ = read_line(&mut recv).await;
                        send.write_all(b"{\"ok\":true,\"running\":false}\n").await.unwrap();
                        let _ = send.finish();
                        let _ = send.stopped().await;
                    }
                }
            });
        });
        let (other, other_addr) = other_rx.recv().unwrap();
        // This PC: its link endpoint runs on a runtime of its own (the app's)
        // and takes devices' connections.
        let (this_tx, this_rx) = std::sync::mpsc::channel();
        let (device_tx, device_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let pc = Endpoint::builder(presets::Minimal)
                    .alpns(vec![ALPN.to_vec()])
                    .bind_addr("127.0.0.1:0")
                    .unwrap()
                    .bind()
                    .await
                    .unwrap();
                this_tx.send(pc.clone()).unwrap();
                while let Some(incoming) = pc.accept().await {
                    let Ok(conn) = incoming.await else { continue };
                    device_tx.send(conn.remote_id()).unwrap();
                    while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                        let _ = read_line(&mut recv).await;
                        send.write_all(b"{\"ok\":true,\"running\":true}\n").await.unwrap();
                        let _ = send.finish();
                        let _ = send.stopped().await;
                    }
                }
            });
        });
        let this_pc = this_rx.recv().unwrap();
        let this_id = this_pc.id();
        let this_addr = this_pc.bound_sockets()[0];
        // As a device of the other PC, on the very same endpoint.
        let as_device = Phone::with_endpoint(this_pc, Some(other_addr)).unwrap();
        assert_eq!(as_device.id(), this_id.to_string());
        assert!(!as_device.status(&other.to_string()).unwrap().running);
        assert_eq!(seen_rx.recv().unwrap(), this_id);
        // Meanwhile it still takes its own devices' connections.
        let dir = std::env::temp_dir().join(format!("homelink-one-key-{}", std::process::id()));
        let phone = Phone::new(&dir.join("key"), Some(this_addr)).unwrap();
        assert!(phone.status(&this_id.to_string()).unwrap().running);
        assert_eq!(device_rx.recv().unwrap().to_string(), phone.id());
        drop(as_device);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A stand-in PC that answers one "picture" request with `answer`.
    fn fake_picture_pc(answer: Vec<u8>) -> (EndpointId, SocketAddr, std::sync::mpsc::Receiver<String>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let pc = Endpoint::builder(presets::Minimal)
                    .alpns(vec![ALPN.to_vec()])
                    .bind_addr("127.0.0.1:0")
                    .unwrap()
                    .bind()
                    .await
                    .unwrap();
                tx.send((pc.id(), pc.bound_sockets()[0])).unwrap();
                while let Some(incoming) = pc.accept().await {
                    let Ok(conn) = incoming.await else { continue };
                    let answer = answer.clone();
                    let seen_tx = seen_tx.clone();
                    tokio::spawn(async move {
                        while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                            let line = read_line(&mut recv).await.unwrap();
                            seen_tx.send(line).unwrap();
                            send.write_all(&answer).await.unwrap();
                            let _ = send.finish();
                            let _ = send.stopped().await;
                        }
                    });
                }
            });
        });
        let (id, addr) = rx.recv().unwrap();
        (id, addr, seen_rx)
    }

    #[test]
    fn a_picture_comes_back_whole_and_only_as_a_png() {
        let png = [PNG_MAGIC, b"rest of the picture"].concat();
        let mut ok = format!("{{\"ok\":true,\"bytes\":{},\"seed\":7,\"seconds\":3}}\n", png.len()).into_bytes();
        ok.extend_from_slice(&png);
        let cases: Vec<(Vec<u8>, Result<Vec<u8>, &str>)> = vec![
            (ok, Ok(png.clone())),
            (b"{\"ok\":false,\"error\":\"Making pictures for paired devices is off on the PC\"}\n".to_vec(), Err("Making pictures for paired devices is off on the PC")),
            (format!("{{\"ok\":true,\"bytes\":{}}}\n", MAX_PICTURE + 1).into_bytes(), Err("The picture is too large")),
            ([b"{\"ok\":true,\"bytes\":5}\n".as_slice(), b"GIF89"].concat(), Err("The PC did not send a picture")),
            ([b"{\"ok\":true,\"bytes\":50}\n".as_slice(), PNG_MAGIC].concat(), Err("The picture ended early")),
        ];
        for (i, (answer, expected)) in cases.into_iter().enumerate() {
            let (pc, addr, seen) = fake_picture_pc(answer);
            let dir = std::env::temp_dir().join(format!("homelink-picture-{}-{i}", std::process::id()));
            let phone = Phone::new(&dir.join("key"), Some(addr)).unwrap();
            let got = phone.picture(&pc.to_string(), "a cat", Some(512), None, Some(4));
            match expected {
                Ok(bytes) => {
                    let got = got.unwrap();
                    assert_eq!(got.png, bytes);
                    assert_eq!((got.seed, got.seconds), (7, 3));
                }
                Err(message) => assert_eq!(got.unwrap_err(), message),
            }
            // Only the prompt, sizes and steps are sent: never a model or a path.
            let line: serde_json::Value = serde_json::from_str(&seen.recv().unwrap()).unwrap();
            assert_eq!(
                line,
                serde_json::json!({"op": "picture", "prompt": "a cat", "width": 512, "height": null, "steps": 4})
            );
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn a_tool_answer_comes_back_whole_and_only_as_json() {
        let body = br#"{"name":"notes.md","text":"hello","cut":false}"#;
        let mut ok = format!("{{\"ok\":true,\"bytes\":{}}}\n", body.len()).into_bytes();
        ok.extend_from_slice(body);
        let cases: Vec<(Vec<u8>, Result<serde_json::Value, &str>)> = vec![
            (ok, Ok(serde_json::json!({"ok": true, "result": {"name": "notes.md", "text": "hello", "cut": false}}))),
            (b"{\"ok\":false,\"error\":\"Using this PC's tools from paired devices is off on the PC\"}\n".to_vec(), Err("Using this PC's tools from paired devices is off on the PC")),
            (format!("{{\"ok\":true,\"bytes\":{}}}\n", MAX_TOOL_ANSWER + 1).into_bytes(), Err("The PC's answer is too large")),
            ([b"{\"ok\":true,\"bytes\":3}\n".as_slice(), b"<x>"].concat(), Err("The PC's answer was not readable")),
            ([b"{\"ok\":true,\"bytes\":50}\n".as_slice(), b"{}"].concat(), Err("The PC's answer ended early")),
        ];
        for (i, (answer, expected)) in cases.into_iter().enumerate() {
            let (pc, addr, seen) = fake_picture_pc(answer);
            let dir = std::env::temp_dir().join(format!("homelink-tool-{}-{i}", std::process::id()));
            let phone = Phone::new(&dir.join("key"), Some(addr)).unwrap();
            let got = phone.tool(&pc.to_string(), "workspace_read", "chat-0123456789abcdef", r#"{"file":"notes.md","path":"C:/x","cwd":"C:/"}"#);
            match expected {
                Ok(value) => assert_eq!(got.unwrap(), value),
                Err(message) => assert_eq!(got.unwrap_err(), message),
            }
            // Only the tool's name, the chat and a file name are sent.
            let line: serde_json::Value = serde_json::from_str(&seen.recv().unwrap()).unwrap();
            assert_eq!(
                line,
                serde_json::json!({"op": "tool", "name": "workspace_read", "chat": "chat-0123456789abcdef", "args": {"file": "notes.md"}})
            );
            let _ = std::fs::remove_dir_all(&dir);
        }
        // A media key goes on as its own named field, nothing else.
        let (pc, addr, seen) = fake_picture_pc([b"{\"ok\":true,\"bytes\":13}\n".as_slice(), b"{\"done\":true}"].concat());
        let dir = std::env::temp_dir().join(format!("homelink-tool-key-{}", std::process::id()));
        let phone = Phone::new(&dir.join("key"), Some(addr)).unwrap();
        let got = phone.tool(&pc.to_string(), "pc_media", "chat-0123456789abcdef", r#"{"key":"mute","shell":"rm"}"#);
        assert_eq!(got.unwrap(), serde_json::json!({"ok": true, "result": {"done": true}}));
        let line: serde_json::Value = serde_json::from_str(&seen.recv().unwrap()).unwrap();
        assert_eq!(
            line,
            serde_json::json!({"op": "tool", "name": "pc_media", "chat": "chat-0123456789abcdef", "args": {"key": "mute"}})
        );
        let _ = std::fs::remove_dir_all(&dir);
        // A command goes on as its own named field (the PC checks it and
        // asks its user), nothing else.
        let (pc, addr, seen) = fake_picture_pc([b"{\"ok\":true,\"bytes\":13}\n".as_slice(), b"{\"done\":true}"].concat());
        let dir = std::env::temp_dir().join(format!("homelink-tool-command-{}", std::process::id()));
        let phone = Phone::new(&dir.join("key"), Some(addr)).unwrap();
        let got = phone.tool(&pc.to_string(), "pc_run_command", "chat-0123456789abcdef", r#"{"command":"Get-Date","cwd":"C:/","always":true}"#);
        assert_eq!(got.unwrap(), serde_json::json!({"ok": true, "result": {"done": true}}));
        let line: serde_json::Value = serde_json::from_str(&seen.recv().unwrap()).unwrap();
        assert_eq!(
            line,
            serde_json::json!({"op": "tool", "name": "pc_run_command", "chat": "chat-0123456789abcdef", "args": {"command": "Get-Date"}})
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_thinking_is_cut_to_fit_the_line() {
        assert_eq!(fit_thinking("  short  ", 100).as_deref(), Some("short"));
        assert_eq!(fit_thinking("", 100), None);
        assert_eq!(fit_thinking("abc", 0), None);
        let cut = fit_thinking(&format!("{}{}", "a".repeat(500), "b".repeat(50)), 60).unwrap();
        assert!(cut.starts_with('\u{2026}') && cut.ends_with(&"b".repeat(50)), "{cut}");
        assert!(serde_json::Value::from(cut.clone()).to_string().len() - 2 <= 60, "{cut}");
        // Quotes and control characters take more room in JSON.
        let cut = fit_thinking(&"\"\n".repeat(100), 40).unwrap();
        assert!(serde_json::Value::from(cut).to_string().len() - 2 <= 40);
    }

    #[test]
    fn the_text_to_write_follows_the_request_line() {
        let (pc, addr, seen) = fake_tool_pc([b"{\"ok\":true,\"bytes\":13}\n".as_slice(), b"{\"done\":true}"].concat());
        let dir = std::env::temp_dir().join(format!("homelink-tool-write-{}", std::process::id()));
        let phone = Phone::new(&dir.join("key"), Some(addr)).unwrap();
        let text = "line one\nlíne two\n";
        let args = serde_json::json!({"file": "notes.md", "content": text, "path": "C:/x"}).to_string();
        let got = phone.tool(&pc.to_string(), "workspace_write", "chat-0123456789abcdef", &args);
        assert_eq!(got.unwrap(), serde_json::json!({"ok": true, "result": {"done": true}}));
        let (line, rest) = seen.recv().unwrap();
        let line: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(
            line,
            serde_json::json!({"op": "tool", "name": "workspace_write", "chat": "chat-0123456789abcdef", "args": {"file": "notes.md", "bytes": text.len()}})
        );
        assert_eq!(rest, text.as_bytes());
        // Too much text is refused before anything is sent.
        let big = serde_json::json!({"file": "notes.md", "content": "x".repeat(MAX_TOOL_TEXT + 1)}).to_string();
        assert!(phone.tool(&pc.to_string(), "workspace_write", "chat-0123456789abcdef", &big).is_err());
        // No content: nothing follows the line (undo, reads).
        let got = phone.tool(&pc.to_string(), "workspace_undo", "chat-0123456789abcdef", r#"{"file":"notes.md"}"#);
        assert!(got.is_ok());
        let (line, rest) = seen.recv().unwrap();
        assert!(!line.contains("bytes"));
        assert!(rest.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A PC that answers `answer` to each request and reports the request
    /// line and everything sent after it.
    fn fake_tool_pc(answer: Vec<u8>) -> (EndpointId, SocketAddr, std::sync::mpsc::Receiver<(String, Vec<u8>)>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let (seen_tx, seen_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let pc = Endpoint::builder(presets::Minimal)
                    .alpns(vec![ALPN.to_vec()])
                    .bind_addr("127.0.0.1:0")
                    .unwrap()
                    .bind()
                    .await
                    .unwrap();
                tx.send((pc.id(), pc.bound_sockets()[0])).unwrap();
                while let Some(incoming) = pc.accept().await {
                    let Ok(conn) = incoming.await else { continue };
                    let answer = answer.clone();
                    let seen_tx = seen_tx.clone();
                    tokio::spawn(async move {
                        while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                            let line = read_line(&mut recv).await.unwrap();
                            let rest = recv.read_to_end(MAX_TOOL_TEXT + 1).await.unwrap();
                            seen_tx.send((line, rest)).unwrap();
                            send.write_all(&answer).await.unwrap();
                            let _ = send.finish();
                            let _ = send.stopped().await;
                        }
                    });
                }
            });
        });
        let (id, addr) = rx.recv().unwrap();
        (id, addr, seen_rx)
    }

    /// Device circle stage 2: the phone takes good notices from the PC's
    /// status (as news for the screens), ignores ones about itself or from
    /// keys it doesn't trust, and hands its own notices to the PC once.
    #[test]
    fn removal_notices_go_both_ways_with_the_status_round_trip() {
        let pc_key = SecretKey::from_bytes(&[42; 32]);
        let other = SecretKey::from_bytes(&[43; 32]).public().to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        let (seen_tx, seen_rx) = std::sync::mpsc::channel::<String>();
        let (notices_tx, notices_rx) = std::sync::mpsc::channel::<serde_json::Value>();
        let key = pc_key.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let pc = Endpoint::builder(presets::Minimal)
                    .secret_key(key)
                    .alpns(vec![ALPN.to_vec()])
                    .bind_addr("127.0.0.1:0")
                    .unwrap()
                    .bind()
                    .await
                    .unwrap();
                tx.send((pc.id(), pc.bound_sockets()[0])).unwrap();
                while let Some(incoming) = pc.accept().await {
                    let Ok(conn) = incoming.await else { continue };
                    while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                        let line = read_line(&mut recv).await.unwrap();
                        seen_tx.send(line.clone()).unwrap();
                        let answer = if line.contains("\"status\"") {
                            let notices = notices_rx.recv().unwrap_or(serde_json::json!([]));
                            serde_json::json!({"ok": true, "running": false, "removals": notices})
                        } else {
                            serde_json::json!({"ok": true})
                        };
                        send.write_all(format!("{answer}\n").as_bytes()).await.unwrap();
                        let _ = send.finish();
                        let _ = send.stopped().await;
                    }
                }
            });
        });
        let (pc, addr) = rx.recv().unwrap();
        let pc_id = pc.to_string();
        let dir = std::env::temp_dir().join(format!("homelink-circle-round-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let phone = Phone::new(&dir.join("phone.key"), Some(addr)).unwrap();
        let file = circle::state_file(&dir.join("phone.key"));
        let now = circle::now();
        // The user removes a device on the phone: a notice signed by the phone.
        let removed_here = SecretKey::from_bytes(&[44; 32]).public().to_string();
        let answer = phone.circle_call(
            &serde_json::json!({"op": "remove", "key": removed_here, "homePcs": [pc_id]}).to_string(),
            &file,
            now,
        );
        assert_eq!(answer["ok"], true, "{answer}");
        // The PC passes on: a good one, one about this phone, one from a
        // key the phone doesn't trust.
        let good = circle::sign_removal(&pc_key, &other, now, now).unwrap();
        let about_me = circle::sign_removal(&pc_key, &phone.id(), now + 1, now).unwrap();
        let stranger = circle::sign_removal(&SecretKey::from_bytes(&[45; 32]), &other, now, now).unwrap();
        notices_tx.send(serde_json::json!([good, about_me, stranger])).unwrap();
        let status = phone.status(&pc_id).unwrap();
        assert_eq!(status.removals.len(), 3);
        phone.circle_round(&pc_id, &status.removals, &file, now).unwrap();
        assert_eq!(seen_rx.recv().unwrap(), r#"{"op":"status"}"#);
        let pushed: serde_json::Value = serde_json::from_str(&seen_rx.recv().unwrap()).unwrap();
        assert_eq!(pushed["op"], "removal");
        let pushed = circle::notices_in(pushed.get("notices"));
        assert_eq!(pushed.len(), 1);
        assert_eq!(pushed[0].removed, removed_here);
        assert_eq!(pushed[0].by, phone.id());
        // Only the good one is news, once.
        let news = phone.circle_call(&serde_json::json!({"op": "news", "homePcs": [pc_id]}).to_string(), &file, now);
        let list = news["news"].as_array().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["removed"], other);
        assert_eq!(list[0]["by"], pc_id);
        let again = phone.circle_call(&serde_json::json!({"op": "news", "homePcs": [pc_id]}).to_string(), &file, now);
        assert!(again["news"].as_array().unwrap().is_empty());
        // Next round: nothing sent twice, the same notices not taken twice.
        phone.circle_round(&pc_id, &[good], &file, now).unwrap();
        let news = phone.circle_call(&serde_json::json!({"op": "news", "homePcs": [pc_id]}).to_string(), &file, now);
        assert!(news["news"].as_array().unwrap().is_empty());
        assert!(seen_rx.try_recv().is_err());
        // Anything else is not a circle call; a device can't remove itself.
        assert_eq!(phone.circle_call(r#"{"op":"add","key":"x"}"#, &file, now)["ok"], false);
        let me = phone.id();
        assert_eq!(phone.circle_call(&serde_json::json!({"op": "remove", "key": me}).to_string(), &file, now)["ok"], false);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_phone_keeps_its_key() {
        let dir = std::env::temp_dir().join(format!("homelink-key-{}", std::process::id()));
        let file = dir.join("key");
        let first = load_or_make_key(&file).unwrap();
        let again = load_or_make_key(&file).unwrap();
        assert_eq!(first.public(), again.public());
        // Readable by its owner only.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&file).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
