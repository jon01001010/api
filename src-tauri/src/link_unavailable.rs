//! Stand-in for link.rs when built without the `link` feature (only the
//! Windows type-check on Linux does that): every command says so.

#[tauri::command]
pub async fn link_pair() -> Result<(), String> {
    Err("The home link is not in this build".into())
}

#[tauri::command]
pub async fn link_on() -> Result<(), String> {
    Err("The home link is not in this build".into())
}

#[tauri::command]
pub async fn link_off() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn link_status() -> Result<(), String> {
    Err("The home link is not in this build".into())
}

#[tauri::command]
pub async fn link_forget(_id: String) -> Result<(), String> {
    Err("The home link is not in this build".into())
}
