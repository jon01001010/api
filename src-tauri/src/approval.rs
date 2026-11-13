//! The "Allow?" dialog, shown by the native side so the web screens can't
//! skip it. Used for everything outside the app's own folder.
//!
//! While the user allows it on this PC, the same question is also offered
//! to paired devices (remote_ask.rs): the first answer wins, and a device
//! can only allow once. Pairing itself is asked on this PC only.

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Waits for this PC's dialog or, while allowed, a paired device's answer,
/// whichever comes first. A device answer is logged on this PC.
async fn first_answer<T: Send + 'static>(
    app: &AppHandle,
    question: &str,
    dialog: tauri::async_runtime::JoinHandle<T>,
    from_device: impl FnOnce(bool) -> T,
    refused: impl Fn() -> T,
) -> T {
    let questions = app.state::<crate::remote_ask::RemoteQuestions>();
    let Some((id, device)) = questions.open(question) else {
        return dialog.await.unwrap_or_else(|_| refused());
    };
    tokio::pin!(dialog);
    let answer = tokio::select! {
        here = &mut dialog => here.unwrap_or_else(|_| refused()),
        // Expired or closed on the device side: wait for this PC's dialog.
        Ok((yes, name)) = device => {
            crate::remote_ask::log_answer(app, &name, yes, question);
            from_device(yes)
        }
    };
    questions.close(id);
    answer
}

/// Asks the user; true only if they press Allow (here, or on a paired
/// device while that is allowed).
pub async fn ask(app: &AppHandle, question: &str) -> bool {
    let dialog = allow_dialog(app, question);
    first_answer(app, question, dialog, |yes| yes, || false).await
}

/// Asks on this PC only (pairing a new device).
#[cfg_attr(not(feature = "link"), allow(dead_code))]
pub async fn ask_on_this_pc(app: &AppHandle, question: &str) -> bool {
    allow_dialog(app, question).await.unwrap_or(false)
}

fn allow_dialog(app: &AppHandle, question: &str) -> tauri::async_runtime::JoinHandle<bool> {
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
/// A device can only allow once, never "always".
pub async fn ask_with_always(app: &AppHandle, question: &str) -> Answer {
    let app_here = app.clone();
    let text = question.to_string();
    let dialog = tauri::async_runtime::spawn_blocking(move || {
        let (app, question) = (app_here, text);
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
    });
    first_answer(app, question, dialog, device_answer, || Answer::No).await
}

/// A device's yes is "once" (never "always").
pub fn device_answer(yes: bool) -> Answer {
    if yes {
        Answer::Once
    } else {
        Answer::No
    }
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

    #[test]
    fn a_device_never_allows_always() {
        assert_eq!(device_answer(true), Answer::Once);
        assert_eq!(device_answer(false), Answer::No);
    }
}
