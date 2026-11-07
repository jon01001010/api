//! "Always allow this file" for running a model from outside the app folder.
//! Kept in the system's credential store (Windows Credential Manager) under
//! names the screens can't write: their key command (secrets.rs) always puts
//! "PocketAgent:" in front, these start with "DesktopAgent-model:". Each entry
//! holds the file's path, size and last-changed time; if the file is replaced
//! or changed, it no longer matches and the app asks again.

use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

const PREFIX: &str = "DesktopAgent-model:";

#[derive(Debug, PartialEq, Serialize, Deserialize)]
pub struct Fingerprint {
    pub path: String,
    pub size: u64,
    pub modified_ms: u128,
}

/// The file as it is now (None if it can't be read).
pub fn fingerprint(path: &Path) -> Option<Fingerprint> {
    let meta = std::fs::metadata(path).ok()?;
    let modified_ms = meta
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    Some(Fingerprint {
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        modified_ms,
    })
}

/// A stable short name for a path (FNV-1a, 64 bit): credential names are
/// limited in length, paths are not.
pub fn entry_name(path: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{PREFIX}{hash:016x}")
}

fn entry(path: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(&entry_name(path), "file").ok()
}

/// True only if this exact file (same path, size and time) was always-allowed.
pub fn is_remembered(now: &Fingerprint) -> bool {
    entry(&now.path)
        .and_then(|e| e.get_password().ok())
        .and_then(|json| serde_json::from_str::<Fingerprint>(&json).ok())
        .map(|saved| &saved == now)
        .unwrap_or(false)
}

pub fn remember(now: &Fingerprint) {
    if let (Some(e), Ok(json)) = (entry(&now.path), serde_json::to_string(now)) {
        let _ = e.set_password(&json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_stable_and_out_of_the_screens_reach() {
        let a = entry_name("C:\\Users\\me\\Downloads\\m.gguf");
        assert_eq!(a, entry_name("C:\\Users\\me\\Downloads\\m.gguf"));
        assert_ne!(a, entry_name("C:\\Users\\me\\Downloads\\n.gguf"));
        assert!(a.starts_with("DesktopAgent-model:"));
        // The screens' key command can only make "PocketAgent:..." names.
        assert!(!a.starts_with("PocketAgent:"));
        assert!(a.len() < 64);
    }

    #[test]
    fn a_changed_file_is_a_different_fingerprint() {
        let dir = std::env::temp_dir().join(format!("pa-remember-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("m.gguf");
        std::fs::write(&file, b"one").unwrap();
        let first = fingerprint(&file).unwrap();
        assert_eq!(first, fingerprint(&file).unwrap());
        std::fs::write(&file, b"longer").unwrap();
        assert_ne!(first, fingerprint(&file).unwrap());
        std::fs::remove_file(&file).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }
}
