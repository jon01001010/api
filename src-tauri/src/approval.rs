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
            .title("DesktopAgent: allow this?")
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

/// The answer to a question that offers "always".
#[derive(Debug, PartialEq)]
pub enum Answer {
    Once,
    Always,
    No,
}

pub const ALLOW_ONCE: &str = "Allow once";
pub const ALWAYS: &str = "Always allow this file";
pub const DONT: &str = "Don't allow";

/// Which button was pressed. Closing the dialog, or anything unexpected,
/// is "Don't allow".
pub fn answer_from(result: &tauri_plugin_dialog::MessageDialogResult) -> Answer {
    use tauri_plugin_dialog::MessageDialogResult as R;
    match result {
        R::Custom(label) if label == ALLOW_ONCE => Answer::Once,
        R::Custom(label) if label == ALWAYS => Answer::Always,
        // "Always" only from its own button. A plain Yes/No box (if a
        // system ever ignored the custom names) can allow once at most.
        R::Yes => Answer::Once,
        _ => Answer::No,
    }
}

/// Asks with three buttons: Allow once, Always allow this file, Don't allow.
pub async fn ask_with_always(app: &AppHandle, question: &str) -> Answer {
    let app = app.clone();
    let question = question.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let result = app
            .dialog()
            .message(question)
            .title("DesktopAgent: allow this?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                ALLOW_ONCE.into(),
                ALWAYS.into(),
                DONT.into(),
            ))
            .blocking_show_with_result();
        answer_from(&result)
    })
    .await
    .unwrap_or(Answer::No)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_dialog::MessageDialogResult as R;

    #[test]
    fn only_the_allow_buttons_allow() {
        assert_eq!(answer_from(&R::Custom(ALLOW_ONCE.into())), Answer::Once);
        assert_eq!(answer_from(&R::Custom(ALWAYS.into())), Answer::Always);
        assert_eq!(answer_from(&R::Custom(DONT.into())), Answer::No);
        assert_eq!(answer_from(&R::Cancel), Answer::No);
        assert_eq!(answer_from(&R::Ok), Answer::No);
        assert_eq!(answer_from(&R::No), Answer::No);
        assert_eq!(answer_from(&R::Yes), Answer::Once);
        assert_eq!(answer_from(&R::Custom("something else".into())), Answer::No);
    }
}
