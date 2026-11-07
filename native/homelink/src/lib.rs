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
}

pub struct Phone {
    runtime: tokio::runtime::Runtime,
    endpoint: Endpoint,
    /// TEST/LAN only: a direct address for the PC (a real phone dials by key).
    pc_addr_hint: Option<SocketAddr>,
    connection: Mutex<Option<(EndpointId, Connection)>>,
    tunnel: Mutex<Option<(u16, tokio::task::JoinHandle<()>)>>,
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
    std::fs::write(key_file, key.to_bytes()).map_err(|e| e.to_string())?;
    Ok(key)
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

impl Phone {
    /// `key_file`: where the phone's own key lives (the app's private folder).
    pub fn new(key_file: &Path, pc_addr_hint: Option<SocketAddr>) -> Result<Phone, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let key = load_or_make_key(key_file)?;
        let endpoint = runtime
            .block_on(Endpoint::builder(presets::N0).secret_key(key).bind())
            .map_err(|e| e.to_string())?;
        Ok(Phone {
            runtime,
            endpoint,
            pc_addr_hint,
            connection: Mutex::new(None),
            tunnel: Mutex::new(None),
        })
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
        if let Some((id, conn)) = self.connection.lock().unwrap().as_ref() {
            if *id == pc && conn.close_reason().is_none() {
                return Ok(conn.clone());
            }
        }
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(self.address(pc), ALPN))
            .await
            .map_err(|_| "Could not reach the PC (is the home link on?)".to_string())?
            .map_err(|e| format!("Could not reach the PC: {e}"))?;
        *self.connection.lock().unwrap() = Some((pc, conn.clone()));
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
            Err("The PC did not pair (the code was used or expired, or pairing was refused)".into())
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
        })
    }

    /// Opens (or returns) the local port on 127.0.0.1 that leads to the
    /// PC's model server.
    pub fn open_tunnel(self: &std::sync::Arc<Self>, pc: &str) -> Result<u16, String> {
        let pc: EndpointId = pc.parse().map_err(|_| "Bad PC key".to_string())?;
        if let Some((port, task)) = self.tunnel.lock().unwrap().as_ref() {
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
        *self.tunnel.lock().unwrap() = Some((port, task));
        Ok(port)
    }

    pub fn close_tunnel(&self) {
        if let Some((_, task)) = self.tunnel.lock().unwrap().take() {
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
        tokio::join!(up, down);
        Ok(())
    }
}

#[cfg(feature = "android")]
mod android;

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

    #[test]
    fn the_phone_keeps_its_key() {
        let dir = std::env::temp_dir().join(format!("homelink-key-{}", std::process::id()));
        let file = dir.join("key");
        let first = load_or_make_key(&file).unwrap();
        let again = load_or_make_key(&file).unwrap();
        assert_eq!(first.public(), again.public());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
