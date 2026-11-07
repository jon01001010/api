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
//!   two things: ask whether a model is running ("status"), and pass HTTP
//!   requests to this PC's own model server on 127.0.0.1 ("http"). Nothing
//!   else on the PC is reachable: no files, no tools, no other ports.
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
const PAIR_CODE_LIFETIME: Duration = Duration::from_secs(10 * 60);
/// The credential store holds about 2.5 KB per entry: a few phones.
const MAX_PHONES: usize = 8;
const MAX_REQUEST_LINE: usize = 4096;

// ---------------------------------------------------------------- pure parts

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Phone {
    pub id: String,
    pub name: String,
}

/// What a phone asks for on each new stream (one JSON line).
#[derive(Debug, PartialEq, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Request {
    Pair { code: String, name: String },
    Status,
    Http,
}

pub fn parse_request(line: &[u8]) -> Option<Request> {
    if line.len() > MAX_REQUEST_LINE {
        return None;
    }
    serde_json::from_slice(line).ok()
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
fn read_entry(_app: &AppHandle, name: &str) -> Option<String> {
    keyring::Entry::new(name, "link").ok()?.get_password().ok()
}

#[cfg(windows)]
fn write_entry(_app: &AppHandle, name: &str, value: &str) -> Result<(), String> {
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
fn read_entry(app: &AppHandle, name: &str) -> Option<String> {
    std::fs::read_to_string(entry_file(app, name).ok()?).ok()
}

#[cfg(not(windows))]
fn write_entry(app: &AppHandle, name: &str, value: &str) -> Result<(), String> {
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

// ------------------------------------------------------------ the endpoint

#[derive(Default)]
pub struct Link {
    running: tokio::sync::Mutex<Option<iroh::protocol::Router>>,
    pair_code: Mutex<Option<PairCode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    on: bool,
    pc_id: Option<String>,
    phones: Vec<Phone>,
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
        loop {
            let Ok((send, recv)) = connection.accept_bi().await else {
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
    let request = read_line(&mut recv)
        .await
        .and_then(|line| parse_request(&line));
    let paired = load_phones(&app).iter().any(|p| p.id == remote);
    match request {
        Some(Request::Pair { code, name }) => {
            let link = app.state::<Link>();
            let code_ok = try_code(&link.pair_code, &code);
            let allowed = code_ok && {
                let name = clean_name(&name);
                let question = format!(
                    "Pair with the phone \u{201c}{name}\u{201d}?\n\nIt will be able to use the model running on this PC, from anywhere. It can't reach your files or anything else on this PC.\n\nPhone key: {}",
                    &remote[..remote.len().min(16)]
                );
                if crate::approval::ask(&app, &question).await {
                    let mut phones = load_phones(&app);
                    add_phone(&mut phones, Phone { id: remote.clone(), name });
                    save_phones(&app, &phones).is_ok()
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
                }),
            )
            .await;
        }
        Some(Request::Http) if paired => {
            let Some((port, _)) = app.state::<crate::model_server::ModelServer>().address() else {
                reply(&mut send, serde_json::json!({"ok": false, "error": "no model running"})).await;
                return Ok(());
            };
            // Only ever this PC's own model server.
            let tcp = tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .map_err(|e| e.to_string())?;
            reply(&mut send, serde_json::json!({"ok": true})).await;
            let (mut from_model, mut to_model) = tcp.into_split();
            let up = async {
                let _ = tokio::io::copy(&mut recv, &mut to_model).await;
                let _ = tokio::io::AsyncWriteExt::shutdown(&mut to_model).await;
            };
            let down = async {
                let _ = tokio::io::copy(&mut from_model, &mut send).await;
                let _ = send.finish();
            };
            tokio::join!(up, down);
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
    let qr = qr_text(&id, &code);
    Ok(Pairing {
        qr_image: qr_image(&qr)?,
        qr,
        expires_in_secs: PAIR_CODE_LIFETIME.as_secs(),
    })
}

/// Switches the link on for already paired phones (no new pairing).
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
        pc_id: running.as_ref().map(|r| r.endpoint().id().to_string()),
        phones: load_phones(&app),
    })
}

/// Removes a paired phone: it can't connect any more.
#[tauri::command]
pub async fn link_forget(app: AppHandle, id: String) -> Result<(), String> {
    let mut phones = load_phones(&app);
    phones.retain(|p| p.id != id);
    save_phones(&app, &phones)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_one_small_json_line() {
        assert_eq!(parse_request(br#"{"op":"status"}"#), Some(Request::Status));
        assert_eq!(parse_request(br#"{"op":"http"}"#), Some(Request::Http));
        assert_eq!(
            parse_request(br#"{"op":"pair","code":"ab","name":"Pixel"}"#),
            Some(Request::Pair { code: "ab".into(), name: "Pixel".into() })
        );
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
    fn names_are_cleaned_and_phones_capped() {
        assert_eq!(clean_name("Jo's Pixel 9"), "Jo's Pixel 9");
        assert_eq!(clean_name("<script>\n\u{202e}"), "script");
        assert_eq!(clean_name(""), "a phone");
        assert_eq!(clean_name(&"x".repeat(100)).len(), 40);
        let mut phones = Vec::new();
        for i in 0..(MAX_PHONES + 3) {
            add_phone(&mut phones, Phone { id: format!("{i}"), name: "p".into() });
        }
        assert_eq!(phones.len(), MAX_PHONES);
        add_phone(&mut phones, Phone { id: "5".into(), name: "again".into() });
        assert_eq!(phones.iter().filter(|p| p.id == "5").count(), 1);
    }

    #[test]
    fn qr_text_holds_the_key_and_code() {
        assert_eq!(qr_text("pk", "c0de"), "PA1:P:pk:c0de");
        let image = qr_image(&qr_text(&"a".repeat(64), &"b".repeat(32))).unwrap();
        assert!(image.starts_with("data:image/svg+xml;base64,"));
    }
}
