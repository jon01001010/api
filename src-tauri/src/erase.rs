//! The erase PIN (src/services/appLock): erases everything DesktopAgent
//! keeps on this PC, at once and without asking, then restarts the app,
//! which starts as new. Nothing is sent to paired devices.
//!
//! Only the app's own things go:
//! - its own folders, as Tauri names them for this app (data, config, local
//!   data incl. the web view's storage, cache, logs; the workspace, models
//!   and pictures are inside the data folder). Each must end in the app's
//!   identifier, sit at least two folders deep, and be neither the home
//!   folder nor a folder above it, or it is refused (`check_root`). Nothing
//!   else on the PC (Downloads, Documents, a model file run from elsewhere)
//!   is touched.
//! - its own entries in Windows Credential Manager / the Linux key store,
//!   by the names only this app makes: "PocketAgent:" (the screens' keys,
//!   secrets.rs), "DesktopAgent-link:" (the link key and paired devices,
//!   link.rs; on Linux they are files in the config folder) and
//!   "DesktopAgent-model:" (remembered model files, remembered.rs).
//!
//! Windows keeps the web view's folder open while the app runs, so a mark
//! is left in the data folder and the erase is done again at the next start,
//! before any window opens (`finish_pending`, from lib.rs).

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Left in the data folder while an erase isn't finished.
const MARK: &str = ".erase-pending";

/// keyring's names for this app's entries: (user, start of the service).
/// Windows' target name is "<user>.<service>"; Linux keyutils' description
/// is "keyring-rs:<user>@<service>".
pub const OWN_ENTRIES: &[(&str, &str)] = &[
    ("generic", "PocketAgent:"),
    ("link", "DesktopAgent-link:"),
    ("file", "DesktopAgent-model:"),
];

/// Whether a Windows credential target name is one of this app's.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn own_windows_target(target: &str) -> bool {
    OWN_ENTRIES
        .iter()
        .any(|(user, service)| target.starts_with(&format!("{user}.{service}")))
}

/// Whether a Linux keyutils description is one of this app's.
#[cfg_attr(windows, allow(dead_code))]
pub fn own_keyutils_description(description: &str) -> bool {
    OWN_ENTRIES
        .iter()
        .any(|(user, service)| description.starts_with(&format!("keyring-rs:{user}@{service}")))
}

/// A folder may be removed only if it is clearly the app's own.
pub fn check_root(root: &Path, identifier: &str, home: Option<&Path>) -> Result<(), String> {
    let shown = root.display();
    if identifier.len() < 5 || !identifier.contains('.') {
        return Err(format!("Not an app identifier: {identifier}"));
    }
    if !root.is_absolute() {
        return Err(format!("Not a full path: {shown}"));
    }
    if root.as_os_str().len() < 12 {
        return Err(format!("Too short to be the app's folder: {shown}"));
    }
    let parts = root
        .components()
        .filter(|c| matches!(c, std::path::Component::Normal(_)))
        .count();
    if parts < 2 || root.parent().is_none() || root.parent().and_then(Path::parent).is_none() {
        return Err(format!("Too close to the top of the drive: {shown}"));
    }
    if root
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::CurDir))
    {
        return Err(format!("Not a plain path: {shown}"));
    }
    if root.file_name().and_then(|n| n.to_str()) != Some(identifier) {
        return Err(format!("Not named after the app: {shown}"));
    }
    if let Some(home) = home {
        if home.starts_with(root) {
            return Err(format!("The home folder or above it: {shown}"));
        }
    }
    Ok(())
}

/// The app's own folders, checked, without ones inside another.
pub fn own_roots(candidates: &[PathBuf], identifier: &str, home: Option<&Path>) -> Vec<PathBuf> {
    let mut ok: Vec<PathBuf> = candidates
        .iter()
        .filter(|r| check_root(r, identifier, home).is_ok())
        .cloned()
        .collect();
    ok.sort();
    ok.dedup();
    let all = ok.clone();
    ok.retain(|r| !all.iter().any(|other| other != r && r.starts_with(other)));
    ok
}

/// Removes these folders (each checked again). A link is removed, never
/// followed. Returns what couldn't be removed.
pub fn remove_roots(roots: &[PathBuf], identifier: &str, home: Option<&Path>) -> Vec<String> {
    let mut left = Vec::new();
    for root in roots {
        if let Err(e) = check_root(root, identifier, home) {
            left.push(e);
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(root) else {
            continue; // Not there.
        };
        let result = if meta.file_type().is_symlink() {
            std::fs::remove_file(root).or_else(|_| std::fs::remove_dir(root))
        } else if meta.is_dir() {
            std::fs::remove_dir_all(root)
        } else {
            std::fs::remove_file(root)
        };
        if let Err(e) = result {
            if root.exists() {
                left.push(format!("{}: {e}", root.display()));
            }
        }
    }
    left
}

fn identifier(app: &AppHandle) -> String {
    app.config().identifier.clone()
}

fn candidates(app: &AppHandle) -> Vec<PathBuf> {
    let p = app.path();
    [
        p.app_data_dir().ok(),
        p.app_config_dir().ok(),
        p.app_local_data_dir().ok(),
        p.app_cache_dir().ok(),
        // Inside one of the above on Windows and Linux; checked anyway.
        p.app_log_dir().ok(),
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn erase_files(app: &AppHandle) -> Vec<String> {
    let home = app.path().home_dir().ok();
    let id = identifier(app);
    let roots = own_roots(&candidates(app), &id, home.as_deref());
    remove_roots(&roots, &id, home.as_deref())
}

#[cfg(windows)]
fn erase_entries() {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredEnumerateW, CredFree, CREDENTIALW, CRED_TYPE_GENERIC,
    };
    for (user, service) in OWN_ENTRIES {
        let filter = HSTRING::from(format!("{user}.{service}*"));
        let mut count = 0u32;
        let mut list: *mut *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: Windows fills `list` with `count` credentials, freed below.
        let found = unsafe { CredEnumerateW(&filter, None, &mut count, &mut list) };
        if found.is_err() || list.is_null() {
            continue;
        }
        let mut targets = Vec::new();
        for i in 0..count as usize {
            // SAFETY: i < count, as Windows returned.
            let cred = unsafe { *list.add(i) };
            if cred.is_null() {
                continue;
            }
            // SAFETY: a credential from CredEnumerateW has a target name.
            let target = unsafe { (*cred).TargetName.to_string() }.unwrap_or_default();
            if own_windows_target(&target) {
                targets.push(target);
            }
        }
        // SAFETY: the buffer CredEnumerateW gave.
        unsafe { CredFree(list as *const core::ffi::c_void) };
        for target in targets {
            let name = HSTRING::from(target);
            // SAFETY: a plain call with a valid string.
            let _ = unsafe { CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, None) };
        }
    }
}

#[cfg(not(windows))]
fn erase_entries() {
    use linux_keyutils::{KeyRing, KeyRingIdentifier, LinkNode};
    let mut rings = Vec::new();
    if let Ok(session) = KeyRing::from_special_id(KeyRingIdentifier::Session, false) {
        rings.push(session);
    }
    if let Ok(persistent) = KeyRing::get_persistent(KeyRingIdentifier::Session) {
        rings.push(persistent);
    }
    for ring in rings {
        let Ok(links) = ring.get_links(4096) else {
            continue;
        };
        for node in links.iter() {
            if let LinkNode::Key(key) = node {
                let ours = key
                    .metadata()
                    .map(|m| own_keyutils_description(m.get_description()))
                    .unwrap_or(false);
                if ours {
                    let _ = key.invalidate();
                }
            }
        }
    }
}

fn erase_all_now(app: &AppHandle) -> Vec<String> {
    erase_entries();
    erase_files(app)
}

/// Stops what the app runs (model server, pictures) so its files can go.
fn stop_running(app: &AppHandle) {
    app.state::<crate::image_gen::ImageGen>().stop();
    let running = app
        .state::<crate::model_server::ModelServer>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    if let Some(mut running) = running {
        let _ = running.child.kill();
        let _ = running.child.wait();
    }
}

/// The erase PIN was entered (src/services/appLock/appErase.ts). Erases
/// what it can now, leaves the mark, restarts. Never returns on success.
#[tauri::command]
pub async fn app_erase_all(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        stop_running(&handle);
        erase_all_now(&handle);
        // Done again at the next start, before the window opens: what
        // Windows still held, and anything written in between.
        if let Ok(data) = handle.path().app_data_dir() {
            let _ = std::fs::create_dir_all(&data);
            let _ = std::fs::write(data.join(MARK), b"1");
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    app.restart();
}

/// At start, before any window: finishes an erase the last run began.
pub fn finish_pending(app: &AppHandle) {
    let Ok(data) = app.path().app_data_dir() else {
        return;
    };
    if !data.join(MARK).exists() {
        return;
    }
    // The last run's web view may take a moment to let go of its folder.
    for _ in 0..40 {
        if erase_all_now(app).is_empty() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "app.pocketagent.desktop";

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pa-erase-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    #[test]
    fn only_the_apps_own_folders_are_removed() {
        let home = temp("home");
        let data = home.join(".local/share").join(ID);
        let config = home.join(".config").join(ID);
        let cache = home.join(".cache").join(ID);
        let logs = data.join("logs");
        put(&data.join("Documents/PocketAgentFiles/a.txt"));
        put(&data.join("Documents/models/m.gguf"));
        put(&config.join("link/DesktopAgent-link_key"));
        put(&cache.join("x"));
        // Not the app's: must stay.
        let downloads = home.join("Downloads/keep.txt");
        let other_app = home.join(".local/share/other.app/keep.txt");
        let beside = home.join(".local/share/keep.txt");
        put(&downloads);
        put(&other_app);
        put(&beside);

        let roots = own_roots(
            &[data.clone(), config.clone(), cache.clone(), logs, data.clone()],
            ID,
            Some(&home),
        );
        assert_eq!(roots.len(), 3, "nested and repeated roots go once: {roots:?}");
        assert!(remove_roots(&roots, ID, Some(&home)).is_empty());
        assert!(!data.exists() && !config.exists() && !cache.exists());
        assert!(downloads.exists() && other_app.exists() && beside.exists());
        assert!(home.join(".local/share").exists());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_removed_never_followed() {
        let home = temp("link");
        let target = home.join("Documents");
        put(&target.join("mine.txt"));
        let root = home.join(".local/share").join(ID);
        std::fs::create_dir_all(root.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&target, &root).unwrap();
        assert!(remove_roots(&[root.clone()], ID, Some(&home)).is_empty());
        assert!(std::fs::symlink_metadata(&root).is_err());
        assert!(target.join("mine.txt").exists());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn refuses_the_home_folder_the_top_and_short_paths() {
        let home = temp("refuse");
        let home_named = home.join(ID);
        // The home folder itself, even if it had the app's name.
        assert!(check_root(&home_named, ID, Some(&home_named)).is_err());
        // Above the home folder.
        assert!(check_root(home.parent().unwrap(), ID, Some(&home)).is_err());
        // The top of the drive, and too short.
        assert!(check_root(Path::new("/"), ID, Some(&home)).is_err());
        assert!(check_root(&Path::new("/").join(ID), ID, Some(&home)).is_err());
        assert!(check_root(Path::new("/a/b"), "a.b", None).is_err());
        // Not named after the app, relative, or with "..".
        assert!(check_root(&home.join("Downloads"), ID, Some(&home)).is_err());
        assert!(check_root(Path::new("x/y").join(ID).as_path(), ID, None).is_err());
        assert!(check_root(&home.join("..").join(ID), ID, Some(&home)).is_err());
        // A bad identifier refuses everything.
        assert!(check_root(&home.join("x"), "x", Some(&home)).is_err());
        // The real thing passes.
        assert!(check_root(&home.join(".config").join(ID), ID, Some(&home)).is_ok());
        // A refused root is never removed.
        let downloads = home.join("Downloads");
        put(&downloads.join("keep.txt"));
        assert_eq!(remove_roots(&[downloads.clone(), home.clone()], ID, Some(&home)).len(), 2);
        assert!(downloads.join("keep.txt").exists());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn only_the_apps_own_key_entries() {
        assert!(own_windows_target("generic.PocketAgent:pocketagent-app-lock"));
        assert!(own_windows_target("link.DesktopAgent-link:phones"));
        assert!(own_windows_target("file.DesktopAgent-model:0123456789abcdef"));
        assert!(!own_windows_target("PocketAgent:x"));
        assert!(!own_windows_target("generic.Other:PocketAgent:x"));
        assert!(!own_windows_target("git:https://github.com"));
        assert!(own_keyutils_description("keyring-rs:generic@PocketAgent:api-key"));
        assert!(own_keyutils_description("keyring-rs:file@DesktopAgent-model:00"));
        assert!(!own_keyutils_description("keyring-rs:generic@SomeoneElse"));
        assert!(!own_keyutils_description("_ses"));
        // The screens' key command can only make "PocketAgent:" names, the
        // same ones erased here (secrets.rs).
        assert!(include_str!("secrets.rs").contains("const PREFIX: &str = \"PocketAgent\";"));
        assert!(include_str!("secrets.rs").contains("\"generic\""));
    }
}
