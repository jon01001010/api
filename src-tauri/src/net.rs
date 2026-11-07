//! Network for the app: the web view itself has no internet access (its
//! content security policy allows only the app and this bridge), so cloud
//! models, search and page reading go through here, like on the phone (no
//! browser cross-site limits). The response streams back in pieces so chat
//! replies appear as they arrive.

use std::collections::HashMap;
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Default)]
pub struct Requests(Mutex<HashMap<u32, tauri::async_runtime::JoinHandle<()>>>);

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NetEvent {
    Head { status: u16, headers: Vec<(String, String)>, url: String },
    Chunk { data: String },
    End,
    Error { message: String },
}

/// Only plain web addresses: no files, no other schemes.
pub fn check_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("Bad address: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("Only http and https are allowed, not {other}")),
    }
}

/// Text from a byte stream, keeping a multi-byte character that is split
/// across two pieces whole.
pub fn take_text(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(text) => {
            let out = text.to_string();
            pending.clear();
            out
        }
        Err(e) => {
            let good = e.valid_up_to();
            // A broken byte (not just a split character): replace it.
            if e.error_len().is_some() {
                let out = String::from_utf8_lossy(pending).into_owned();
                pending.clear();
                return out;
            }
            let out = String::from_utf8_lossy(&pending[..good]).into_owned();
            pending.drain(..good);
            out
        }
    }
}

#[tauri::command]
pub async fn http_request(
    requests: State<'_, Requests>,
    id: u32,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    on_event: Channel<NetEvent>,
) -> Result<(), String> {
    let url = check_url(&url)?;
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|e| e.to_string())?;
    let events = on_event.clone();
    let task = tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let mut request = client.request(method, url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        if let Some(body) = body {
            request = request.body(body);
        }
        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = events.send(NetEvent::Error { message: e.to_string() });
                return;
            }
        };
        let head = NetEvent::Head {
            status: response.status().as_u16(),
            url: response.url().to_string(),
            headers: response
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                .collect(),
        };
        let _ = events.send(head);
        let mut stream = response.bytes_stream();
        let mut pending = Vec::new();
        while let Some(piece) = stream.next().await {
            match piece {
                Ok(bytes) => {
                    pending.extend_from_slice(&bytes);
                    let data = take_text(&mut pending);
                    if !data.is_empty() {
                        let _ = events.send(NetEvent::Chunk { data });
                    }
                }
                Err(e) => {
                    let _ = events.send(NetEvent::Error { message: e.to_string() });
                    return;
                }
            }
        }
        if !pending.is_empty() {
            let _ = events.send(NetEvent::Chunk {
                data: String::from_utf8_lossy(&pending).into_owned(),
            });
        }
        let _ = events.send(NetEvent::End);
    });
    requests.0.lock().unwrap().insert(id, task);
    Ok(())
}

#[tauri::command]
pub fn http_abort(requests: State<'_, Requests>, id: u32) {
    if let Some(task) = requests.0.lock().unwrap().remove(&id) {
        task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_addresses() {
        assert!(check_url("https://api.example.com/v1").is_ok());
        assert!(check_url("http://127.0.0.1:8080/v1").is_ok());
        assert!(check_url("file:///C:/Windows/win.ini").is_err());
        assert!(check_url("javascript:alert(1)").is_err());
        assert!(check_url("not a url").is_err());
    }

    #[test]
    fn split_characters_stay_whole() {
        let text = "héllo 🌍";
        let bytes = text.as_bytes();
        let mut pending = bytes[..2].to_vec(); // "h" + half of "é"
        assert_eq!(take_text(&mut pending), "h");
        pending.extend_from_slice(&bytes[2..]);
        assert_eq!(take_text(&mut pending), "éllo 🌍");
        assert!(pending.is_empty());
    }
}
