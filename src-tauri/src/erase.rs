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
//! - on Linux, also the web view's own folders: WebKitGTK keeps this app's
//!   web storage (local storage, IndexedDB, caches) in folders named after
//!   the program (GLib's program name, the running file's name: WebKit's
//!   WebsiteDataStoreGLib.cpp, `programName()`), not the identifier:
//!   `$XDG_DATA_HOME/<name>` and `$XDG_CACHE_HOME/<name>` (Tauri gives
//!   WebKitGTK no folder of its own: no `dataDirectory` in tauri.conf.json,
//!   wry's WebContext::new(None)). Only WebKit's own entries in them go
//!   (WEBKIT_ENTRIES), then the folder if it is left empty
//!   (`check_webkit_root`).
//!
//! A mark is left beside the settings folder (outside every folder that is
//! removed: `<identifier>.erase-pending` next to it) before anything is
//! removed, and it goes only once everything is gone. Windows keeps the
//! web view's folder open while the app runs, so the erase is done again
//! at the next start, before any window opens (`finish_pending`, from
//! lib.rs); an erase that still fails is tried again at every start.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Left beside the settings folder while an erase isn't finished:
/// "<identifier>.erase-pending" (mark_path).
const MARK: &str = ".erase-pending";

/// Where the mark goes: beside the settings folder, never inside a folder
/// that is removed (each of those is named exactly after the identifier,
/// or after the program for WebKit's, and holds no such file name).
pub fn mark_path(config: &Path, identifier: &str) -> Option<PathBuf> {
    Some(config.parent()?.join(format!("{identifier}{MARK}")))
}

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
    if identifier.len() < 5 || !identifier.contains('.') {
        return Err(format!("Not an app identifier: {identifier}"));
    }
    check_place(root, identifier, home)
}

/// Program names WebKit's folders may never be taken for (its own
/// fallbacks, and names of shared folders).
#[cfg_attr(windows, allow(dead_code))]
const NOT_A_PROGRAM: &[&str] = &[
    "webkitgtk", "wpe", "webkit", "share", "cache", "config", "local", "applications", "icons", "fonts",
    "mime", "systemd", "flatpak", "trash", "keyrings", "recently-used.xbel", "gvfs-metadata", "tracker",
    "tracker3", "thumbnails", "fontconfig", "mesa_shader_cache", "pip", "npm", "yarn", "cargo",
];

/// The rule for WebKitGTK's folders named after the program (Linux): a
/// plain name of 4 to 64 letters, digits, '-', '_' or '.', not a dot name
/// and not one of NOT_A_PROGRAM; then the same checks as check_root.
#[cfg_attr(windows, allow(dead_code))]
pub fn check_webkit_root(root: &Path, program: &str, home: Option<&Path>) -> Result<(), String> {
    let plain = (4..=64).contains(&program.len())
        && !program.starts_with('.')
        && program.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !NOT_A_PROGRAM.contains(&program.to_ascii_lowercase().as_str());
    if !plain {
        return Err(format!("Not a program name: {program}"));
    }
    check_place(root, program, home)
}

/// A full, plain path, at least two folders deep, named `name`, and not
/// the home folder or above it.
fn check_place(root: &Path, name: &str, home: Option<&Path>) -> Result<(), String> {
    let shown = root.display();
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
    if root.file_name().and_then(|n| n.to_str()) != Some(name) {
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

/// WebKitGTK's own entries in its folders named after the program (the
/// names in WebKit's WebsiteDataStore.cpp, old and new, and libsoup's HSTS
/// file, which WebKit keeps in the folder itself).
#[cfg_attr(windows, allow(dead_code))]
pub const WEBKIT_ENTRIES: &[&str] = &[
    "WebKitCache", "CacheStorage", "NetworkCache", "MediaCache", "storage", "Storage", "indexeddb",
    "IndexedDB", "databases", "isolatedsites", "IsolatedSites", "serviceworkers", "ServiceWorkers",
    "websql", "WebSQL", "local", "localstorage", "LocalStorage", "mediakeys", "MediaKeyStorage",
    "MediaKeys", "HSTS", "AlternativeServices", "deviceidhashsalts", "DeviceIdHashSalts",
    "mediakeyshashsalts", "MediaKeysHashSalts", "itp", "ResourceLoadStatistics",
    "resourcemonitorthrottler", "ResourceMonitorThrottler", "applications", "icondatabase", "cookies",
];

#[cfg_attr(windows, allow(dead_code))]
pub fn webkit_entry(name: &str) -> bool {
    WEBKIT_ENTRIES.contains(&name) || name.starts_with("hsts-storage.sqlite")
}

/// Removes WebKit's own entries (webkit_entry) from these folders, each
/// checked (check_webkit_root), then the folder itself if that left it
/// empty: another program's files of the same name stay. A folder that is
/// a link is left alone; links inside are removed, never followed.
/// Returns what couldn't be removed.
#[cfg_attr(windows, allow(dead_code))]
pub fn remove_webkit_roots(roots: &[PathBuf], program: &str, home: Option<&Path>) -> Vec<String> {
    let mut left = Vec::new();
    for root in roots {
        if let Err(e) = check_webkit_root(root, program, home) {
            left.push(e);
            continue;
        }
        match std::fs::symlink_metadata(root) {
            Ok(meta) if meta.is_dir() => {}
            _ => continue, // Not there, a link or a file: not WebKit's folder.
        }
        let Ok(entries) = std::fs::read_dir(root) else {
            left.push(format!("{}: can't be read", root.display()));
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if !name.to_str().is_some_and(webkit_entry) {
                continue;
            }
            let path = entry.path();
            let result = match std::fs::symlink_metadata(&path) {
                Ok(meta) if meta.is_dir() => std::fs::remove_dir_all(&path),
                Ok(_) => std::fs::remove_file(&path),
                Err(_) => continue,
            };
            if let Err(e) = result {
                if std::fs::symlink_metadata(&path).is_ok() {
                    left.push(format!("{}: {e}", path.display()));
                }
            }
        }
        // Only when nothing else is in it.
        let _ = std::fs::remove_dir(root);
    }
    left
}

/// GLib's program name as WebKitGTK uses it: nothing in the app sets one
/// (tao starts GTK without arguments and, with Tauri's default, no GTK
/// app id), so GLib takes the running program's first argument
/// (/proc/self/cmdline), its file name only.
#[cfg_attr(windows, allow(dead_code))]
fn program_name() -> Option<String> {
    let first = std::env::args_os().next()?;
    Path::new(&first).file_name()?.to_str().map(str::to_string)
}

/// WebKitGTK's folders for this program (Linux).
#[cfg(not(windows))]
fn webkit_erase(app: &AppHandle) -> Vec<String> {
    let Some(program) = program_name() else {
        return Vec::new();
    };
    let p = app.path();
    let roots: Vec<PathBuf> = [p.data_dir().ok(), p.cache_dir().ok()]
        .into_iter()
        .flatten()
        .map(|base| base.join(&program))
        .collect();
    let home = p.home_dir().ok();
    remove_webkit_roots(&roots, &program, home.as_deref())
}

#[cfg(windows)]
fn webkit_erase(_app: &AppHandle) -> Vec<String> {
    // WebView2's folder (EBWebView) is inside the local data folder.
    Vec::new()
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
    let mut left = erase_files(app);
    left.extend(webkit_erase(app));
    left
}

fn mark(app: &AppHandle) -> Option<PathBuf> {
    mark_path(&app.path().app_config_dir().ok()?, &identifier(app))
}

/// Erases until nothing is left (at most `tries` times, `pause` between),
/// then removes the mark, last. True when done; else the mark stays and
/// the next start tries again.
pub fn finish_with(mark: &Path, tries: u32, pause: std::time::Duration, mut erase: impl FnMut() -> Vec<String>) -> bool {
    for i in 0..tries {
        if erase().is_empty() {
            return std::fs::remove_file(mark).is_ok() || !mark.exists();
        }
        if i + 1 < tries {
            std::thread::sleep(pause);
        }
    }
    false
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
        // The mark first, outside every folder that goes: the erase is
        // done again at the next start, before the window opens (what
        // Windows still held, anything written in between, and anything a
        // failure left), and at every start after until it is complete.
        if let Some(mark) = mark(&handle) {
            if let Some(dir) = mark.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&mark, b"1");
        }
        stop_running(&handle);
        erase_all_now(&handle);
    })
    .await
    .map_err(|e| e.to_string())?;
    app.restart();
}

/// At start, before any window: finishes an erase the last run began.
pub fn finish_pending(app: &AppHandle) {
    let Some(mark) = mark(app) else {
        return;
    };
    // An older version's mark, inside the data folder (it goes with it).
    let old = app.path().app_data_dir().ok().map(|d| d.join(MARK));
    if old.is_some_and(|m| m.exists()) && !mark.exists() {
        let _ = std::fs::write(&mark, b"1");
    }
    if !mark.exists() {
        return;
    }
    // The last run's web view may take a moment to let go of its folder.
    finish_with(&mark, 40, std::time::Duration::from_millis(250), || erase_all_now(app));
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
        // The screens' keys and the app PIN on Linux (secrets.rs).
        put(&config.join("secrets/0123abcd"));
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
    fn webkits_own_entries_go_from_the_programs_folders() {
        let home = temp("webkit");
        let program = "pocketagent";
        let data = home.join(".local/share").join(program);
        let cache = home.join(".cache").join(program);
        put(&data.join("localstorage/http_tauri.localhost_0.localstorage"));
        put(&data.join("databases/indexeddb/v1/x.sqlite3"));
        put(&data.join("hsts-storage.sqlite"));
        put(&cache.join("WebKitCache/Version 16/Records/a"));
        put(&cache.join("CacheStorage/salt"));
        // Another program's own file in a folder of the same name stays,
        // and so does the folder.
        put(&cache.join("their-notes.txt"));
        let roots = [data.clone(), cache.clone()];
        assert!(remove_webkit_roots(&roots, program, Some(&home)).is_empty());
        assert!(!data.exists(), "left empty, so removed");
        assert!(cache.join("their-notes.txt").exists());
        assert!(!cache.join("WebKitCache").exists() && !cache.join("CacheStorage").exists());
        // Not there: nothing to do.
        assert!(remove_webkit_roots(&roots, program, Some(&home)).is_empty());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn webkits_folder_as_a_link_is_left_alone() {
        let home = temp("webkit-link");
        let target = home.join("Documents");
        put(&target.join("localstorage/mine.txt"));
        let root = home.join(".local/share/pocketagent");
        std::fs::create_dir_all(root.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&target, &root).unwrap();
        assert!(remove_webkit_roots(&[root.clone()], "pocketagent", Some(&home)).is_empty());
        assert!(target.join("localstorage/mine.txt").exists());
        // A link inside is removed, never followed.
        let real = home.join(".cache/pocketagent");
        std::fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&target, real.join("storage")).unwrap();
        assert!(remove_webkit_roots(&[real.clone()], "pocketagent", Some(&home)).is_empty());
        assert!(!real.exists());
        assert!(target.join("localstorage/mine.txt").exists());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn webkit_program_names_are_checked() {
        let home = temp("webkit-names");
        let share = home.join(".local/share");
        assert!(check_webkit_root(&share.join("pocketagent"), "pocketagent", Some(&home)).is_ok());
        assert!(check_webkit_root(&share.join("DesktopAgent"), "DesktopAgent", Some(&home)).is_ok());
        for bad in ["", "abc", ".hidden", "..", "webkitgtk", "WebKitGTK", "wpe", "share", "applications", "a/b", "a b", "Trash"] {
            assert!(check_webkit_root(&share.join(bad), bad, Some(&home)).is_err(), "{bad}");
        }
        // Named after another program, or the base folder itself.
        assert!(check_webkit_root(&share.join("other"), "pocketagent", Some(&home)).is_err());
        assert!(check_webkit_root(&share, "share", Some(&home)).is_err());
        // The home folder, and the top.
        assert!(check_webkit_root(&home, home.file_name().unwrap().to_str().unwrap(), Some(&home)).is_err());
        assert!(check_webkit_root(Path::new("/pocketagent"), "pocketagent", None).is_err());
        assert!(!webkit_entry("Documents") && webkit_entry("localstorage") && webkit_entry("hsts-storage.sqlite-journal"));
        // A refused folder is never touched.
        put(&share.join("other/localstorage/x"));
        assert_eq!(remove_webkit_roots(&[share.join("other")], "pocketagent", Some(&home)).len(), 1);
        assert!(share.join("other/localstorage/x").exists());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn the_mark_stays_until_everything_is_gone() {
        let home = temp("mark");
        let config = home.join(".config").join(ID);
        let data = home.join(".local/share").join(ID);
        let mark = mark_path(&config, ID).unwrap();
        // Beside the settings folder: outside every folder that is removed.
        assert_eq!(mark, home.join(".config").join(format!("{ID}.erase-pending")));
        for root in [&config, &data] {
            assert!(!mark.starts_with(root));
        }
        assert!(check_root(&mark, ID, Some(&home)).is_err());
        put(&mark);
        put(&config.join("x"));
        // A failed erase keeps the mark (tried again at the next start).
        let mut tries = 0;
        assert!(!finish_with(&mark, 3, std::time::Duration::ZERO, || {
            tries += 1;
            vec!["held".into()]
        }));
        assert_eq!(tries, 3);
        assert!(mark.exists());
        // A complete one removes it, last.
        let roots = own_roots(&[config.clone(), data.clone()], ID, Some(&home));
        assert!(finish_with(&mark, 3, std::time::Duration::ZERO, || {
            assert!(mark.exists(), "the mark goes last");
            remove_roots(&roots, ID, Some(&home))
        }));
        assert!(!mark.exists() && !config.exists());
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
