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
pub struct ModelServer(pub Mutex<Option<Running>>);

/// The running server: its process, port and password (the home link
/// passes requests to it, link.rs).
pub struct Running {
    pub child: Child,
    pub port: u16,
    pub key: String,
}

impl ModelServer {
    /// Port and password of the running server, if it is still running.
    pub fn address(&self) -> Option<(u16, String)> {
        let mut guard = self.0.lock().unwrap();
        let running = guard.as_mut()?;
        if matches!(running.child.try_wait(), Ok(Some(_))) {
            return None;
        }
        Some((running.port, running.key.clone()))
    }
}

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
/// `model` is the real file; `name` is what the screens call it (the id the
/// server answers with); `projection` the vision part, if any.
pub fn server_args(
    model: &str,
    name: &str,
    projection: Option<&str>,
    port: u16,
    key: &str,
    context: u32,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
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
    ];
    // The server answers with this name (commas would split it in two).
    if name != model && !name.contains(',') {
        args.push("--alias".into());
        args.push(name.into());
    }
    if let Some(projection) = projection {
        args.push("--mmproj".into());
        args.push(projection.into());
    }
    args
}

fn is_gguf(path: &std::path::Path) -> bool {
    path.extension()
        .map(|e| e.eq_ignore_ascii_case("gguf"))
        .unwrap_or(false)
        && path.is_file()
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
    projection_path: Option<String>,
) -> Result<Started, String> {
    // A model the app downloaded is named by its own path (/pocketagent/…,
    // in the app's folder: no question); a file the user picked is a real
    // path (asks unless always allowed).
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let located = crate::files::locate(&root, &model_path)?;
    let model: PathBuf = located.real;
    if !model.is_absolute() || !is_gguf(&model) {
        return Err("Choose a .gguf model file".into());
    }
    let own_models = located.own || model.starts_with(&root);
    // The vision part: only one the app downloaded itself (no question).
    let projection = match projection_path.as_deref() {
        Some(p) => {
            let found = crate::files::locate(&root, p)?;
            if !found.own || !is_gguf(&found.real) {
                return Err("The vision file must be one the app downloaded".into());
            }
            Some(found.real)
        }
        None => None,
    };
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
    command.args(server_args(
        &model.to_string_lossy(),
        &model_path,
        projection.as_ref().map(|p| p.to_string_lossy()).as_deref(),
        port,
        &key,
        context.unwrap_or(8192),
    ));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command.spawn().map_err(|e| e.to_string())?;
    *server.0.lock().unwrap() = Some(Running {
        child,
        port,
        key: key.clone(),
    });
    Ok(Started {
        url: format!("http://127.0.0.1:{port}"),
        api_key: key,
    })
}

#[tauri::command(async)]
pub fn model_server_stop(server: State<'_, ModelServer>) {
    if let Some(mut running) = server.0.lock().unwrap().take() {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_listens_on_this_pc_only_with_a_password() {
        let args = server_args("C:/m.gguf", "m", None, 5000, "abc", 4096).join(" ");
        assert!(args.contains("--host 127.0.0.1"));
        assert!(args.contains("--api-key abc"));
        assert!(!args.contains("0.0.0.0"));
    }

    #[test]
    fn context_size_is_kept_in_a_safe_range() {
        assert!(server_args("m", "m", None, 1, "k", 1)
            .join(" ")
            .contains("--ctx-size 512"));
        assert!(server_args("m", "m", None, 1, "k", u32::MAX)
            .join(" ")
            .contains("--ctx-size 131072"));
    }

    #[test]
    fn a_downloaded_model_keeps_its_app_name_and_vision_part() {
        let args = server_args(
            "C:/Users/u/AppData/m.gguf",
            "/pocketagent/Documents/models/m.gguf",
            Some("C:/Users/u/AppData/mmproj.gguf"),
            1,
            "k",
            4096,
        )
        .join(" ");
        assert!(args.contains("--model C:/Users/u/AppData/m.gguf"));
        assert!(args.contains("--alias /pocketagent/Documents/models/m.gguf"));
        assert!(args.contains("--mmproj C:/Users/u/AppData/mmproj.gguf"));
        let plain = server_args("m", "m", None, 1, "k", 4096);
        assert!(!plain.contains(&"--mmproj".to_string()));
        assert!(!plain.contains(&"--alias".to_string()));
        assert!(!server_args("m", "a,b", None, 1, "k", 4096).contains(&"--alias".to_string()));
    }

    #[test]
    fn passwords_are_random_and_long() {
        let a = random_key().unwrap();
        let b = random_key().unwrap();
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}
