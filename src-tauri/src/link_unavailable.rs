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

#[tauri::command]
pub async fn link_device_may_answer(_id: String, _allowed: bool) -> Result<(), String> {
    Err("The home link is not in this build".into())
}

#[tauri::command]
pub async fn link_device_may_picture(_id: String, _allowed: bool) -> Result<(), String> {
    Err("The home link is not in this build".into())
}

#[tauri::command]
pub async fn link_pictures_allow(_allowed: bool) -> Result<(), String> {
    Err("The home link is not in this build".into())
}

// PC to PC (link_client.rs): not in this build either.
const OFF: &str = r#"{"ok":false,"error":"The home link is not in this build"}"#;

#[tauri::command]
pub async fn homelink_pair(_qr: String) -> String {
    OFF.into()
}

#[tauri::command]
pub async fn homelink_status(_pc: String) -> String {
    OFF.into()
}

#[tauri::command]
pub async fn homelink_start_model(_pc: String) -> String {
    OFF.into()
}

#[tauri::command]
pub async fn homelink_open_tunnel(_pc: String) -> String {
    OFF.into()
}

#[tauri::command]
pub async fn homelink_picture(
    _pc: String,
    _prompt: String,
    _width: Option<u32>,
    _height: Option<u32>,
    _steps: Option<u32>,
) -> String {
    OFF.into()
}

#[tauri::command]
pub async fn homelink_close_tunnel() -> String {
    OFF.into()
}

#[tauri::command]
pub async fn homelink_sync(_pc: String, _body: String) -> String {
    OFF.into()
}

#[tauri::command]
pub async fn homelink_questions(_pc: String) -> String {
    OFF.into()
}

#[tauri::command]
pub async fn homelink_answer_question(_pc: String, _id: u64, _yes: bool) -> String {
    OFF.into()
}

#[tauri::command]
pub async fn link_sync_allow(_allowed: bool) {}

#[tauri::command]
pub async fn link_sync_reply(_id: u64, _body: String) -> Result<(), String> {
    Err("The home link is not in this build".into())
}
