//! Files in and out of the app, always by the user's own choice in a native
//! file dialog (choosing is the consent, like picking a model file):
//!
//! - Import: the user picks a file; a copy goes into the app's folder (its
//!   import area), where the screens put it in the workspace or attach it.
//!   The original is never changed.
//! - Save as: a file from the app's own folder is copied to the place the
//!   user picks (the desktop's version of the phone's share sheet).
//!
//! The model can't do either by itself: these run only from a button.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Biggest file copied in.
const MAX_IMPORT: u64 = 256 * 1024 * 1024;
/// Where imported copies land, as the screens name it (files.rs maps it).
const IMPORT_DIR: &str = "Caches/import";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    /// The copy, by the app's own name for it (`/pocketagent/…`).
    path: String,
    name: String,
    size: u64,
}

/// A file name safe to keep: no folders, no odd characters.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || " ._-()".contains(c) { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    let cleaned: String = cleaned.chars().take(120).collect();
    if cleaned.is_empty() { "file".into() } else { cleaned }
}

#[tauri::command]
pub async fn pick_import_file(app: AppHandle, images: Option<bool>) -> Result<Option<Imported>, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dialog_app = app.clone();
    let picked: Option<PathBuf> = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = dialog_app.dialog().file().set_title(if images.unwrap_or(false) {
            "Choose a picture"
        } else {
            "Choose a file to add"
        });
        if images.unwrap_or(false) {
            dialog = dialog.add_filter("Pictures", &["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
        }
        dialog.blocking_pick_file().and_then(|p| p.into_path().ok())
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(source) = picked else {
        return Ok(None);
    };
    let size = std::fs::metadata(&source).map_err(|e| e.to_string())?.len();
    if size > MAX_IMPORT {
        return Err("The file is too big to add (over 256 MB)".into());
    }
    let name = safe_name(&source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    // A fresh name each time, so two imports never clash.
    let mut tag = [0u8; 4];
    getrandom::fill(&mut tag).map_err(|e| e.to_string())?;
    let stored = format!("{}-{name}", tag.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let dir = root.join(IMPORT_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::copy(&source, dir.join(&stored)).map_err(|e| e.to_string())?;
    Ok(Some(Imported {
        path: format!("{}/{IMPORT_DIR}/{stored}", crate::files::APP_PREFIX),
        name,
        size,
    }))
}

/// Copies one of the app's own files to where the user picks.
#[tauri::command]
pub async fn save_copy(app: AppHandle, path: String, name: Option<String>) -> Result<Option<String>, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let located = crate::files::locate(&root, &path)?;
    if !located.own || !located.real.is_file() {
        return Err("Only the app's own files can be saved out".into());
    }
    let suggested = safe_name(&name.unwrap_or_else(|| {
        located.real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
    }));
    let dialog_app = app.clone();
    let target: Option<PathBuf> = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("Save a copy")
            .set_file_name(&suggested)
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(target) = target else {
        return Ok(None);
    };
    std::fs::copy(&located.real, &target).map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_plain_files() {
        assert_eq!(safe_name("Report (final).docx"), "Report (final).docx");
        assert_eq!(safe_name("../../Windows/evil.exe"), "_.._Windows_evil.exe");
        assert_eq!(safe_name("C:\\x\\y.txt"), "C__x_y.txt");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name(""), "file");
        assert!(!safe_name("a/b\\c:d").contains(['/', '\\', ':']));
    }
}
