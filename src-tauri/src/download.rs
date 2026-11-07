//! Downloads straight to a file (models are gigabytes, so nothing passes
//! through the web screens), with progress, and cancellable. Into the app's
//! own folder needs no prompt; anywhere else asks first, like any write.
//! The file is written as `<name>.part` and renamed when complete, so a
//! broken download never looks like a finished model.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::io::AsyncWriteExt;

#[derive(Default)]
pub struct Downloads(Mutex<HashMap<u32, tauri::async_runtime::JoinHandle<()>>>);

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Begin { status_code: u16, content_length: u64 },
    #[serde(rename_all = "camelCase")]
    Progress { bytes_written: u64, content_length: u64 },
    #[serde(rename_all = "camelCase")]
    Done { status_code: u16, bytes_written: u64 },
    Error { message: String },
}

/// The partial file next to the target.
pub fn part_path(target: &std::path::Path) -> std::path::PathBuf {
    let mut name = target.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    target.with_file_name(name)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fs_download(
    app: AppHandle,
    downloads: State<'_, Downloads>,
    id: u32,
    url: String,
    path: String,
    headers: Vec<(String, String)>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let url = crate::net::check_url(&url)?;
    let target = crate::files::allowed_path(&app, &path, "save a download here").await?;
    let events = on_event.clone();
    let task = tauri::async_runtime::spawn(async move {
        download_to(url, target, headers, |event| {
            let _ = events.send(event);
        })
        .await;
    });
    downloads.0.lock().unwrap().insert(id, task);
    Ok(())
}


/// Streams `url` into `target` (via `<target>.part`), reporting each step.
pub async fn download_to(
    url: reqwest::Url,
    target: std::path::PathBuf,
    headers: Vec<(String, String)>,
    emit: impl Fn(DownloadEvent),
) {
    let fail = |message: String| emit(DownloadEvent::Error { message });
    if let Some(parent) = target.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return fail(e.to_string());
        }
    }
    let mut request = reqwest::Client::new().get(url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => return fail(e.to_string()),
    };
    let status = response.status().as_u16();
    let total = response.content_length().unwrap_or(0);
    emit(DownloadEvent::Begin {
        status_code: status,
        content_length: total,
    });
    if !response.status().is_success() {
        return emit(DownloadEvent::Done {
            status_code: status,
            bytes_written: 0,
        });
    }
    let part = part_path(&target);
    let mut file = match tokio::fs::File::create(&part).await {
        Ok(f) => f,
        Err(e) => return fail(e.to_string()),
    };
    let mut written: u64 = 0;
    let mut last = Instant::now();
    let mut stream = response.bytes_stream();
    while let Some(piece) = stream.next().await {
        let bytes = match piece {
            Ok(b) => b,
            Err(e) => return fail(e.to_string()),
        };
        if let Err(e) = file.write_all(&bytes).await {
            return fail(e.to_string());
        }
        written += bytes.len() as u64;
        if last.elapsed() >= Duration::from_millis(500) {
            last = Instant::now();
            emit(DownloadEvent::Progress {
                bytes_written: written,
                content_length: total,
            });
        }
    }
    if let Err(e) = file.flush().await {
        return fail(e.to_string());
    }
    drop(file);
    if let Err(e) = std::fs::rename(&part, &target) {
        return fail(e.to_string());
    }
    emit(DownloadEvent::Done {
        status_code: status,
        bytes_written: written,
    });
}

#[tauri::command(async)]
pub fn fs_download_cancel(downloads: State<'_, Downloads>, id: u32) {
    if let Some(task) = downloads.0.lock().unwrap().remove(&id) {
        task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_files_have_their_own_name() {
        let p = part_path(std::path::Path::new("/x/models/m.gguf"));
        assert_eq!(p, std::path::PathBuf::from("/x/models/m.gguf.part"));
    }

    /// A tiny one-shot web server on this machine for the test.
    fn serve_once(status: &str, body: Vec<u8>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let status = status.to_string();
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = sock.read(&mut buf);
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            sock.write_all(head.as_bytes()).unwrap();
            sock.write_all(&body).unwrap();
        });
        format!("http://{addr}/model.gguf")
    }

    fn run(url: String, target: std::path::PathBuf) -> Vec<String> {
        let events = std::sync::Mutex::new(Vec::new());
        tauri::async_runtime::block_on(download_to(
            reqwest::Url::parse(&url).unwrap(),
            target,
            vec![],
            |e| {
                let name = match e {
                    DownloadEvent::Begin { status_code, .. } => format!("begin {status_code}"),
                    DownloadEvent::Progress { .. } => "progress".into(),
                    DownloadEvent::Done { status_code, bytes_written } => {
                        format!("done {status_code} {bytes_written}")
                    }
                    DownloadEvent::Error { message } => format!("error {message}"),
                };
                events.lock().unwrap().push(name);
            },
        ));
        events.into_inner().unwrap()
    }

    #[test]
    fn downloads_a_file_byte_for_byte() {
        let body: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        let dir = std::env::temp_dir().join(format!("pa-dl-{}", std::process::id()));
        let target = dir.join("models").join("model.gguf");
        let events = run(serve_once("200 OK", body.clone()), target.clone());
        assert_eq!(events.first().unwrap(), "begin 200");
        assert_eq!(events.last().unwrap(), &format!("done 200 {}", body.len()));
        assert_eq!(std::fs::read(&target).unwrap(), body);
        assert!(!part_path(&target).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_failed_download_leaves_no_model_file() {
        let dir = std::env::temp_dir().join(format!("pa-dl404-{}", std::process::id()));
        let target = dir.join("model.gguf");
        let events = run(serve_once("404 Not Found", b"nope".to_vec()), target.clone());
        assert_eq!(events, vec!["begin 404".to_string(), "done 404 0".to_string()]);
        assert!(!target.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
