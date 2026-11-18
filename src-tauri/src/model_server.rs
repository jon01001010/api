//! Local models on Windows: the bundled llama.cpp server (`llama-server.exe`
//! and its DLLs, in the app's `llama` folder) runs the model file the user picks. It listens on
//! this PC only (127.0.0.1) and needs a random password, so other programs
//! and other computers can't use it. The app then talks to it like any
//! llama.cpp server. One model at a time.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

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
    /// The server's last log lines, kept in memory only, to say why it
    /// stopped while loading (`start_problem`). Never shown as they are.
    pub log: Arc<Mutex<VecDeque<String>>>,
}

/// The llama.cpp build that comes with the app (LLAMA_TAG in the build files).
pub const LLAMA_CPP_BUILD: &str = "b11662";

/// How many of the server's last log lines are kept.
const LOG_LINES: usize = 40;

/// The model type llama.cpp didn't know, from its own words when loading
/// fails: `unknown model architecture: 'qwen9'` (llama-model.cpp).
pub fn unknown_architecture(log: &str) -> Option<String> {
    const SAID: &str = "unknown model architecture: '";
    let start = log.find(SAID)? + SAID.len();
    let rest = &log[start..];
    let name: String = rest[..rest.find('\'')?]
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(40)
        .collect();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Why the server stopped while loading, in plain words, from its last log
/// lines. Only known reasons; anything else gets the general message.
pub fn start_problem(lines: &[String]) -> String {
    let log = lines.join("\n");
    match unknown_architecture(&log) {
        Some(arch) => format!(
            "This model ({arch}) needs a newer llama.cpp than the one bundled ({LLAMA_CPP_BUILD}). Try another model, or a newer DesktopAgent when there is one."
        ),
        None => "The model did not start. Is it a valid .gguf file?".into(),
    }
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

/// Why the model server stopped while loading, or None while it is still
/// running (or none was started). The screens ask while they wait.
#[tauri::command(async)]
pub fn model_server_problem(server: State<'_, ModelServer>) -> Option<String> {
    let mut guard = server.0.lock().unwrap();
    let running = guard.as_mut()?;
    if !matches!(running.child.try_wait(), Ok(Some(_))) {
        return None;
    }
    let lines: Vec<String> = running.log.lock().unwrap().iter().cloned().collect();
    Some(start_problem(&lines))
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
        // No /slots: it would hand out the last prompt and reply (the PC
        // user's chat, memory, tool output) to anyone who can reach the
        // server, paired devices included. /metrics, POST /props and
        // slot saving stay off too (llama.cpp's defaults; never turned on).
        "--no-slots".into(),
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

/// A LoRA adapter for the model (a small .gguf file that changes its style;
/// the model file itself is never changed). llama-server reads
/// `--lora-scaled FILE:SCALE` and splits it on ':' and ',', so a Windows path
/// ("C:\…") can't be given whole: the adapter is named from the root of its
/// drive, which must be the server's drive (the server runs in its own folder,
/// never in the app's data folder, because llama.cpp also looks for its
/// backend DLLs in the folder it runs in). Pure, so it can be tested.
pub fn lora_args(adapter: &str, exe: &str, scale: f32) -> Result<Vec<String>, String> {
    fn drive(p: &str) -> (Option<char>, &str) {
        let b = p.as_bytes();
        if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
            (Some(b[0].to_ascii_uppercase() as char), &p[2..])
        } else {
            (None, p)
        }
    }
    let (adapter_drive, rest) = drive(adapter);
    if adapter_drive != drive(exe).0 {
        return Err("The adapter must be on the same drive as DesktopAgent".into());
    }
    let rooted = rest.starts_with('/') || rest.starts_with('\\');
    let network = rest.starts_with("//") || rest.starts_with("\\\\");
    if !rooted || network || rest.contains([':', ',', '"']) || rest.chars().any(char::is_control) {
        return Err("This adapter's file name can't be used (no ':', ',' or '\"')".into());
    }
    let scale = if scale.is_finite() { scale.clamp(0.0, 1.0) } else { 1.0 };
    Ok(vec!["--lora-scaled".into(), format!("{rest}:{scale:.2}")])
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
    /// The adapter the PC user chose for it, if any (never one from a phone).
    #[serde(default)]
    pub lora_path: Option<String>,
    #[serde(default)]
    pub lora_scale: Option<f32>,
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
    lora_path: Option<String>,
    lora_scale: Option<f32>,
) -> Result<Started, String> {
    let lora = lora_path.map(|p| (p, lora_scale.unwrap_or(1.0)));
    start_model(&app, model_path, context, projection_path, lora, StartedBy::User).await
}

/// Starts the model server (the PC's button, or a paired phone).
pub async fn start_model(
    app: &AppHandle,
    model_path: String,
    context: Option<u32>,
    projection_path: Option<String>,
    lora: Option<(String, f32)>,
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
    // In the app's folder and staying there once links are followed: a link
    // placed there to a file elsewhere is asked about like that file.
    let own_models = (located.own || model.starts_with(&root)) && crate::files::stays_inside(&root, &model);
    // The vision part: only one the app downloaded itself (no question),
    // never a link leading out of the app's folder.
    let projection = match projection_path.as_deref() {
        Some(p) => {
            let found = crate::files::locate(&root, p)?;
            if !found.own || !is_gguf(&found.real) || !crate::files::stays_inside(&root, &found.real) {
                return Err("The vision file must be one the app downloaded".into());
            }
            Some(found.real)
        }
        None => None,
    };
    // The adapter: like the vision part, only a file in the app's own folder
    // (added there by the user through the app's own file import), never a
    // link pointing elsewhere.
    let exe = server_exe(app)?;
    let lora_arguments = match &lora {
        Some((p, scale)) => {
            let found = crate::files::locate(&root, p)?;
            let link = std::fs::symlink_metadata(&found.real)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(true);
            if !found.own || link || !is_gguf(&found.real) {
                return Err("The adapter must be a .gguf file added to the app's own folder".into());
            }
            lora_args(&found.real.to_string_lossy(), &exe.to_string_lossy(), *scale)?
        }
        None => Vec::new(),
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
    command.args(&lora_arguments);
    // The password by environment, never on the command line (any program on
    // the PC can read a process's command line).
    command.env(PASSWORD_ENV, &key);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    // Its log is read so a failed start can say why (start_problem); read
    // to the end so the server never waits on a full pipe.
    command.stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let log = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(stderr) = child.stderr.take() {
        let log = log.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = Vec::new();
            while matches!(reader.read_until(b'\n', &mut line), Ok(n) if n > 0) {
                let mut kept = log.lock().unwrap();
                if kept.len() == LOG_LINES {
                    kept.pop_front();
                }
                kept.push_back(String::from_utf8_lossy(&line).trim_end().chars().take(400).collect());
                drop(kept);
                line.clear();
            }
        });
    }
    *server.0.lock().unwrap() = Some(Running {
        child,
        port,
        key: key.clone(),
        log,
    });
    save_last_model(
        app,
        &LastModel {
            model_path,
            context: context.unwrap_or(8192),
            projection_path,
            lora_path: lora.as_ref().map(|(p, _)| p.clone()),
            lora_scale: lora.as_ref().map(|(_, s)| *s),
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
    fn the_server_never_hands_out_other_conversations() {
        let args = server_args("m", "m", Some("p"), 1, 4096);
        assert!(args.iter().any(|a| a == "--no-slots"));
        for off in ["--slots", "--metrics", "--props", "--slot-save-path", "--api-key"] {
            assert!(!args.iter().any(|a| a == off), "{off}");
        }
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
            lora_path: Some("/pocketagent/Documents/models/lora/a.gguf".into()),
            lora_scale: Some(0.8),
        };
        let text = serde_json::to_string(&last).unwrap();
        assert_eq!(serde_json::from_str::<LastModel>(&text).unwrap(), last);
        // Saved before adapters existed: none.
        let old: LastModel =
            serde_json::from_str(r#"{"modelPath":"m","context":8192,"projectionPath":null}"#).unwrap();
        assert_eq!(old.lora_path, None);
        // A phone never gets a dialog: refused instead (see start_model).
        assert_ne!(StartedBy::Phone, StartedBy::User);
    }

    #[test]
    fn a_model_type_llama_cpp_does_not_know_says_it_needs_a_newer_one() {
        let lines: Vec<String> = [
            "llama_model_loader: loaded meta data with 30 key-value pairs",
            "llama_model_load: error loading model: error loading model architecture: unknown model architecture: 'qwen9moe'",
            "llama_model_load_from_file_impl: failed to load model",
            "main: exiting due to model loading error",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(unknown_architecture(&lines.join("\n")).as_deref(), Some("qwen9moe"));
        let said = start_problem(&lines);
        assert!(said.starts_with("This model (qwen9moe) needs a newer llama.cpp"));
        assert!(said.contains("(b11662)"));
        // Anything else: the general message, never the raw log.
        let other = start_problem(&["error loading model: failed to open file".to_string()]);
        assert_eq!(other, "The model did not start. Is it a valid .gguf file?");
        assert_eq!(start_problem(&[]), other);
        // Only a plain name is repeated back.
        assert_eq!(
            unknown_architecture("unknown model architecture: 'a<b>/c d'").as_deref(),
            Some("abcd")
        );
        assert_eq!(unknown_architecture("unknown model architecture: ''"), None);
        assert_eq!(unknown_architecture("unknown model architecture: 'open"), None);
    }

    #[test]
    fn an_adapter_is_passed_with_its_strength() {
        let exe = r"C:\Program Files\DesktopAgent\llama\llama-server.exe";
        let args = lora_args(
            r"C:\Users\u\AppData\Roaming\app\Documents\models\lora\my-style.gguf",
            exe,
            0.8,
        )
        .unwrap();
        assert_eq!(
            args,
            vec![
                "--lora-scaled".to_string(),
                r"\Users\u\AppData\Roaming\app\Documents\models\lora\my-style.gguf:0.80".to_string()
            ]
        );
        // The same drive, in any letter case.
        assert!(lora_args("c:/a/b.gguf", exe, 1.0).is_ok());
        // Linux: a plain path.
        assert_eq!(
            lora_args(
                "/home/u/.local/share/app/Documents/models/lora/a.gguf",
                "/usr/lib/app/llama/llama-server",
                1.0
            )
            .unwrap()[1],
            "/home/u/.local/share/app/Documents/models/lora/a.gguf:1.00"
        );
    }

    #[test]
    fn an_adapter_strength_stays_between_0_and_1() {
        let at = |s: f32| lora_args("/a/b.gguf", "/x/llama-server", s).unwrap()[1].clone();
        assert_eq!(at(0.0), "/a/b.gguf:0.00");
        assert_eq!(at(2.0), "/a/b.gguf:1.00");
        assert_eq!(at(-1.0), "/a/b.gguf:0.00");
        assert_eq!(at(f32::NAN), "/a/b.gguf:1.00");
    }

    #[test]
    fn an_adapter_path_llama_cpp_would_misread_is_refused() {
        let exe = "C:/llama/llama-server.exe";
        // Another drive (the server can't name it without "D:").
        assert!(lora_args("D:/a/b.gguf", exe, 1.0).is_err());
        assert!(lora_args("C:/a/b.gguf", "/usr/bin/llama-server", 1.0).is_err());
        // Separators llama.cpp splits on, quotes, control characters.
        for bad in ["C:/a/b:c.gguf", "C:/a/b,c.gguf", "C:/a/\"b\".gguf", "C:/a/b\nc.gguf"] {
            assert!(lora_args(bad, exe, 1.0).is_err(), "{bad}");
        }
        // Not from the drive's root, a network share, or relative.
        assert!(lora_args("C:a/b.gguf", exe, 1.0).is_err());
        assert!(lora_args("//server/share/b.gguf", "/x/llama-server", 1.0).is_err());
        assert!(lora_args(r"\\server\share\b.gguf", "/x/llama-server", 1.0).is_err());
        assert!(lora_args("relative.gguf", "/x/llama-server", 1.0).is_err());
    }

    #[test]
    fn passwords_are_random_and_long() {
        let a = random_key().unwrap();
        let b = random_key().unwrap();
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}
