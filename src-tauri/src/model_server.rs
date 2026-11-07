//! Local models on Windows: the bundled llama.cpp server (`llama-server.exe`
//! and its DLLs, in the app's `llama` folder) runs the model file the user picks. It listens on
//! this PC only (127.0.0.1) and needs a random password, so other programs
//! and other computers can't use it. The app then talks to it like any
//! llama.cpp server. One model at a time.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct ModelServer(pub Mutex<Option<Child>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    url: String,
    api_key: String,
}

/// llama.cpp's server, shipped with its DLLs in the app's `llama` folder.
fn server_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("llama");
    let name = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };
    let path = dir.join(name);
    if path.is_file() {
        Ok(path)
    } else {
        Err("The model runner (llama-server) is missing from the app folder".into())
    }
}

fn random_key() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(listener.local_addr().map_err(|e| e.to_string())?.port())
}

/// The server's fixed settings: only the model file and context size vary.
pub fn server_args(model: &str, port: u16, key: &str, context: u32) -> Vec<String> {
    vec![
        "--model".into(),
        model.into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "--api-key".into(),
        key.into(),
        "--ctx-size".into(),
        context.clamp(512, 131_072).to_string(),
        "--jinja".into(),
        // Use the graphics card for every layer when there is one (Vulkan);
        // without one llama.cpp runs on the processor.
        "--n-gpu-layers".into(),
        "999".into(),
    ]
}

/// The user picks a model file (picking it is their consent to use it).
#[tauri::command]
pub async fn pick_model_file(app: AppHandle) -> Option<String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a model file (.gguf)")
            .add_filter("GGUF model", &["gguf"])
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn model_server_start(
    app: AppHandle,
    server: State<'_, ModelServer>,
    model_path: String,
    context: Option<u32>,
) -> Result<Started, String> {
    let model = PathBuf::from(&model_path);
    let is_gguf = model
        .extension()
        .map(|e| e.eq_ignore_ascii_case("gguf"))
        .unwrap_or(false);
    if !model.is_absolute() || !is_gguf || !model.is_file() {
        return Err("Choose a .gguf model file".into());
    }
    let own_models = app
        .path()
        .app_data_dir()
        .map(|d| model.starts_with(d))
        .unwrap_or(false);
    // Outside the app folder: ask, unless the user chose "Always allow this
    // file" for this exact file before (same path, size and time).
    let now = crate::remembered::fingerprint(&model);
    let remembered = now.as_ref().map(crate::remembered::is_remembered).unwrap_or(false);
    if !own_models && !remembered {
        let question = format!(
            "DesktopAgent wants to run this model on your PC:\n\n{}",
            model.display()
        );
        match crate::approval::ask_with_always(&app, &question).await {
            crate::approval::Answer::Once => {}
            crate::approval::Answer::Always => {
                if let Some(now) = &now {
                    crate::remembered::remember(now);
                }
            }
            crate::approval::Answer::No => {
                return Err("The user said no. Nothing was done.".into());
            }
        }
    }
    model_server_stop(server.clone());
    let port = free_port()?;
    let key = random_key()?;
    let exe = server_exe(&app)?;
    let mut command = Command::new(&exe);
    // Its DLLs sit next to it.
    if let Some(dir) = exe.parent() {
        command.current_dir(dir);
    }
    command.args(server_args(&model_path, port, &key, context.unwrap_or(8192)));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command.spawn().map_err(|e| e.to_string())?;
    *server.0.lock().unwrap() = Some(child);
    Ok(Started {
        url: format!("http://127.0.0.1:{port}"),
        api_key: key,
    })
}

#[tauri::command(async)]
pub fn model_server_stop(server: State<'_, ModelServer>) {
    if let Some(mut child) = server.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_listens_on_this_pc_only_with_a_password() {
        let args = server_args("C:/m.gguf", 5000, "abc", 4096).join(" ");
        assert!(args.contains("--host 127.0.0.1"));
        assert!(args.contains("--api-key abc"));
        assert!(!args.contains("0.0.0.0"));
    }

    #[test]
    fn context_size_is_kept_in_a_safe_range() {
        assert!(server_args("m", 1, "k", 1).join(" ").contains("--ctx-size 512"));
        assert!(server_args("m", 1, "k", u32::MAX)
            .join(" ")
            .contains("--ctx-size 131072"));
    }

    #[test]
    fn passwords_are_random_and_long() {
        let a = random_key().unwrap();
        let b = random_key().unwrap();
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}
