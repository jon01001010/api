//! API keys and tokens, kept in Windows Credential Manager (the app's own
//! secrets: no prompt). Mirrors react-native-keychain's generic password:
//! one username + password per service.

use serde::{Deserialize, Serialize};

const PREFIX: &str = "PocketAgent";

#[derive(Serialize, Deserialize)]
pub struct Secret {
    username: String,
    password: String,
}

fn entry(service: &str) -> Result<keyring::Entry, String> {
    if service.is_empty() || service.len() > 200 {
        return Err("Bad service name".into());
    }
    keyring::Entry::new(&format!("{PREFIX}:{service}"), "generic").map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn secret_get(service: String) -> Result<Option<Secret>, String> {
    match entry(&service)?.get_password() {
        Ok(json) => serde_json::from_str(&json).map(Some).map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command(async)]
pub fn secret_set(service: String, username: String, password: String) -> Result<(), String> {
    let json = serde_json::to_string(&Secret { username, password }).map_err(|e| e.to_string())?;
    entry(&service)?.set_password(&json).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn secret_delete(service: String) -> Result<(), String> {
    match entry(&service)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
