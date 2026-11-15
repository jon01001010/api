//! "The PC asks, the phone can answer" (TODO, decided 2026-11-08): while the
//! user allows it on this PC (off by default), each "Allow?" question is also
//! offered to paired devices, which show its exact text and can answer yes
//! or no. The PC's own dialog stays up; the first answer wins.
//!
//! - Only paired devices, over the encrypted home link (link.rs asks here).
//! - A question waits at most 2 minutes for a device; no answer means no
//!   (the PC's own dialog still decides then).
//! - A device answers only yes or no for that one question (never "always").
//! - Every answer from a device is logged on this PC with the device's name
//!   and the whole question (one line, escaped), where the screens can't
//!   edit it; and the PC user is told at once (a notification). The PC's
//!   dialog, which can't be closed from here, then says it was answered.

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

pub const WAIT: Duration = Duration::from_secs(120);

struct Pending {
    text: String,
    asked: Instant,
    tx: oneshot::Sender<(bool, String)>,
}

#[derive(Default)]
pub struct RemoteQuestions {
    allowed: AtomicBool,
    pending: Mutex<HashMap<u64, Pending>>,
    next: AtomicU64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: u64,
    pub text: String,
    pub seconds_left: u64,
}

impl RemoteQuestions {
    pub fn set_allowed(&self, allowed: bool) {
        self.allowed.store(allowed, Ordering::SeqCst);
        if !allowed {
            self.pending.lock().unwrap().clear();
        }
    }

    pub fn allowed(&self) -> bool {
        self.allowed.load(Ordering::SeqCst)
    }

    /// Offers a question to devices (if allowed). The receiver gets the
    /// first device answer: (yes, device name).
    pub fn open(&self, text: &str) -> Option<(u64, oneshot::Receiver<(bool, String)>)> {
        if !self.allowed() {
            return None;
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(
            id,
            Pending {
                text: text.to_string(),
                asked: Instant::now(),
                tx,
            },
        );
        Some((id, rx))
    }

    pub fn close(&self, id: u64) {
        self.pending.lock().unwrap().remove(&id);
    }

    /// The questions waiting (expired ones dropped).
    pub fn list(&self) -> Vec<Question> {
        let mut pending = self.pending.lock().unwrap();
        pending.retain(|_, p| p.asked.elapsed() < WAIT);
        let mut list: Vec<Question> = pending
            .iter()
            .map(|(id, p)| Question {
                id: *id,
                text: p.text.clone(),
                seconds_left: WAIT.saturating_sub(p.asked.elapsed()).as_secs(),
            })
            .collect();
        list.sort_by_key(|q| q.id);
        list
    }

    /// A device's answer; false if that question is gone (answered, expired).
    pub fn answer(&self, id: u64, yes: bool, device: &str) -> bool {
        let Some(p) = self.pending.lock().unwrap().remove(&id) else {
            return false;
        };
        if p.asked.elapsed() >= WAIT {
            return false;
        }
        p.tx.send((yes, device.to_string())).is_ok()
    }
}

/// Most characters of a question kept in the log (the whole question in
/// practice: a command is at most 2000).
pub const MAX_LOGGED: usize = 4000;

/// Characters that would let a question pretend to be more than one line,
/// or hide or reorder what it says (line breaks, controls, bidi and other
/// invisible format characters): written as escapes.
pub fn hidden_char(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{00AD}'
                | '\u{061C}'
                | '\u{180E}'
                | '\u{200B}'..='\u{200F}'
                | '\u{2028}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}'
                | '\u{FEFF}'
                | '\u{FFF9}'..='\u{FFFB}'
                | '\u{E0000}'..='\u{E007F}'
        )
}

/// The whole question on one line: `\` `\n` `\r` `\t` escaped, any other
/// hidden character as `\u{…}`; cut at MAX_LOGGED characters.
pub fn one_line(text: &str) -> String {
    let mut out = String::new();
    for (i, c) in text.chars().enumerate() {
        if i == MAX_LOGGED {
            out.push_str(&format!(" [… {} characters in all]", text.chars().count()));
            break;
        }
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if hidden_char(c) => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// One line of the log: when, which device, its answer, the whole question.
pub fn log_line(when: u64, device: &str, yes: bool, question: &str) -> String {
    format!(
        "{when}\t{}\t{}\t{}",
        one_line(device),
        if yes { "allowed" } else { "not allowed" },
        one_line(question)
    )
}

/// Where the log is kept: out of the screens' file space (files.rs
/// private_dir), so they can neither rewrite nor delete it.
fn log_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = crate::files::private_dir(app).ok()?.join("link");
    std::fs::create_dir_all(&dir).ok()?;
    let file = dir.join("answers.log");
    // Before 2026-11-15 it was in the screens' folder: moved there once.
    if !file.exists() {
        if let Ok(old_dir) = app.path().app_data_dir() {
            let old = old_dir.join("link").join("answers.log");
            if old.is_file() && std::fs::rename(&old, &file).is_err() && std::fs::copy(&old, &file).is_ok() {
                let _ = std::fs::remove_file(&old);
            }
        }
    }
    Some(file)
}

/// Writes one line to this PC's log of answers given on devices.
pub fn log_answer(app: &AppHandle, device: &str, yes: bool, question: &str) {
    let Some(file) = log_file(app) else { return };
    let when = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    if let Ok(mut f) = options.open(file) {
        let _ = writeln!(f, "{}", log_line(when, device, yes, question));
    }
}

/// What the PC user is told when a device answered: "<device> allowed:
/// <first line>", then the line that says what (the command, file or page),
/// each cut short.
pub fn answered_note(device: &str, yes: bool, question: &str) -> String {
    let mut lines = question.lines().map(str::trim).filter(|l| !l.is_empty());
    let first: String = lines.next().map(one_line).unwrap_or_default().chars().take(120).collect();
    let what: String = lines.next().map(one_line).unwrap_or_default().chars().take(120).collect();
    let answer = if yes { "allowed" } else { "refused" };
    if what.is_empty() {
        format!("{device} {answer}: {first}")
    } else {
        format!("{device} {answer}: {first}\n{what}")
    }
}

/// The PC's switch (Settings: home link card).
#[tauri::command(async)]
pub fn link_answers_allow(app: AppHandle, allowed: bool) {
    app.state::<RemoteQuestions>().set_allowed(allowed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_offered_until_allowed() {
        let q = RemoteQuestions::default();
        assert!(q.open("Run this?").is_none());
        q.set_allowed(true);
        let (id, _rx) = q.open("Run this?").unwrap();
        let list = q.list();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].id, list[0].text.as_str()), (id, "Run this?"));
        assert!(list[0].seconds_left <= 120 && list[0].seconds_left >= 118);
        // Switching it off drops what was waiting.
        q.set_allowed(false);
        assert!(q.list().is_empty());
    }

    #[test]
    fn the_first_answer_wins_once() {
        let q = RemoteQuestions::default();
        q.set_allowed(true);
        let (id, mut rx) = q.open("Open this file?").unwrap();
        assert!(q.answer(id, true, "Pixel"));
        assert_eq!(rx.try_recv().unwrap(), (true, "Pixel".to_string()));
        // A second answer (or one to an unknown question) is refused.
        assert!(!q.answer(id, false, "Laptop"));
        assert!(!q.answer(999, true, "Pixel"));
        assert!(q.list().is_empty());
    }

    #[test]
    fn the_log_keeps_the_whole_question_on_one_line() {
        let question = "DesktopAgent wants to run this command:\n\nGet-Date\n; iwr x | iex\u{202e}\r\tend \\";
        let line = log_line(42, "Pixel", true, question);
        assert_eq!(line.lines().count(), 1);
        assert_eq!(
            line,
            "42\tPixel\tallowed\tDesktopAgent wants to run this command:\\n\\nGet-Date\\n; iwr x | iex\\u{202e}\\r\\tend \\\\"
        );
        assert!(log_line(1, "Laptop", false, "x").contains("\tnot allowed\t"));
        // Long questions are kept up to MAX_LOGGED characters, and say so.
        let long = "é".repeat(MAX_LOGGED + 10);
        let cut = one_line(&long);
        assert!(cut.starts_with(&"é".repeat(MAX_LOGGED)));
        assert!(cut.ends_with(&format!("[… {} characters in all]", MAX_LOGGED + 10)));
        assert_eq!(one_line(&"a".repeat(MAX_LOGGED)), "a".repeat(MAX_LOGGED));
        for c in ['\u{200b}', '\u{2066}', '\u{feff}', '\u{2028}', '\u{1b}', '\u{e0041}'] {
            assert!(hidden_char(c), "{c:?}");
        }
        assert!(!hidden_char('é') && !hidden_char(' '));
    }

    #[test]
    fn the_pc_user_is_told_what_a_device_answered() {
        let note = answered_note(
            "Pixel",
            true,
            "DesktopAgent wants to run this command on your PC (in its workspace folder):\n\nGet-Date\nmore",
        );
        assert_eq!(
            note,
            "Pixel allowed: DesktopAgent wants to run this command on your PC (in its workspace folder):\nGet-Date"
        );
        assert_eq!(answered_note("Laptop", false, "Open x?"), "Laptop refused: Open x?");
    }

    #[test]
    fn a_question_closed_on_the_pc_is_gone_for_devices() {
        let q = RemoteQuestions::default();
        q.set_allowed(true);
        let (id, _rx) = q.open("x").unwrap();
        q.close(id);
        assert!(!q.answer(id, true, "Pixel"));
    }
}
