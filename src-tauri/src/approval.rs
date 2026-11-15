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
///
/// `thinking`: the model's thinking from just before the request (from
/// the chat that asks), shown after the facts under MODEL_THINKING
/// (with_thinking) and never parsed. Every question and its answer go
/// to the answers log with the thinking (remote_ask::log_asked).
pub async fn ask_for(app: &AppHandle, question: &str, by: Option<&Device<'_>>, thinking: Option<&str>) -> bool {
    let yes = ask(app, &with_thinking(question, thinking)).await && by.is_none_or(|d| (d.still_allowed)());
    crate::remote_ask::log_asked(app, by.map(|d| d.name), yes, question, thinking);
    yes
}

/// The label above the model's thinking in a question (the same in the
/// app: chatGuard.ts MODEL_THINKING). Always after the facts and after
/// the model's own words.
pub const MODEL_THINKING: &str = "The model was thinking:";
/// Most characters of the thinking shown: the last ones (what led to the
/// request).
pub const MAX_THINKING: usize = 600;
/// The app's warning above the thinking when it reads like hiding
/// something or getting around checks (thinking_warning).
pub const THINKING_WARNING: &str =
    "WARNING: the model\u{2019}s thinking talks about hiding something from you or getting around checks. Read it before you allow anything.";

/// Phrases that call for THINKING_WARNING, lower case (the thinking is
/// lower-cased, curly quotes made straight, spaces joined). The same list
/// as the app's chatGuard.ts THINKING_RED_FLAGS (a test keeps them equal).
/// A warning sign only: thinking may not show the real intent.
pub const THINKING_RED_FLAGS: &[&str] = &[
    "won't notice",
    "will not notice",
    "wont notice",
    "doesn't need to know",
    "does not need to know",
    "don't tell the user",
    "do not tell the user",
    "not tell the user",
    "without the user knowing",
    "without them knowing",
    "without telling",
    "without asking",
    "hide it from",
    "hide this from",
    "hide from the user",
    "hide it so",
    "keep it secret",
    "keep this secret",
    "secretly",
    "covertly",
    "sneak",
    "bypass",
    "get around",
    "work around the approval",
    "work around the check",
    "circumvent",
    "evade",
    "avoid the approval",
    "avoid asking",
    "avoid the question",
    "skip the approval",
    "skip the check",
    "disable the log",
    "disable logging",
    "turn off logging",
    "delete the log",
    "clear the log",
    "remove the log",
    "cover my tracks",
    "cover tracks",
    "exfiltrate",
    "disable defender",
    "disable the antivirus",
    "disable antivirus",
    "trick the user",
];

/// THINKING_WARNING when the thinking has one of THINKING_RED_FLAGS.
pub fn thinking_warning(thinking: &str) -> Option<&'static str> {
    let plain: String = thinking
        .to_lowercase()
        .replace(['\u{2018}', '\u{2019}', '\u{2bc}'], "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    THINKING_RED_FLAGS.iter().any(|flag| plain.contains(flag)).then_some(THINKING_WARNING)
}

/// The thinking as a question shows it: its last MAX_THINKING characters
/// on one line (line breaks and hidden characters as escapes, like
/// model_words), saying how many came before.
pub fn thinking_words(thinking: &str) -> String {
    let chars: Vec<char> = thinking.trim().chars().collect();
    let skip = chars.len().saturating_sub(MAX_THINKING);
    let mut out = String::new();
    if skip > 0 {
        out.push_str(&format!("[\u{2026} {skip} characters before] "));
    }
    for &c in &chars[skip..] {
        match c {
            '\n' => out.push_str("\\n"),
            '\t' => out.push(' '),
            c if crate::remote_ask::hidden_char(c) => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// The question with the model's thinking at the end (after the facts and
/// the model's words): the warning line when called for, MODEL_THINKING,
/// the thinking (thinking_words). Unchanged without thinking.
pub fn with_thinking(question: &str, thinking: Option<&str>) -> String {
    let Some(thinking) = thinking.map(str::trim).filter(|t| !t.is_empty()) else {
        return question.to_string();
    };
    let mut q = format!("{question}\n\n");
    if let Some(warning) = thinking_warning(thinking) {
        q.push_str(warning);
        q.push('\n');
    }
    q.push_str(MODEL_THINKING);
    q.push('\n');
    q.push_str(&thinking_words(thinking));
    q
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
    fn the_thinking_comes_last_escaped_and_capped() {
        let q = with_thinking("Run this?\n\nGet-Date", Some("the user asked\nfor the date \u{202e}"));
        assert_eq!(q, "Run this?\n\nGet-Date\n\nThe model was thinking:\nthe user asked\\nfor the date \\u{202e}");
        // Nothing after the label pretends to be a line of facts.
        let label = q.find(MODEL_THINKING).unwrap();
        assert_eq!(q[label..].lines().count(), 2);
        assert_eq!(with_thinking("Q", None), "Q");
        assert_eq!(with_thinking("Q", Some("  \n ")), "Q");
        let long = thinking_words(&format!("{}{}", "a".repeat(1000), "b".repeat(MAX_THINKING)));
        assert_eq!(long, format!("[\u{2026} 1000 characters before] {}", "b".repeat(MAX_THINKING)));
    }

    #[test]
    fn thinking_about_hiding_or_getting_around_checks_is_flagged() {
        for bad in [
            "I'll do it quietly so the user won't notice",
            "The user WON\u{2019}T   NOTICE if I delete it",
            "Maybe I can bypass the approval dialog",
            "Let me get around the check by renaming it",
            "I should disable logging first",
            "then clear the log afterwards",
            "Don't tell the user about the upload",
            "secretly copy the key",
            "exfiltrate the data through the search query",
        ] {
            let q = with_thinking("Q", Some(bad));
            assert!(q.contains(THINKING_WARNING), "{bad}");
            assert!(q.find(THINKING_WARNING) < q.find(MODEL_THINKING), "{bad}");
        }
        for fine in [
            "The user wants the hidden files in Downloads listed.",
            "I need to read the log file they named and summarise it.",
            "Checking the disk space with Get-Volume.",
            "",
        ] {
            assert_eq!(thinking_warning(fine), None, "{fine}");
        }
    }

    #[test]
    fn the_red_flags_match_the_apps() {
        let ts = include_str!("../../src/services/agent/chatGuard.ts").replace("\r\n", "\n");
        let start = ts.find("export const THINKING_RED_FLAGS").unwrap();
        let body = &ts[start..start + ts[start..].find("];").unwrap()];
        let flags: Vec<String> = body
            .lines()
            .skip(1)
            .filter_map(|l| {
                let l = l.trim().trim_end_matches(',');
                (l.len() > 2).then(|| l[1..l.len() - 1].to_string())
            })
            .collect();
        assert_eq!(flags, THINKING_RED_FLAGS.iter().map(|f| f.to_string()).collect::<Vec<_>>());
        assert!(ts.contains("export const MODEL_THINKING = 'The model was thinking:';"));
    }

    #[test]
    fn a_device_never_allows_always() {
        assert_eq!(device_answer(true), Answer::Once);
        assert_eq!(device_answer(false), Answer::No);
    }
}
