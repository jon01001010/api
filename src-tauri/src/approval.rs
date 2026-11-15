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
    let mut dialog = dialog;
    let answer = tokio::select! {
        here = &mut dialog => here.unwrap_or_else(|_| refused()),
        // Expired or closed on the device side: wait for this PC's dialog.
        Ok((yes, name)) = device => {
            crate::remote_ask::log_answer(app, &name, yes, question);
            answered_on_device(app, &name, yes, question, dialog);
            from_device(yes)
        }
    };
    questions.close(id);
    answer
}

/// A device answered first. The PC user is told at once (a notification),
/// and the PC's own dialog, which can't be closed from here, stays harmless:
/// whatever is pressed there now changes nothing, and a note says so.
fn answered_on_device<T: Send + 'static>(
    app: &AppHandle,
    device: &str,
    yes: bool,
    question: &str,
    dialog: tauri::async_runtime::JoinHandle<T>,
) {
    use tauri_plugin_notification::NotificationExt;
    let note = crate::remote_ask::answered_note(device, yes, question);
    let _ = app
        .notification()
        .builder()
        .title(format!("Answered on {device}"))
        .body(note.clone())
        .show();
    let app = app.clone();
    let device = device.to_string();
    tauri::async_runtime::spawn(async move {
        // The PC user pressed a button (or closed it): nothing more is done.
        let _ = dialog.await;
        let _ = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .message(format!(
                    "This was already answered on {device}, so your answer here changed nothing.\n\n{note}"
                ))
                .title("DesktopAgent: already answered")
                .kind(MessageDialogKind::Info)
                .blocking_show()
        })
        .await;
    });
}

/// Asks the user; true only if they press Allow (here, or on a paired
/// device while that is allowed).
pub async fn ask(app: &AppHandle, question: &str) -> bool {
    let dialog = allow_dialog(app, question);
    first_answer(app, question, dialog, |yes| yes, || false).await
}

/// A paired device asking for one of this PC's tools (link.rs "tool"): its
/// name goes into the question, and `still_allowed` is looked at again
/// after the answer (the PC's switches or the device may have changed
/// while the question was up).
pub struct Device<'a> {
    pub name: &'a str,
    pub still_allowed: &'a (dyn Fn() -> bool + Sync),
}

/// `ask`, for one of this PC's own tools, asked by this PC's screens
/// (`by`: None) or by a paired device: the same native "Allow?" every
/// time (Allow or Don't allow, never "always"; a device that may answer
/// can answer it, the asking one too: owner decision 1c). For a device,
/// true only if it is still allowed after the answer.
pub async fn ask_for(app: &AppHandle, question: &str, by: Option<&Device<'_>>) -> bool {
    if !ask(app, question).await {
        return false;
    }
    by.is_none_or(|d| (d.still_allowed)())
}

/// Asks on this PC only (pairing a new device; the model reaching a file
/// outside its workspace, outside.rs).
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

/// The label above any text the model supplied (its reason, the text it
/// wants to write, a description) in a native question. The facts the app
/// worked out itself (what, where, read or write, size) always come first;
/// the model's words only after this label, so they can't pass for the
/// app's own.
pub const MODEL_SAYS: &str = "The model says:";
/// Most characters of the model's words shown in one place of a question.
pub const MAX_MODEL_TEXT: usize = 300;

/// The model's words for a native question: on one line, line breaks and
/// hidden characters (controls, bidi, zero-width: remote_ask::hidden_char)
/// written as escapes, cut at MAX_MODEL_TEXT characters saying how long
/// it was.
pub fn model_words(text: &str) -> String {
    let total = text.chars().count();
    let mut out = String::new();
    for (i, c) in text.chars().enumerate() {
        if i == MAX_MODEL_TEXT {
            out.push_str(&format!("\u{2026} [{total} characters in all]"));
            break;
        }
        match c {
            '\n' => out.push_str("\\n"),
            '\t' => out.push(' '),
            c if crate::remote_ask::hidden_char(c) => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
    }
    out
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
    fn the_models_words_are_escaped_and_capped() {
        assert_eq!(model_words("tidy up"), "tidy up");
        assert_eq!(model_words("a\nAllow: yes"), "a\\nAllow: yes");
        assert_eq!(model_words("x\u{202e}gpj.exe"), "x\\u{202e}gpj.exe");
        assert_eq!(model_words("a\u{200b}b\rc"), "a\\u{200b}b\\u{d}c");
        let long = model_words(&"y".repeat(1000));
        assert!(long.starts_with(&"y".repeat(MAX_MODEL_TEXT)));
        assert!(long.ends_with("[1000 characters in all]"), "{long}");
        assert_eq!(long.chars().filter(|c| *c == 'y').count(), MAX_MODEL_TEXT);
    }

    #[test]
    fn a_device_never_allows_always() {
        assert_eq!(device_answer(true), Answer::Once);
        assert_eq!(device_answer(false), Answer::No);
    }
}
