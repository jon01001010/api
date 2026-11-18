//! API keys and tokens, and the app PIN's record: the screens' secrets.
//! Mirrors react-native-keychain's generic password: one username +
//! password per service.
//!
//! - Windows: Credential Manager (the app's own secrets: no prompt), as
//!   "PocketAgent:<service>".
//! - Linux: one owner-only file per service in the app's settings folder
//!   (private_file.rs: ~/.config/<identifier>/secrets, 0700, files 0600),
//!   which the screens' file commands and the model never reach. Not the
//!   kernel key store: a reboot clears it (keyring 3.6.3, keyutils.rs), so
//!   the app PIN and every key were lost at each restart of the PC. An
//!   entry still in the kernel key store from an earlier version is moved
//!   to the file when it is first read, and removed there.
//!
//! The erase PIN removes them all (erase.rs: the settings folder, and the
//! "PocketAgent:" entries of either store).

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const PREFIX: &str = "PocketAgent";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Secret {
    username: String,
    password: String,
}

fn check_service(service: &str) -> Result<(), String> {
    if service.is_empty() || service.len() > 200 {
        return Err("Bad service name".into());
    }
    Ok(())
}

/// The keyring entry: Windows' store, and on Linux the old kernel key store
/// (only to move entries out of it).
fn entry(service: &str) -> Result<keyring::Entry, String> {
    check_service(service)?;
    keyring::Entry::new(&format!("{PREFIX}:{service}"), "generic").map_err(|e| e.to_string())
}

#[cfg(windows)]
pub fn read(_app: &AppHandle, service: &str) -> Result<Option<Secret>, String> {
    match entry(service)?.get_password() {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(windows)]
fn write(_app: &AppHandle, service: &str, secret: &Secret) -> Result<(), String> {
    let json = serde_json::to_string(secret).map_err(|e| e.to_string())?;
    entry(service)?.set_password(&json).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn delete(_app: &AppHandle, service: &str) -> Result<(), String> {
    match entry(service)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(windows))]
pub use file_store::read;

#[cfg(not(windows))]
use file_store::{delete, write};

#[cfg(not(windows))]
mod file_store {
    use super::{check_service, entry, Secret};
    use serde::{Deserialize, Serialize};
    use sha2::{Digest, Sha256};
    use std::path::{Path, PathBuf};
    use tauri::{AppHandle, Manager};

    /// What a file holds: the service too, so a file is only ever taken
    /// for its own service.
    #[derive(Serialize, Deserialize)]
    struct Stored {
        service: String,
        username: String,
        password: String,
    }

    /// Where an older version kept the secret (the kernel key store).
    pub trait Legacy {
        fn get(&self, service: &str) -> Option<String>;
        fn delete(&self, service: &str);
    }

    struct KernelKeyring;

    impl Legacy for KernelKeyring {
        fn get(&self, service: &str) -> Option<String> {
            entry(service).ok()?.get_password().ok()
        }
        fn delete(&self, service: &str) {
            if let Ok(e) = entry(service) {
                let _ = e.delete_credential();
            }
        }
    }

    /// The settings folder's "secrets" folder (never the screens' folder).
    fn dir(app: &AppHandle) -> Result<PathBuf, String> {
        let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        crate::private_file::private_dir(&config, &data, "secrets")
    }

    /// One file per service, named by its SHA-256 (any service name, no
    /// two the same, never a path).
    pub fn file_for(dir: &Path, service: &str) -> PathBuf {
        let hash = Sha256::digest(service.as_bytes());
        let name: String = hash.iter().map(|b| format!("{b:02x}")).collect();
        dir.join(name)
    }

    pub fn read_in(dir: &Path, service: &str, legacy: &dyn Legacy) -> Result<Option<Secret>, String> {
        check_service(service)?;
        let file = file_for(dir, service);
        if let Some(text) = crate::private_file::read(&file) {
            let stored: Stored = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            if stored.service != service {
                return Err("The stored secret is for another service".into());
            }
            return Ok(Some(Secret { username: stored.username, password: stored.password }));
        }
        // Moved from the kernel key store (an earlier version), once.
        let Some(json) = legacy.get(service) else {
            return Ok(None);
        };
        let secret: Secret = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        write_in(dir, service, &secret, legacy)?;
        Ok(Some(secret))
    }

    /// Writes the file; any old kernel key store entry goes, so it can't
    /// come back after a later delete.
    pub fn write_in(dir: &Path, service: &str, secret: &Secret, legacy: &dyn Legacy) -> Result<(), String> {
        check_service(service)?;
        let stored = Stored {
            service: service.to_string(),
            username: secret.username.clone(),
            password: secret.password.clone(),
        };
        let json = serde_json::to_string(&stored).map_err(|e| e.to_string())?;
        crate::private_file::write(&file_for(dir, service), &json)?;
        legacy.delete(service);
        Ok(())
    }

    pub fn delete_in(dir: &Path, service: &str, legacy: &dyn Legacy) -> Result<(), String> {
        check_service(service)?;
        legacy.delete(service);
        crate::private_file::remove(&file_for(dir, service))
    }

    pub fn read(app: &AppHandle, service: &str) -> Result<Option<Secret>, String> {
        read_in(&dir(app)?, service, &KernelKeyring)
    }

    pub fn write(app: &AppHandle, service: &str, secret: &Secret) -> Result<(), String> {
        write_in(&dir(app)?, service, secret, &KernelKeyring)
    }

    pub fn delete(app: &AppHandle, service: &str) -> Result<(), String> {
        delete_in(&dir(app)?, service, &KernelKeyring)
    }
}

#[tauri::command(async)]
pub fn secret_get(app: AppHandle, service: String) -> Result<Option<Secret>, String> {
    read(&app, &service)
}

#[tauri::command(async)]
pub fn secret_set(app: AppHandle, service: String, username: String, password: String) -> Result<(), String> {
    write(&app, &service, &Secret { username, password })
}

#[tauri::command(async)]
pub fn secret_delete(app: AppHandle, service: String) -> Result<(), String> {
    delete(&app, &service)
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::file_store::*;
    use super::Secret;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// A stand-in for the kernel key store.
    #[derive(Default)]
    struct Old(RefCell<HashMap<String, String>>);

    impl Legacy for Old {
        fn get(&self, service: &str) -> Option<String> {
            self.0.borrow().get(service).cloned()
        }
        fn delete(&self, service: &str) {
            self.0.borrow_mut().remove(service);
        }
    }

    fn secret(u: &str, p: &str) -> Secret {
        Secret { username: u.into(), password: p.into() }
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let home = std::env::temp_dir().join(format!("pa-secrets-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        home
    }

    #[test]
    fn kept_in_an_owner_only_file_and_none_when_missing() {
        use std::os::unix::fs::PermissionsExt;
        let home = temp("file");
        let dir = home.join(".config/app.pocketagent.desktop/secrets");
        let old = Old::default();
        assert_eq!(read_in(&dir, "pocketagent-app-lock", &old).unwrap(), None);
        write_in(&dir, "pocketagent-app-lock", &secret("app-lock-v1", "{\"v\":1}"), &old).unwrap();
        write_in(&dir, "openai", &secret("key", "sk-1"), &old).unwrap();
        assert_eq!(read_in(&dir, "pocketagent-app-lock", &old).unwrap(), Some(secret("app-lock-v1", "{\"v\":1}")));
        assert_eq!(read_in(&dir, "openai", &old).unwrap(), Some(secret("key", "sk-1")));
        let file = file_for(&dir, "openai");
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        // The name is a hash: never a path, whatever the service is called.
        assert_eq!(file_for(&dir, "../../x").parent(), Some(dir.as_path()));
        // A file copied over another service's is refused.
        std::fs::copy(&file, file_for(&dir, "groq")).unwrap();
        assert!(read_in(&dir, "groq", &old).is_err());
        delete_in(&dir, "openai", &old).unwrap();
        delete_in(&dir, "openai", &old).unwrap();
        assert_eq!(read_in(&dir, "openai", &old).unwrap(), None);
        assert!(read_in(&dir, "", &old).is_err());
        assert!(read_in(&dir, &"x".repeat(201), &old).is_err());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn moved_from_the_kernel_key_store_once() {
        let home = temp("move");
        let dir = home.join("secrets");
        let old = Old::default();
        old.0.borrow_mut().insert("pocketagent-app-lock".into(), serde_json::to_string(&secret("app-lock-v1", "rec")).unwrap());
        assert_eq!(read_in(&dir, "pocketagent-app-lock", &old).unwrap(), Some(secret("app-lock-v1", "rec")));
        // Moved: in the file, gone from the old store.
        assert!(old.0.borrow().is_empty());
        assert!(file_for(&dir, "pocketagent-app-lock").exists());
        assert_eq!(read_in(&dir, "pocketagent-app-lock", &old).unwrap(), Some(secret("app-lock-v1", "rec")));
        // The file wins over a stale old entry; a write or delete clears it.
        old.0.borrow_mut().insert("pocketagent-app-lock".into(), serde_json::to_string(&secret("x", "stale")).unwrap());
        assert_eq!(read_in(&dir, "pocketagent-app-lock", &old).unwrap(), Some(secret("app-lock-v1", "rec")));
        delete_in(&dir, "pocketagent-app-lock", &old).unwrap();
        assert!(old.0.borrow().is_empty());
        assert_eq!(read_in(&dir, "pocketagent-app-lock", &old).unwrap(), None);
        std::fs::remove_dir_all(&home).unwrap();
    }
}
