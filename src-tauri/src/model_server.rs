//! Local models on Windows: the bundled llama.cpp server (`llama-server.exe`
//! and its DLLs, in the app's `llama` folder) runs the model file the user picks. It listens on
//! this PC only (127.0.0.1) and needs a random password, so other programs
//! and other computers can't use it. The app then talks to it like any
//! llama.cpp server. One model at a time.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
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
pub(crate) fn server_exe(app: &AppHandle) -> Result<PathBuf, String> {
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
/// llama-server reads its password from this variable (not `--api-key`).
pub const PASSWORD_ENV: &str = "LLAMA_API_KEY";

/// `model` is the real file; `name` is what the screens call it (the id the
/// server answers with); `projection` the vision part, if any.
pub fn server_args(
    model: &str,
    name: &str,
    projection: Option<&str>,
    port: u16,
    context: u32,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--model".into(),
        model.into(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string(),
        "--ctx-size".into(),
        context.clamp(512, 131_072).to_string(),
        "--jinja".into(),
        // Graphics card: llama.cpp fits the model itself (`--fit`, on by
        // default): as many layers on the card as fit, the rest in memory.
        // Forcing every layer onto the card (`--n-gpu-layers 999`, before
        // 2026-11-09) turned that off, so a model bigger than the card failed.
        "--fit".into(),
        "on".into(),
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

/// The model last started on this PC, so a paired phone can start it again
/// (link.rs). Kept in the app's folder; checked again on every start.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastModel {
    pub model_path: String,
    pub context: u32,
    pub projection_path: Option<String>,
}

fn last_model_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("model-server-last.json"))
}

pub fn load_last_model(app: &AppHandle) -> Option<LastModel> {
    let text = std::fs::read_to_string(last_model_file(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

fn save_last_model(app: &AppHandle, last: &LastModel) {
    if let Some(file) = last_model_file(app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(file, serde_json::to_string(last).unwrap_or_default());
    }
}

/// Who started it: the user on the PC (may be asked "Allow?"), or a paired
/// phone over the home link (never asked: nobody may be at the PC, so a
/// model that would need a question is refused instead).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StartedBy {
    User,
    Phone,
}

#[tauri::command]
pub async fn model_server_start(
    app: AppHandle,
    model_path: String,
    context: Option<u32>,
    projection_path: Option<String>,
) -> Result<Started, String> {
    start_model(&app, model_path, context, projection_path, StartedBy::User).await
}

/// Starts the model server (the PC's button, or a paired phone).
pub async fn start_model(
    app: &AppHandle,
    model_path: String,
    context: Option<u32>,
    projection_path: Option<String>,
    by: StartedBy,
) -> Result<Started, String> {
    let server = app.state::<ModelServer>();
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
    if !own_models && !remembered && by == StartedBy::Phone {
        return Err("This model needs your OK on the PC first: run it once on the PC and choose \"Always allow this file\".".into());
    }
    if !own_models && !remembered {
        let question = format!(
            "DesktopAgent wants to run this model on your PC:\n\n{}",
            model.display()
        );
        match crate::approval::ask_with_always(app, &question).await {
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
    let exe = server_exe(app)?;
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
        context.unwrap_or(8192),
    ));
    // The password by environment, never on the command line (any program on
    // the PC can read a process's command line).
    command.env(PASSWORD_ENV, &key);
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
    save_last_model(
        app,
        &LastModel {
            model_path,
            context: context.unwrap_or(8192),
            projection_path,
        },
    );
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
        let args = server_args("C:/m.gguf", "m", None, 5000, 4096).join(" ");
        assert!(args.contains("--host 127.0.0.1"));
        // The password is never on the command line (PASSWORD_ENV instead).
        assert!(!args.contains("--api-key"));
        assert!(!args.contains("abc"));
        assert!(!args.contains("0.0.0.0"));
    }

    #[test]
    fn llama_cpp_fits_the_model_to_the_graphics_card() {
        let args = server_args("m", "m", None, 1, 4096).join(" ");
        assert!(args.contains("--fit on"));
        assert!(!args.contains("--n-gpu-layers"));
    }

    #[test]
    fn context_size_is_kept_in_a_safe_range() {
        assert!(server_args("m", "m", None, 1, 1)
            .join(" ")
            .contains("--ctx-size 512"));
        assert!(server_args("m", "m", None, 1, u32::MAX)
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
            4096,
        )
        .join(" ");
        assert!(args.contains("--model C:/Users/u/AppData/m.gguf"));
        assert!(args.contains("--alias /pocketagent/Documents/models/m.gguf"));
        assert!(args.contains("--mmproj C:/Users/u/AppData/mmproj.gguf"));
        let plain = server_args("m", "m", None, 1, 4096);
        assert!(!plain.contains(&"--mmproj".to_string()));
        assert!(!plain.contains(&"--alias".to_string()));
        assert!(!server_args("m", "a,b", None, 1, 4096).contains(&"--alias".to_string()));
    }

    #[test]
    fn the_last_model_is_kept_by_name_not_by_the_phone() {
        let last = LastModel {
            model_path: "/pocketagent/Documents/models/m.gguf".into(),
            context: 8192,
            projection_path: None,
        };
        let text = serde_json::to_string(&last).unwrap();
        assert_eq!(serde_json::from_str::<LastModel>(&text).unwrap(), last);
        // A phone never gets a dialog: refused instead (see start_model).
        assert_ne!(StartedBy::Phone, StartedBy::User);
    }

    #[test]
    fn passwords_are_random_and_long() {
        let a = random_key().unwrap();
        let b = random_key().unwrap();
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}
