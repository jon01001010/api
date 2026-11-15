//! Files for the app. The app names its own files with paths that start with
//! `/pocketagent/` (its Documents, Caches, … folders); those map into the
//! app's AppData folder and need no prompt. Any other path is outside the
//! app: every read, write, list or delete there asks the user first (the
//! dialog is shown here on the native side, so the web screens can't skip
//! it). Paths with `..` are refused everywhere. Outside paths are resolved
//! first and checked against the places never reachable (outside.rs), and
//! each access is logged; a link inside the app's folder that leads out of
//! it is refused.

use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::approval::ask;

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
    let root = app_root(app)?;
    let located = locate(&root, input)?;
    if located.own {
        if !stays_inside(&root, &located.real) {
            return Err("That is a link to somewhere outside the app's folder; it isn't followed".into());
        }
        return Ok(located.real);
    }
    // Outside the app's folder: resolved (links, junctions, short names),
    // refused if it doesn't resolve cleanly or is never reachable
    // (outside.rs), then asked every time, and logged.
    let real = match crate::outside::checked(app, &located.real) {
        Ok(real) => real,
        Err(e) => {
            crate::outside::audit(app, "app", what, "refused", &located.real.to_string_lossy());
            return Err(e);
        }
    };
    let question = format!("DesktopAgent wants to {what}, outside its own folder:\n\n{}", real.display());
    let yes = ask(app, &question).await;
    crate::outside::audit(app, "app", what, if yes { "allowed" } else { "said no" }, &real.to_string_lossy());
    if !yes {
        return Err("The user said no. Nothing was done.".into());
    }
    Ok(real)
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
    let real = allowed(&app, &path, "write to this file").await?;
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
    let target = allowed(&app, &to, "write a copy here").await?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(source, target).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_move(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let source = allowed(&app, &from, "move this file").await?;
    let target = allowed(&app, &to, "move a file here").await?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(source, target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
