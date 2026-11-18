//! Files for the app. The app names its own files with paths that start with
//! `/pocketagent/` (its Documents, Caches, … folders); those map into the
//! app's AppData folder and need no prompt. Any other path is outside the
//! app: every read, write, list or delete there asks the user first (the
//! dialog is shown here on the native side, so the web screens can't skip
//! it). Paths with `..` are refused everywhere. Outside paths are resolved
//! first and checked against the places never reachable (outside.rs), and
//! each access is logged; a link inside the app's folder that leads out of
//! it is refused.
//!
//! Security review 2026-11-17: the question outside the app's folder is
//! asked on this PC only (approval::ask_on_this_pc, never answered from a
//! paired device, like outside.rs), says that the app's screens ask, and
//! nothing that runs (programs, scripts, shortcuts: runs_code) is ever
//! written outside the app's folder.

use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::approval::ask_on_this_pc;

/// Kinds of file that run (or start something) when opened: never
/// written, copied or moved to outside the app's folder.
pub const RUNS_CODE: &[&str] = &[
    "exe", "dll", "sys", "drv", "ocx", "cpl", "scr", "com", "pif", "bat", "cmd", "ps1", "psm1", "psd1", "ps1xml",
    "msi", "msp", "mst", "msc", "lnk", "url", "scf", "inf", "reg", "vbs", "vbe", "js", "jse", "mjs", "cjs", "wsf",
    "wsh", "wsc", "hta", "jar", "py", "pyw", "pyc", "rb", "pl", "php", "sh", "bash", "zsh", "fish", "ksh", "csh",
    "command", "run", "bin", "appimage", "desktop", "service", "timer", "deb", "rpm", "so", "ko", "elf", "xll",
    "application", "appref-ms", "appx", "msix", "appxbundle", "msixbundle", "gadget", "library-ms",
    "searchconnector-ms", "settingcontent-ms", "chm", "iso", "img", "vhd", "vhdx", "xbap", "apk",
];

/// Whether a file of this name runs (or starts something) when opened:
/// by its kind (RUNS_CODE, any case), and on Linux a name with no kind
/// at all may be a program.
pub fn runs_code(name: &str) -> bool {
    let name = name.trim_end_matches(['.', ' ']).to_lowercase();
    match name.rsplit_once('.') {
        Some((stem, kind)) if !stem.is_empty() => RUNS_CODE.contains(&kind),
        _ => true,
    }
}

pub const NEVER_RUNS: &str =
    "Programs, scripts and shortcuts are never written outside the app's folder. Nothing was done.";

/// The app's own file space, as the screens see it.
pub const APP_PREFIX: &str = "/pocketagent";

/// Where a path the screens gave us really is.
#[derive(Debug, PartialEq)]
pub struct Located {
    pub real: PathBuf,
    /// True inside the app's own folder (no prompt needed).
    pub own: bool,
}

/// Maps a path from the screens to a real path. Pure, so it can be tested.
pub fn locate(app_root: &Path, input: &str) -> Result<Located, String> {
    let path = input.replace('\\', "/");
    if path.trim().is_empty() {
        return Err("Empty path".into());
    }
    if let Some(rest) = path
        .strip_prefix(APP_PREFIX)
        .filter(|r| r.is_empty() || r.starts_with('/'))
    {
        let mut real = app_root.to_path_buf();
        for part in Path::new(rest.trim_start_matches('/')).components() {
            match part {
                Component::Normal(p) => real.push(p),
                Component::CurDir => {}
                _ => return Err(format!("Path not allowed: {input}")),
            }
        }
        return Ok(Located { real, own: true });
    }
    let real = PathBuf::from(&path);
    if !real.is_absolute() {
        return Err(format!("Path must be absolute: {input}"));
    }
    if real.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("Path not allowed: {input}"));
    }
    Ok(Located { real, own: false })
}

fn app_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The first of the candidates that is neither inside the screens' own
/// folder nor holds it. Pure, so it can be tested.
pub fn pick_private(screens: &Path, candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|c| !c.starts_with(screens) && !screens.starts_with(c))
}

/// A folder for the native side's own records (e.g. the log of answers
/// given on devices) that the screens' file commands can't reach without
/// asking: the settings folder on Linux (~/.config/…), the local AppData
/// folder on Windows (where the settings folder is the screens' own).
pub fn private_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let screens = app_root(app)?;
    let candidates = [app.path().app_config_dir().ok(), app.path().app_local_data_dir().ok()];
    pick_private(&screens, candidates.into_iter().flatten())
        .ok_or_else(|| "No private folder on this system".to_string())
}

/// Finds a path and, outside the app's folder, asks the user first.
pub async fn allowed_path(app: &AppHandle, input: &str, what: &str) -> Result<PathBuf, String> {
    allowed(app, input, what).await
}

/// Whether a path in the app's own folder stays in it once links are
/// followed (a link placed there can't lead the screens out unasked).
fn stays_inside(root: &Path, real: &Path) -> bool {
    let Ok(root) = std::fs::canonicalize(root) else {
        // No folder yet: nothing in it can lead out.
        return true;
    };
    crate::outside::resolve(real).is_ok_and(|r| r.starts_with(&root))
}

async fn allowed(app: &AppHandle, input: &str, what: &str) -> Result<PathBuf, String> {
    allowed_to(app, input, what, false).await
}

/// `allowed`; `writes`: something is written there (never a kind that
/// runs, outside the app's folder).
async fn allowed_to(app: &AppHandle, input: &str, what: &str, writes: bool) -> Result<PathBuf, String> {
    let root = app_root(app)?;
    let located = locate(&root, input)?;
    if located.own {
        if !stays_inside(&root, &located.real) {
            return Err("That is a link to somewhere outside the app's folder; it isn't followed".into());
        }
        return Ok(located.real);
    }
    // Outside the app's folder: refused, with no dialog (owner, 2026-11-18).
    // Nothing in the app needs it (a picked file is copied in, downloads go
    // into the app's folder, a model run from elsewhere has its own picker
    // and question), so a hijacked screen gets no door and no dialog to
    // pester the user with. The model reaches outside only through
    // `outside_files` (outside.rs: asked on this PC every time, logged).
    // Still logged here, so a refusal can be traced.
    let _ = writes;
    crate::outside::audit(app, "app", what, "refused: outside the app's folder", &located.real.to_string_lossy(), None);
    Err(OUTSIDE_REFUSED.into())
}

/// What the screens get for a path outside the app's folder.
pub const OUTSIDE_REFUSED: &str = "Only the app's own folder can be used here. To use a file elsewhere on this PC, add it with \"Add a file\" (it is copied in), or ask the model to use it (it asks you first).";

/// The old way: outside the app's folder, resolved, checked against the
/// places never reachable, then asked on this PC and logged. Not used since
/// 2026-11-18 (outside paths are refused, above); kept for reference.
#[allow(dead_code)]
async fn allowed_outside_asked(app: &AppHandle, real: PathBuf, what: &str, writes: bool) -> Result<PathBuf, String> {
    let real = match crate::outside::checked(app, &real) {
        Ok(real) => real,
        Err(e) => {
            crate::outside::audit(app, "app", what, "refused", &real.to_string_lossy(), None);
            return Err(e);
        }
    };
    let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if writes && runs_code(&name) {
        crate::outside::audit(app, "app", what, "refused: runs code", &real.to_string_lossy(), None);
        return Err(NEVER_RUNS.into());
    }
    let question = screens_question(what, &real.display().to_string());
    // On this PC only: never answered from a paired device.
    let yes = ask_on_this_pc(app, &question).await;
    crate::outside::audit(app, "app", what, if yes { "allowed" } else { "said no" }, &real.to_string_lossy(), None);
    if !yes {
        return Err("The user said no. Nothing was done.".into());
    }
    Ok(real)
}

/// The question for the app's screens outside the app's folder: who asks
/// (the screens, not the model), what, where.
pub fn screens_question(what: &str, path: &str) -> String {
    format!("DesktopAgent's screens (the app itself, not the model) want to {what}, outside the app's own folder:\n\n{path}")
}

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    size: u64,
    is_file: bool,
    is_dir: bool,
    mtime_ms: u64,
}

fn entry(shown_path: String, real: &Path) -> Result<Entry, String> {
    let meta = std::fs::metadata(real).map_err(|e| e.to_string())?;
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let name = real
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Entry {
        name,
        path: shown_path,
        size: meta.len(),
        is_file: meta.is_file(),
        is_dir: meta.is_dir(),
        mtime_ms,
    })
}

#[tauri::command]
pub async fn fs_exists(app: AppHandle, path: String) -> Result<bool, String> {
    let real = allowed(&app, &path, "check whether this exists").await?;
    Ok(real.exists())
}

#[tauri::command]
pub async fn fs_read(app: AppHandle, path: String, encoding: Option<String>) -> Result<String, String> {
    let real = allowed(&app, &path, "read this file").await?;
    let bytes = std::fs::read(&real).map_err(|e| e.to_string())?;
    if encoding.as_deref() == Some("base64") {
        return Ok(base64::engine::general_purpose::STANDARD.encode(bytes));
    }
    String::from_utf8(bytes).map_err(|_| "File is not text".into())
}

#[tauri::command]
pub async fn fs_write(
    app: AppHandle,
    path: String,
    content: String,
    encoding: Option<String>,
    append: Option<bool>,
) -> Result<(), String> {
    let real = allowed_to(&app, &path, "write to this file", true).await?;
    let bytes = if encoding.as_deref() == Some("base64") {
        base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|e| e.to_string())?
    } else {
        content.into_bytes()
    };
    if let Some(parent) = real.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if append.unwrap_or(false) {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&real)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())
    } else {
        std::fs::write(&real, bytes).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn fs_mkdir(app: AppHandle, path: String) -> Result<(), String> {
    let real = allowed(&app, &path, "create this folder").await?;
    std::fs::create_dir_all(real).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_list(app: AppHandle, path: String) -> Result<Vec<Entry>, String> {
    let real = allowed(&app, &path, "list this folder").await?;
    let shown = path.replace('\\', "/").trim_end_matches('/').to_string();
    let mut out = Vec::new();
    for item in std::fs::read_dir(&real).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().into_owned();
        out.push(entry(format!("{shown}/{name}"), &item.path())?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn fs_stat(app: AppHandle, path: String) -> Result<Entry, String> {
    let real = allowed(&app, &path, "look at this file").await?;
    entry(path, &real)
}

#[tauri::command]
pub async fn fs_remove(app: AppHandle, path: String) -> Result<(), String> {
    let real = allowed(&app, &path, "DELETE this").await?;
    if real.is_dir() {
        std::fs::remove_dir_all(real).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(real).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn fs_copy(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let source = allowed(&app, &from, "read this file (to copy it)").await?;
    let target = allowed_to(&app, &to, "write a copy here", true).await?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(source, target).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_move(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let source = allowed(&app, &from, "move this file").await?;
    let target = allowed_to(&app, &to, "move a file here", true).await?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(source, target).map_err(|e| e.to_string())
}

/// A file's SHA-256 (lower-case hex), read in pieces so a model of many
/// gigabytes never sits in memory.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(crate::download::hex(&hasher.finalize()))
}

/// Only the app's own files (its downloaded models), with no prompt: a
/// path outside the app's folder, or a link leading out of it, is refused
/// rather than asked about (a file's SHA-256 is only ever checked for the
/// app's own downloads).
fn own_file(app: &AppHandle, input: &str) -> Result<PathBuf, String> {
    let root = app_root(app)?;
    let located = locate(&root, input)?;
    if !located.own {
        return Err("Only the app's own files can be checked".into());
    }
    if !stays_inside(&root, &located.real) {
        return Err("That is a link to somewhere outside the app's folder; it isn't followed".into());
    }
    if !located.real.is_file() {
        return Err("Not a file".into());
    }
    Ok(located.real)
}

/// RNFS.hash on the desktop: SHA-256 only, of a file in the app's folder.
#[tauri::command]
pub async fn fs_hash(app: AppHandle, path: String, algorithm: String) -> Result<String, String> {
    if !algorithm.eq_ignore_ascii_case("sha256") {
        return Err(format!("Only sha256 is supported, not {algorithm}"));
    }
    let real = own_file(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || sha256_file(&real))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_files_sha256_is_read_in_pieces() {
        let dir = std::env::temp_dir().join(format!("pa-hash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.txt");
        std::fs::write(&file, b"abc").unwrap();
        assert_eq!(
            sha256_file(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        std::fs::write(&file, b"").unwrap();
        assert_eq!(
            sha256_file(&file).unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // Bigger than one piece: the same as hashing it at once.
        let big: Vec<u8> = (0..3 * 1024 * 1024 + 7).map(|i| (i % 251) as u8).collect();
        std::fs::write(&file, &big).unwrap();
        use sha2::{Digest, Sha256};
        assert_eq!(sha256_file(&file).unwrap(), crate::download::hex(&Sha256::digest(&big)));
        assert!(sha256_file(&dir.join("missing")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn private_records_stay_out_of_the_screens_folder() {
        // Windows: the settings folder is the screens' own; local AppData is not.
        let roaming = PathBuf::from("/u/AppData/Roaming/app.pocketagent.desktop");
        let local = PathBuf::from("/u/AppData/Local/app.pocketagent.desktop");
        assert_eq!(pick_private(&roaming, [roaming.clone(), local.clone()]), Some(local));
        // Linux: the settings folder.
        let data = PathBuf::from("/home/u/.local/share/app");
        let config = PathBuf::from("/home/u/.config/app");
        assert_eq!(pick_private(&data, [config.clone(), data.clone()]), Some(config));
        // Inside it, or holding it: never.
        assert_eq!(pick_private(&data, [data.join("x"), PathBuf::from("/home/u/.local")]), None);
    }

    fn root() -> PathBuf {
        PathBuf::from("/data/PocketAgent")
    }

    #[test]
    fn own_paths_map_into_the_app_folder_without_a_prompt() {
        let found = locate(&root(), "/pocketagent/Documents/memory.txt").unwrap();
        assert_eq!(found.real, root().join("Documents").join("memory.txt"));
        assert!(found.own);
        assert!(locate(&root(), "/pocketagent").unwrap().own);
    }

    #[test]
    fn dot_dot_is_refused_everywhere() {
        assert!(locate(&root(), "/pocketagent/../secret").is_err());
        assert!(locate(&root(), "/pocketagent/Documents/../../x").is_err());
        assert!(locate(&root(), "/home/user/../etc/passwd").is_err());
        assert!(locate(&root(), "/pocketagent\\..\\x").is_err());
    }

    /// An absolute path outside the app, in this system's style.
    fn outside(rest: &str) -> String {
        if cfg!(windows) {
            format!("C:/{rest}")
        } else {
            format!("/{rest}")
        }
    }

    #[test]
    fn look_alike_prefixes_are_outside_the_app() {
        // "/pocketagentX" is not the app's folder: never treated as its own.
        let mapped = locate(&root(), "/pocketagentX/file");
        assert!(mapped.map(|f| !f.own).unwrap_or(true));
        assert!(!locate(&root(), &outside("pocketagentX/file")).unwrap().own);
    }

    #[test]
    fn other_absolute_paths_are_outside_and_need_a_prompt() {
        let found = locate(&root(), &outside("Users/me/Desktop/notes.txt")).unwrap();
        assert!(!found.own);
        assert!(locate(&root(), &outside("Users/me/../x")).is_err());
        assert!(locate(&root(), "relative/path").is_err());
        assert!(locate(&root(), "").is_err());
    }

    #[test]
    fn nothing_that_runs_is_written_outside_and_only_this_pc_is_asked() {
        for bad in ["a.exe", "A.EXE", "x.dll", "run.bat", "run.cmd", "p.ps1", "setup.msi", "Link.lnk", "s.scr", "c.com", "v.vbs", "j.js", "s.sh", "App.AppImage", "x.desktop", "x.reg", "x.hta", "program", "a.exe.", "a.exe ", "x.url"] {
            assert!(runs_code(bad), "{bad}");
        }
        for ok in ["notes.txt", "a.md", "photo.JPG", "doc.pdf", "data.json", ".hidden.txt", "report.docx"] {
            assert!(!runs_code(ok), "{ok}");
        }
        let q = screens_question("write to this file", "C:\\x\\a.txt");
        assert!(q.starts_with("DesktopAgent's screens (the app itself, not the model) want to write to this file"), "{q}");
        let src = include_str!("files.rs").replace("\r\n", "\n");
        let body = &src[src.find("async fn allowed_outside_asked").unwrap()..src.find("pub fn screens_question").unwrap()];
        assert!(body.contains("ask_on_this_pc(app, &question)"));
        // Outside the app's folder the screens are refused, never asked.
        let used = &src[src.find("async fn allowed_to").unwrap()..src.find("pub const OUTSIDE_REFUSED").unwrap()];
        assert!(used.contains("Err(OUTSIDE_REFUSED.into())"));
        assert!(!used.contains("ask_on_this_pc") && !used.contains("checked(app"));
        assert!(!body.contains(&["approval::", "ask("].concat()) && !body.contains(&["= ", "ask(app"].concat()));
    }
}
