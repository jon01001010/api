//! The "Allow?" dialog, shown by the native side so the web screens can't
//! skip it. Used for everything outside the app's own folder.

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Asks the user; true only if they press Allow.
pub async fn ask(app: &AppHandle, question: &str) -> bool {
    let app = app.clone();
    let question = question.to_string();
    // The dialog blocks, so it runs off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(question)
            .title("PocketAgent: allow this?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Allow".into(),
                "Don't allow".into(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false)
}
