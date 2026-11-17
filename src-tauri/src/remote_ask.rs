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
//!   A question that shows something private (the clipboard's text, whether
//!   this PC's own tool or a paired device asked) is logged, and told in
//!   the notification, without it ("clipboard (N characters)"). The log is kept to
//!   about 2 MB: past 1 MB it moves to answers.log.1 (replacing the older
//!   one) and a new one starts.
//! - Security review 2026-11-17: a device sees the private parts of a
//!   question (the clipboard's text, the text of a change to a workspace
//!   file, the model's thinking, this PC's own paths) only when it asked
//!   that question itself (it gets them anyway). Every other device gets
//!   the question with those parts replaced by what they are
//!   (shared_view: "clipboard text, N characters, shown on the PC only"),
//!   and can only refuse it. A question asked by this PC itself has no
//!   asking device: no device sees its private parts.

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
    /// The question without its private parts (shared_view), when it has any.
    shared: Option<String>,
    /// The device that asked (its key); None: this PC.
    asker: Option<String>,
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
    /// Private parts left out for this device: it can only refuse.
    pub only_refuse: bool,
}

/// Why a device's answer was not taken.
pub const GONE: &str = "That question was already answered or has expired";
pub const ONLY_REFUSE: &str = "Parts of that question are shown on the PC only, so it can only be allowed there";

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
    /// first device answer: (yes, device name). `asker`: the device that
    /// asked (its key), the only one shown the private parts; None: this PC.
    pub fn open(&self, text: &str, asker: Option<&str>) -> Option<(u64, oneshot::Receiver<(bool, String)>)> {
        if !self.allowed() {
            return None;
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(
            id,
            Pending {
                text: text.to_string(),
                shared: shared_view(text),
                asker: asker.map(str::to_string),
                asked: Instant::now(),
                tx,
            },
        );
        Some((id, rx))
    }

    pub fn close(&self, id: u64) {
        self.pending.lock().unwrap().remove(&id);
    }

    /// The questions waiting (expired ones dropped), as `device` (its key)
    /// may see them: whole if it asked or there is nothing private in them,
    /// else without the private parts and to refuse only.
    pub fn list_for(&self, device: &str) -> Vec<Question> {
        let mut pending = self.pending.lock().unwrap();
        pending.retain(|_, p| p.asked.elapsed() < WAIT);
        let mut list: Vec<Question> = pending
            .iter()
            .map(|(id, p)| {
                let hidden = p.hidden_from(device);
                Question {
                    id: *id,
                    text: match (&p.shared, hidden) {
                        (Some(shared), true) => shared.clone(),
                        _ => p.text.clone(),
                    },
                    seconds_left: WAIT.saturating_sub(p.asked.elapsed()).as_secs(),
                    only_refuse: hidden,
                }
            })
            .collect();
        list.sort_by_key(|q| q.id);
        list
    }

    /// A device's answer (`device`: its key, `name`: its name); Err if that
    /// question is gone (answered, expired: GONE), or it is a yes to a
    /// question this device was shown without its private parts
    /// (ONLY_REFUSE: the question stays open).
    pub fn answer(&self, id: u64, yes: bool, device: &str, name: &str) -> Result<(), &'static str> {
        let mut pending = self.pending.lock().unwrap();
        if yes && pending.get(&id).is_some_and(|p| p.hidden_from(device)) {
            return Err(ONLY_REFUSE);
        }
        let Some(p) = pending.remove(&id) else {
            return Err(GONE);
        };
        if p.asked.elapsed() >= WAIT {
            return Err(GONE);
        }
        p.tx.send((yes, name.to_string())).map_err(|_| GONE)
    }
}

impl Pending {
    /// Whether `device` is shown this question without its private parts.
    fn hidden_from(&self, device: &str) -> bool {
        self.shared.is_some() && self.asker.as_deref() != Some(device)
    }
}

/// A device's key, short, for the PC user (approval::Refusals).
pub fn short_key(key: &str) -> String {
    let short: String = key.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    format!("{short}\u{2026}")
}

/// What other devices are shown in place of the clipboard's text.
pub fn clipboard_hidden(chars: usize) -> String {
    format!("(clipboard text, {chars} characters, shown on the PC only)")
}
/// What other devices are shown in place of a change's text.
pub const CHANGE_HIDDEN: &str = "(the change itself is shown on the PC only)";
/// What other devices are shown in place of the model's thinking.
pub const THINKING_HIDDEN: &str = "(the model's thinking is shown on the PC only)";

/// A question without its private parts, for devices other than the one
/// that asked it; None when it has none. The clipboard's text and a
/// change's text (as the log leaves them out: loggable) and the model's
/// thinking (approval::with_thinking; its warning line is the app's own
/// and kept) are replaced by what they are; this PC's paths by `<path>`
/// (hide_paths).
pub fn shared_view(question: &str) -> Option<String> {
    let (body, thinking) = split_thinking(question);
    let first = body.split('\n').next().unwrap_or("");
    let clipboard = first == CLIPBOARD_ASK || (first.starts_with('\u{201c}') && first.ends_with(CLIPBOARD_ASK_DEVICE));
    let write = first.starts_with('\u{201c}') && first.ends_with(WRITE_ASK_DEVICE);
    let mut out = if clipboard {
        let text = body[first.len()..].trim_start_matches('\n');
        format!("{first}\n\n{}", clipboard_hidden(text.chars().count()))
    } else if write {
        let what = body[first.len()..].trim_start_matches('\n').split('\n').next().unwrap_or("");
        hide_paths(&format!("{first}\n{what}\n\n{CHANGE_HIDDEN}"))
    } else {
        hide_paths(body)
    };
    if let Some(thinking) = thinking {
        out.push_str("\n\n");
        if thinking.starts_with(crate::approval::THINKING_WARNING) {
            out.push_str(crate::approval::THINKING_WARNING);
            out.push('\n');
        }
        out.push_str(THINKING_HIDDEN);
    }
    (out != question).then_some(out)
}

/// The question and the model's thinking after it (approval::with_thinking:
/// from its warning line or label to the end), if any.
fn split_thinking(question: &str) -> (&str, Option<&str>) {
    for mark in [crate::approval::THINKING_WARNING, crate::approval::MODEL_THINKING] {
        if let Some(at) = question.rfind(&format!("\n\n{mark}")) {
            return (&question[..at], Some(&question[at + 2..]));
        }
    }
    (question, None)
}

/// Every absolute path (a drive path, a UNC path, a home or system folder
/// on Linux) shown as `<path>`, up to the next space, quote or bracket:
/// at the start of a word or after `=`, `:` or an opening quote or
/// bracket (`key=C:\...`, `file:/home/...`). Also link.rs without_paths.
pub fn hide_paths(text: &str) -> String {
    text.split('\n').map(hide_paths_line).collect::<Vec<_>>().join("\n")
}

fn hide_paths_line(line: &str) -> String {
    let mut cleaned = String::new();
    for (i, word) in line.split(' ').enumerate() {
        if i > 0 {
            cleaned.push(' ');
        }
        cleaned.push_str(&hide_paths_word(word));
    }
    cleaned
}

fn path_starts(rest: &str) -> bool {
    let b = rest.as_bytes();
    let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/');
    let unc = rest.starts_with("\\\\");
    let home = ["/home/", "/Users/", "/root/", "/var/", "/tmp/", "/opt/", "/mnt/", "/media/", "/usr/", "/etc/", "/srv/", "/run/"]
        .iter()
        .any(|p| rest.starts_with(p));
    drive || unc || home
}

fn hide_paths_word(word: &str) -> String {
    let mut out = String::new();
    let mut rest = word;
    loop {
        // Where a path may start: the word's start, or after one of these.
        let mut at = None;
        let mut prev: Option<char> = None;
        for (i, c) in rest.char_indices() {
            let may = match prev {
                None => true,
                Some(p) => matches!(p, '=' | ':' | '"' | '\'' | '(' | '[' | '`' | '<' | '{' | ','),
            };
            if may && path_starts(&rest[i..]) {
                at = Some(i);
                break;
            }
            prev = Some(c);
        }
        let Some(at) = at else {
            out.push_str(rest);
            return out;
        };
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        // A drive's own `:` is not an end.
        let skip = if tail.as_bytes().get(1) == Some(&b':') { 2 } else { 0 };
        let end = tail[skip..]
            .find(['"', '\'', ')', ']', '`', ',', ';', '>', '}'])
            .map(|e| e + skip)
            .unwrap_or(tail.len());
        out.push_str("<path>");
        rest = &tail[end..];
    }
}

/// Most characters of a question kept in the log (the whole question in
/// practice: a command is at most 2000).
pub const MAX_LOGGED: usize = 4000;

/// The first line of the clipboard question (pc_extra.rs); what follows it
/// is the clipboard's text, never written to the log.
pub const CLIPBOARD_ASK: &str = "DesktopAgent wants to give the model the text on your clipboard:";

/// Past this size the log moves to answers.log.1 and a new one starts.
pub const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// How the clipboard question's first line ends when a paired device asks
/// (pc_extra::clipboard_question_for): `“<device>` comes before it.
pub const CLIPBOARD_ASK_DEVICE: &str =
    "\u{201d} asks for the text on your clipboard (it goes to that device's model):";

/// How the first line of a paired device's change to a workspace file ends
/// (pc_write::question): `“<device>` comes before it. The text of the
/// change that follows is never written to the log.
pub const WRITE_ASK_DEVICE: &str = "\u{201d} asks to change a file in your workspace on this PC:";

/// A question as the log keeps it: the clipboard's text (often a password)
/// replaced by its length, whether this PC's own tool or a paired device
/// asked (the first line, with the device's name, is kept); any other
/// question as it is. Every other question's first line is fixed text that
/// ends otherwise, so nothing else can be cut short here.
pub fn loggable(question: &str) -> String {
    let first = question.split('\n').next().unwrap_or("");
    // A paired device's change to a workspace file (pc_write::question):
    // who and what (the file, the line counts), never the text.
    if first.starts_with('\u{201c}') && first.ends_with(WRITE_ASK_DEVICE) {
        let what = question[first.len()..].trim_start_matches('\n').split('\n').next().unwrap_or("");
        return format!("{first}\n{what}\n(the change itself is not logged)");
    }
    let clipboard = first == CLIPBOARD_ASK || (first.starts_with('\u{201c}') && first.ends_with(CLIPBOARD_ASK_DEVICE));
    if !clipboard {
        return question.to_string();
    }
    let mut shown = question[first.len()..].trim_start_matches('\n');
    // The model's thinking after it (approval::with_thinking) is not the
    // clipboard's: not counted.
    for mark in [crate::approval::THINKING_WARNING, crate::approval::MODEL_THINKING] {
        if let Some(at) = shown.rfind(&format!("\n\n{mark}")) {
            shown = &shown[..at];
            break;
        }
    }
    format!("{first} clipboard ({} characters, not logged)", shown.chars().count())
}

/// Characters that would let a question pretend to be more than one line,
/// or hide or reorder what it says (line breaks, controls, bidi and other
/// invisible format characters; since the security review of 2026-11-17
/// also blank look-alikes: Hangul fillers, the blank Braille pattern, wide
/// spaces, variation selectors, the combining grapheme joiner): written as
/// escapes.
pub fn hidden_char(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{00AD}'
                | '\u{034F}'
                | '\u{061C}'
                | '\u{115F}'..='\u{1160}'
                | '\u{180B}'..='\u{180E}'
                | '\u{2000}'..='\u{200F}'
                | '\u{2028}'..='\u{202E}'
                | '\u{2060}'..='\u{206F}'
                | '\u{2800}'
                | '\u{3000}'
                | '\u{3164}'
                | '\u{FE00}'..='\u{FE0F}'
                | '\u{FEFF}'
                | '\u{FFA0}'
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
        one_line(&loggable(question))
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
    append(app, |when| log_line(when, device, yes, question));
}

/// One line of the log for a question one of this PC's tools asked
/// (approval::ask_for): when, who asked (this PC's own model, or a paired
/// device), the answer, the question as the log keeps it (loggable: never
/// the clipboard's text or a change's text) and the model's thinking from
/// just before the request (its last approval::MAX_THINKING characters),
/// all escaped, one line. Private like the rest of the log.
pub fn asked_line(when: u64, by: Option<&str>, yes: bool, question: &str, thinking: Option<&str>) -> String {
    let who = match by {
        Some(device) => format!("asked by {device}"),
        None => "asked by this PC's model".to_string(),
    };
    let mut line = format!(
        "{when}\t{}\t{}\t{}",
        one_line(&who),
        if yes { "allowed" } else { "not allowed" },
        one_line(&loggable(question))
    );
    if let Some(thinking) = thinking.map(str::trim).filter(|t| !t.is_empty()) {
        line.push_str("\tthe model was thinking: ");
        line.push_str(&one_line(&crate::approval::thinking_words(thinking)));
    }
    line
}

/// Writes one line to the answers log: a tool's question and its answer.
pub fn log_asked(app: &AppHandle, by: Option<&str>, yes: bool, question: &str, thinking: Option<&str>) {
    append(app, |when| asked_line(when, by, yes, question, thinking));
}

/// One line of the log for something a device did with this PC's tools
/// (link.rs "tool"): when, which device, "used", what (escaped, one line).
pub fn use_line(when: u64, device: &str, what: &str) -> String {
    format!("{when}\t{}\tused\t{}", one_line(device), one_line(what))
}

/// Writes one line to the same log: a device used one of this PC's tools.
#[cfg_attr(not(feature = "link"), allow(dead_code))]
pub fn log_use(app: &AppHandle, device: &str, what: &str) {
    append(app, |when| use_line(when, device, what));
}

/// The log of the model's file use outside its workspace (outside.rs),
/// next to answers.log: the same private folder, the same rotation.
pub const OUTSIDE_LOG: &str = "outside.log";

/// Writes one line to the log of access outside the workspace (no file
/// contents, ever: outside::log_line).
pub fn log_outside(app: &AppHandle, line: impl FnOnce(u64) -> String) {
    let Some(file) = log_file(app).map(|f| f.with_file_name(OUTSIDE_LOG)) else { return };
    append_to(&file, line);
}

fn append(app: &AppHandle, line: impl FnOnce(u64) -> String) {
    let Some(file) = log_file(app) else { return };
    append_to(&file, line);
}

fn append_to(file: &std::path::Path, line: impl FnOnce(u64) -> String) {
    let when = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    rotate(file, MAX_LOG_BYTES);
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    if let Ok(mut f) = options.open(file) {
        let _ = writeln!(f, "{}", line(when));
    }
}

/// Past `max` bytes the log moves to `<name>.1` (replacing the older one),
/// so it stays at about twice `max` in all.
pub fn rotate(file: &std::path::Path, max: u64) {
    if std::fs::metadata(file).map(|m| m.len() > max).unwrap_or(false) {
        let mut old = file.as_os_str().to_owned();
        old.push(".1");
        let old = std::path::PathBuf::from(old);
        let _ = std::fs::remove_file(&old);
        let _ = std::fs::rename(file, &old);
    }
}

/// What the PC user is told when a device answered: "<device> allowed:
/// <first line>", then the line that says what (the command, file or page),
/// each cut short.
pub fn answered_note(device: &str, yes: bool, question: &str) -> String {
    // The clipboard's text stays out of notifications too.
    let question = loggable(question);
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
    fn every_question_is_logged_with_the_thinking_behind_it() {
        let line = asked_line(5, None, true, "DesktopAgent wants to run this command on your PC (in its workspace folder):\n\nGet-Date", Some("the user\nwants the date"));
        assert_eq!(line.lines().count(), 1);
        assert!(line.starts_with("5\tasked by this PC's model\tallowed\tDesktopAgent wants to run"), "{line}");
        assert!(line.contains("\\n\\nGet-Date"), "{line}");
        assert!(line.ends_with("\tthe model was thinking: the user\\\\nwants the date"), "{line}");
        let line = asked_line(6, Some("Pixel 8"), false, "Q", None);
        assert_eq!(line, "6\tasked by Pixel 8\tnot allowed\tQ");
        // The clipboard's text is never logged, the thinking is.
        let q = format!("{CLIPBOARD_ASK}\n\nhunter2");
        let line = asked_line(7, None, true, &q, Some("read it"));
        assert!(!line.contains("hunter2"), "{line}");
        assert!(line.contains("clipboard (7 characters, not logged)") && line.ends_with("thinking: read it"), "{line}");
        // Capped: the last approval::MAX_THINKING characters.
        let line = asked_line(8, None, true, "Q", Some(&"x".repeat(5000)));
        assert!(line.contains("[\u{2026} 4400 characters before]"), "{line}");
        // A device's answer: the clipboard count leaves the thinking out.
        let shown = crate::approval::with_thinking(&q, Some("the user won't notice"));
        assert_eq!(loggable(&shown), format!("{CLIPBOARD_ASK} clipboard (7 characters, not logged)"));
    }

    #[test]
    fn nothing_is_offered_until_allowed() {
        let q = RemoteQuestions::default();
        assert!(q.open("Run this?", None).is_none());
        q.set_allowed(true);
        let (id, _rx) = q.open("Run this?", None).unwrap();
        let list = q.list_for("dev");
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].id, list[0].text.as_str()), (id, "Run this?"));
        assert!(list[0].seconds_left <= 120 && list[0].seconds_left >= 118);
        // Switching it off drops what was waiting.
        q.set_allowed(false);
        assert!(q.list_for("dev").is_empty());
    }

    #[test]
    fn the_first_answer_wins_once() {
        let q = RemoteQuestions::default();
        q.set_allowed(true);
        let (id, mut rx) = q.open("Open this file?", None).unwrap();
        assert!(q.answer(id, true, "pk", "Pixel").is_ok());
        assert_eq!(rx.try_recv().unwrap(), (true, "Pixel".to_string()));
        // A second answer (or one to an unknown question) is refused.
        assert!(q.answer(id, false, "lk", "Laptop").is_err());
        assert!(q.answer(999, true, "pk", "Pixel").is_err());
        assert!(q.list_for("dev").is_empty());
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
        for c in ['\u{200b}', '\u{2066}', '\u{feff}', '\u{2028}', '\u{1b}', '\u{e0041}', '\u{3164}', '\u{115f}', '\u{1160}', '\u{ffa0}', '\u{2800}', '\u{34f}', '\u{fe0f}', '\u{180b}', '\u{2003}', '\u{3000}'] {
            assert!(hidden_char(c), "{c:?}");
        }
        assert!(!hidden_char('é') && !hidden_char(' '));
    }

    #[test]
    fn the_clipboard_text_is_never_logged() {
        let question = crate::pc_extra::clipboard_question("hunter2 my password\nline 2");
        assert!(question.contains("hunter2"));
        let line = log_line(9, "Pixel", true, &question);
        assert!(!line.contains("hunter2") && !line.contains("line 2"), "{line}");
        assert_eq!(line, format!("9\tPixel\tallowed\t{CLIPBOARD_ASK} clipboard (26 characters, not logged)"));
        // Other questions are kept whole.
        assert_eq!(loggable("Open notes.md?"), "Open notes.md?");
        // Asked by a paired device: its name kept, the text never.
        let asked = crate::pc_extra::clipboard_question_for("hunter2\nline 2", Some("Pixel"));
        assert_eq!(
            loggable(&asked),
            format!("\u{201c}Pixel{CLIPBOARD_ASK_DEVICE} clipboard (14 characters, not logged)")
        );
        assert!(!answered_note("Pixel", true, &asked).contains("hunter2"));
        assert!(!answered_note("Laptop", true, &question).contains("hunter2"));
        // Another question naming a device is kept whole.
        let open = crate::pc::open_question("notes.md", Some("Pixel"));
        assert_eq!(loggable(&open), open);
    }

    #[test]
    fn the_log_is_rotated_past_its_size() {
        let dir = std::env::temp_dir().join(format!("pa-log-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("answers.log");
        std::fs::write(&file, "a".repeat(100)).unwrap();
        rotate(&file, 200);
        assert!(file.exists());
        std::fs::write(&file, "b".repeat(300)).unwrap();
        std::fs::write(dir.join("answers.log.1"), "old").unwrap();
        rotate(&file, 200);
        assert!(!file.exists());
        assert_eq!(std::fs::read_to_string(dir.join("answers.log.1")).unwrap(), "b".repeat(300));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn what_a_device_used_is_logged_on_one_line() {
        let line = use_line(7, "Pixel\n8", "read notes.md\n\u{202e}x");
        assert_eq!(line, "7\tPixel\\n8\tused\tread notes.md\\n\\u{202e}x");
        assert_eq!(line.lines().count(), 1);
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
        let (id, _rx) = q.open("x", None).unwrap();
        q.close(id);
        assert!(q.answer(id, true, "pk", "Pixel").is_err());
    }

    #[test]
    fn other_devices_never_get_the_private_parts_of_a_question() {
        let q = RemoteQuestions::default();
        q.set_allowed(true);
        // This PC's own model reads the clipboard: no device sees the text.
        let clip = crate::approval::with_thinking(&crate::pc_extra::clipboard_question("hunter2 secret"), Some("the user won't notice"));
        let (id, _rx) = q.open(&clip, None).unwrap();
        let seen = &q.list_for("pk")[0];
        assert!(seen.only_refuse);
        assert!(!seen.text.contains("hunter2") && !seen.text.contains("notice"), "{}", seen.text);
        assert!(seen.text.contains(&clipboard_hidden(14)), "{}", seen.text);
        assert!(seen.text.contains(crate::approval::THINKING_WARNING) && seen.text.ends_with(THINKING_HIDDEN));
        // A yes is refused (the question stays open), a no is taken.
        assert_eq!(q.answer(id, true, "pk", "Pixel"), Err(ONLY_REFUSE));
        assert_eq!(q.list_for("pk").len(), 1);
        assert!(q.answer(id, false, "pk", "Pixel").is_ok());

        // A device's own clipboard request: it sees it whole; others don't.
        let asked = crate::pc_extra::clipboard_question_for("hunter2", Some("Pixel"));
        let (id, _rx) = q.open(&asked, Some("pixel-key")).unwrap();
        let own = &q.list_for("pixel-key")[0];
        assert!(!own.only_refuse && own.text.contains("hunter2"));
        let other = &q.list_for("laptop-key")[0];
        assert!(other.only_refuse && !other.text.contains("hunter2"), "{}", other.text);
        assert!(other.text.starts_with("\u{201c}Pixel"), "{}", other.text);
        assert_eq!(q.answer(id, true, "laptop-key", "Laptop"), Err(ONLY_REFUSE));
        assert!(q.answer(id, true, "pixel-key", "Pixel").is_ok());

        // Nothing private: the same for every device, and any may allow.
        let (id, _rx) = q.open("Press Play / pause on this PC?", None).unwrap();
        assert!(!q.list_for("x")[0].only_refuse);
        assert!(q.answer(id, true, "x", "X").is_ok());
    }

    #[test]
    fn the_shared_view_leaves_out_changes_thinking_and_paths() {
        let write = format!("\u{201c}Pixel{WRITE_ASK_DEVICE}\nnotes.md: replace its text, 1 line out, 1 in\n\n{}\nBefore and after:\n- my bank pin 1234\n+ x", crate::approval::MODEL_SAYS);
        let shared = shared_view(&write).unwrap();
        assert!(!shared.contains("1234"), "{shared}");
        assert!(shared.contains("notes.md: replace") && shared.ends_with(CHANGE_HIDDEN), "{shared}");
        let run = crate::approval::with_thinking("Run this?\n\nGet-Content C:\\Users\\ann\\secret.txt", Some("plan"));
        let shared = shared_view(&run).unwrap();
        assert_eq!(shared, format!("Run this?\n\nGet-Content <path>\n\n{THINKING_HIDDEN}"));
        assert_eq!(shared_view("Open this page?\n\nhttps://example.org/a"), None);
        assert_eq!(hide_paths("x key=C:\\Users\\ann\\a.txt,y"), "x key=<path>,y");
        assert_eq!(hide_paths("(\"/home/ann/.ssh/id\") file:/etc/passwd"), "(\"<path>\") file:<path>");
        assert_eq!(hide_paths("\\\\server\\share\\a b"), "<path> b");
        assert_eq!(hide_paths("https://example.org/home/x 1:2"), "https://example.org/home/x 1:2");
    }
}
