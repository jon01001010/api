//! Writing in the PC's workspace for a paired device ("The phone uses the
//! PC's tools", stage 4; link.rs request "tool", WRITE_TOOLS): make or
//! replace a text file, add at its end, or undo the last change. Only the
//! files directly in the workspace folder, each by its name (the same
//! check as the reads, pc_files::check_name: never a folder, a path, `..`,
//! a hidden or system name), only text kinds that open in a viewer (the
//! screens' text list and the PC's own "openable" list, both: never a
//! program or a script), at most MAX_WRITE bytes, plain text only.
//!
//! Each change is asked natively on this PC every time (link.rs write_for,
//! approval::ask_for; never "always"), with a short before/after view built
//! here: a unified diff (`- ` before, `+ ` after), its head and tail when
//! long, saying how many lines are not shown and how long a cut line is.
//!
//! The previous version is kept as the screens' own file history keeps it
//! (fileHistory.ts: Documents/PocketAgentFileHistory/<name>/<ms>-<id>.txt,
//! the newest MAX_SNAPSHOTS), so the PC's own history and file_undo see
//! it too, and `workspace_undo` brings the newest one back.

// Used by link.rs only (the Windows type-check here builds without it).
#![cfg_attr(not(feature = "link"), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Most bytes a device may write into one file (the whole file after the
/// change; as much as a device may read).
pub const MAX_WRITE: usize = crate::pc_files::MAX_TEXT;
/// The screens' file history (fileHistory.ts HISTORY_ROOT), in the app's
/// data folder like the workspace (pc::WORKSPACE).
pub const HISTORY: &str = "Documents/PocketAgentFileHistory";
/// Versions kept per file (fileHistory.ts MAX_SNAPSHOTS).
pub const MAX_SNAPSHOTS: usize = 20;
/// Unchanged lines shown around each change (as lineDiff.ts).
const CONTEXT: usize = 2;
/// Past this, a change is shown as "all removed, all added" (lineDiff.ts).
const MAX_CELLS: usize = 4_000_000;
/// Lines of the before/after view shown from its start and from its end;
/// between them, how many are not shown. Kept short so a phone that may
/// answer can show the whole question (pcQuestions.ts MAX_SHOWN, MAX_LINES).
pub const VIEW_HEAD: usize = 10;
pub const VIEW_TAIL: usize = 6;
/// Characters of one line shown (the rest counted).
pub const VIEW_LINE: usize = 80;

pub const WRITE_KINDS: &str = "Only text files that open in a viewer are written from a device (.txt, .md, .csv, .json, .xml, .html, .log); never programs or scripts";

/// Whether a device may write this kind of file: one of the screens' text
/// kinds that the PC also opens in a viewer (never one that runs).
pub fn writable(name: &str) -> bool {
    crate::pc_files::text_kind(name) && crate::pc::openable(name)
}

/// Text a device may write: at most MAX_WRITE bytes, no control
/// characters but line breaks and tabs.
pub fn check_text(text: &str) -> Result<(), String> {
    if text.len() > MAX_WRITE {
        return Err(format!("The file would be larger than {} KB; it isn't written from a device", MAX_WRITE / 1024));
    }
    if text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')) {
        return Err("The text has control characters; only plain text is written".into());
    }
    Ok(())
}

/// Lines as lineDiff.ts splits them ("" has none; "\r\n" or "\n").
pub fn split_lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect()
}

/// Lines as a person counts them (a last line break starts no new line).
pub fn line_count(text: &str) -> usize {
    let lines = split_lines(text);
    lines.len() - usize::from(lines.last() == Some(&""))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Same,
    Removed,
    Added,
}

/// A line diff (lineDiff.ts diffOps): common start and end trimmed, then
/// the longest common run of lines; very large inputs fall back to "all
/// removed, all added" so the cost stays bounded.
pub fn diff<'a>(a: &[&'a str], b: &[&'a str]) -> Vec<(Op, &'a str)> {
    let mut start = 0;
    while start < a.len() && start < b.len() && a[start] == b[start] {
        start += 1;
    }
    let (mut end_a, mut end_b) = (a.len(), b.len());
    while end_a > start && end_b > start && a[end_a - 1] == b[end_b - 1] {
        end_a -= 1;
        end_b -= 1;
    }
    let mut ops: Vec<(Op, &str)> = a[..start].iter().map(|l| (Op::Same, *l)).collect();
    let (mid_a, mid_b) = (&a[start..end_a], &b[start..end_b]);
    let (n, m) = (mid_a.len(), mid_b.len());
    if (n + 1).saturating_mul(m + 1) > MAX_CELLS {
        ops.extend(mid_a.iter().map(|l| (Op::Removed, *l)));
        ops.extend(mid_b.iter().map(|l| (Op::Added, *l)));
    } else {
        // lcs[i][j]: the longest common run of mid_a[i..] and mid_b[j..].
        let w = m + 1;
        let mut lcs = vec![0u32; (n + 1) * w];
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                lcs[i * w + j] = if mid_a[i] == mid_b[j] {
                    lcs[(i + 1) * w + j + 1] + 1
                } else {
                    lcs[(i + 1) * w + j].max(lcs[i * w + j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < n || j < m {
            if i < n && j < m && mid_a[i] == mid_b[j] {
                ops.push((Op::Same, mid_a[i]));
                i += 1;
                j += 1;
            } else if i < n && (j == m || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
                // Removals before additions, as in a usual diff.
                ops.push((Op::Removed, mid_a[i]));
                i += 1;
            } else {
                ops.push((Op::Added, mid_b[j]));
                j += 1;
            }
        }
    }
    ops.extend(a[end_a..].iter().map(|l| (Op::Same, *l)));
    ops
}

/// One line of the view: hidden characters (controls, bidi, zero-width)
/// written as escapes so the dialog shows what is really there, cut at
/// VIEW_LINE characters saying how many more there are.
pub fn shown_line(mark: &str, line: &str) -> String {
    let mut out = String::from(mark);
    let mut shown = 0;
    let mut chars = line.chars();
    for c in chars.by_ref() {
        if shown == VIEW_LINE {
            let more = 1 + chars.count();
            out.push_str(&format!("… (+{more} characters)"));
            return out;
        }
        match c {
            '\t' => out.push_str("\\t"),
            c if crate::remote_ask::hidden_char(c) => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
        shown += 1;
    }
    out
}

/// The view's head and tail when it is longer than VIEW_HEAD + VIEW_TAIL
/// lines, with the count of lines left out between them (never cut
/// silently).
pub fn head_and_tail(mut lines: Vec<String>) -> Vec<String> {
    if lines.len() <= VIEW_HEAD + VIEW_TAIL {
        return lines;
    }
    let left_out = lines.len() - VIEW_HEAD - VIEW_TAIL;
    let tail = lines.split_off(lines.len() - VIEW_TAIL);
    lines.truncate(VIEW_HEAD);
    lines.push(format!("[… {left_out} more line{} of the change not shown here …]", if left_out == 1 { "" } else { "s" }));
    lines.extend(tail);
    lines
}

/// What changes, line by line.
#[derive(Debug, PartialEq)]
pub struct Change {
    pub added: usize,
    pub removed: usize,
    /// The before/after view (head and tail when long).
    pub view: Vec<String>,
}

/// The change from `before` (None: a new file) to `after`.
pub fn change(before: Option<&str>, after: &str) -> Change {
    let Some(before) = before else {
        let lines: Vec<String> = split_lines(after).iter().map(|l| shown_line("+ ", l)).collect();
        return Change { added: line_count(after), removed: 0, view: head_and_tail(lines) };
    };
    let ops = diff(&split_lines(before), &split_lines(after));
    let changed: Vec<bool> = ops.iter().map(|(op, _)| *op != Op::Same).collect();
    let near = |i: usize| (i.saturating_sub(CONTEXT)..=(i + CONTEXT).min(ops.len() - 1)).any(|k| changed[k]);
    let mut view = Vec::new();
    let mut skipped = false;
    for (i, (op, line)) in ops.iter().enumerate() {
        if !near(i) {
            skipped = true;
            continue;
        }
        if skipped {
            view.push("…".to_string());
        }
        skipped = false;
        let mark = match op {
            Op::Same => "  ",
            Op::Removed => "- ",
            Op::Added => "+ ",
        };
        view.push(shown_line(mark, line));
    }
    if skipped && !view.is_empty() {
        view.push("…".to_string());
    }
    Change {
        added: ops.iter().filter(|(op, _)| *op == Op::Added).count(),
        removed: ops.iter().filter(|(op, _)| *op == Op::Removed).count(),
        view: head_and_tail(view),
    }
}

// ---------------------------------------------------------------- history

/// The history folder of one file (the name already checked).
fn history_dir(history: &Path, name: &str) -> PathBuf {
    history.join(name)
}

/// When a snapshot was saved, from its name (`<ms>-<letters/digits>.txt`,
/// fileHistory.ts SNAPSHOT_NAME); None for anything else.
pub fn snapshot_time(id: &str) -> Option<u64> {
    let (ms, rest) = id.split_once('-')?;
    let tag = rest.strip_suffix(".txt")?;
    if ms.is_empty() || !ms.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if tag.is_empty() || !tag.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) {
        return None;
    }
    ms.parse().ok()
}

/// The versions kept of one file, newest first: (id, saved at, in ms).
pub fn snapshots(history: &Path, name: &str) -> Vec<(String, u64)> {
    let Ok(items) = std::fs::read_dir(history_dir(history, name)) else { return Vec::new() };
    let mut list: Vec<(String, u64)> = items
        .filter_map(|item| {
            let item = item.ok()?;
            let id = item.file_name().to_str()?.to_string();
            let at = snapshot_time(&id)?;
            crate::pc_files::plain_file(&item.path()).then_some((id, at))
        })
        .collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.0.cmp(&a.0)));
    list
}

static LAST_SAVED: AtomicU64 = AtomicU64::new(0);

/// Keeps `content` as the newest version of `name`; the oldest beyond
/// MAX_SNAPSHOTS go. Returns its id.
pub fn save_snapshot(history: &Path, name: &str, content: &str) -> Result<String, String> {
    let dir = history_dir(history, name);
    if let Ok(meta) = std::fs::symlink_metadata(&dir) {
        if !meta.is_dir() {
            return Err("The file's history on the PC is not a folder; nothing was written".into());
        }
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    // Strictly increasing, so "newest" is exact even within one ms.
    let at = LAST_SAVED
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |last| Some(now.max(last + 1)))
        .map(|last| now.max(last + 1))
        .unwrap_or(now);
    let mut tag = [0u8; 4];
    getrandom::fill(&mut tag).map_err(|e| e.to_string())?;
    let id = format!("{at}-{}.txt", tag.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let file = dir.join(&id);
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .and_then(|mut f| std::io::Write::write_all(&mut f, content.as_bytes()))
        .map_err(|e| e.to_string())?;
    for (old, _) in snapshots(history, name).into_iter().skip(MAX_SNAPSHOTS) {
        let _ = std::fs::remove_file(dir.join(old));
    }
    Ok(id)
}

// ---------------------------------------------------------------- writing

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WriteKind {
    /// Make the file, or replace all its text.
    Write,
    /// Add at the end of a file that exists.
    Append,
    /// Bring back the newest version kept.
    Undo,
}

/// A device's change, worked out before it is asked.
#[derive(Debug, PartialEq)]
pub struct Plan {
    pub file: String,
    pub kind: WriteKind,
    /// The text now (None: no such file yet).
    pub previous: Option<String>,
    pub next: String,
    pub change: Change,
}

impl Plan {
    pub fn unchanged(&self) -> bool {
        self.previous.as_deref() == Some(self.next.as_str())
    }
}

/// A workspace file's text now: None if there is none; an error for
/// anything a device must not change (not a plain file, too large, not
/// text).
fn current(path: &Path, name: &str) -> Result<Option<String>, String> {
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
        Ok(_) => {}
    }
    if !crate::pc_files::plain_file(path) {
        return Err(format!("{name} on the PC is not a plain file; it isn't changed from a device"));
    }
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_WRITE as u64 {
        return Err(format!("{name} on the PC is larger than {} KB; it isn't changed from a device", MAX_WRITE / 1024));
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| format!("{name} on the PC is not plain text; it isn't changed from a device"))
}

/// Works out a device's change (nothing is written): the name and kind
/// checked, the file now, the text after. `content`: the device's text
/// (write, append). Blocks: call it off the async runtime.
pub fn plan(workspace: &Path, history: &Path, file: &str, kind: WriteKind, content: &str) -> Result<Plan, String> {
    let file = crate::pc_files::check_name(file)?;
    if !writable(file) {
        return Err(WRITE_KINDS.into());
    }
    let previous = current(&workspace.join(file), file)?;
    let next = match kind {
        WriteKind::Write => content.to_string(),
        WriteKind::Append => {
            let before = previous
                .as_deref()
                .ok_or_else(|| format!("No workspace file named {file} on the PC; make it with pc_workspace_write"))?;
            format!("{before}{content}")
        }
        WriteKind::Undo => {
            if previous.is_none() {
                return Err(format!("No workspace file named {file} on the PC"));
            }
            let (id, _) = snapshots(history, file)
                .into_iter()
                .next()
                .ok_or_else(|| format!("No earlier version of {file} is kept on the PC"))?;
            let bytes = std::fs::read(history_dir(history, file).join(id)).map_err(|e| e.to_string())?;
            String::from_utf8(bytes).map_err(|_| "The earlier version is not plain text".to_string())?
        }
    };
    check_text(&next)?;
    let change = change(previous.as_deref(), &next);
    Ok(Plan { file: file.to_string(), kind, previous, next, change })
}

/// Writes an allowed change: refused if the file changed meanwhile; the
/// previous text kept in the history first; read back to check (put back
/// as it was if that fails). Blocks: call it off the async runtime.
pub fn apply(workspace: &Path, history: &Path, plan: &Plan) -> Result<(), String> {
    let path = workspace.join(&plan.file);
    if current(&path, &plan.file)? != plan.previous {
        return Err(format!(
            "{} changed on the PC while the question was open; nothing was written. Read it again and retry.",
            plan.file
        ));
    }
    if let Some(previous) = &plan.previous {
        save_snapshot(history, &plan.file, previous)?;
    }
    let written = match &plan.previous {
        // A new file: never over something that appeared meanwhile.
        None => std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, plan.next.as_bytes())),
        Some(_) => std::fs::write(&path, plan.next.as_bytes()),
    }
    .map_err(|e| e.to_string())
    .and_then(|_| match std::fs::read(&path) {
        Ok(back) if back == plan.next.as_bytes() => Ok(()),
        _ => Err("The file could not be checked after writing".to_string()),
    });
    if let Err(error) = written {
        match &plan.previous {
            Some(previous) => {
                let _ = std::fs::write(&path, previous.as_bytes());
            }
            None => {
                if crate::pc_files::plain_file(&path) {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        return Err(error);
    }
    Ok(())
}

/// "+3 −1 lines".
fn counts(change: &Change) -> String {
    format!("+{} \u{2212}{} lines", change.added, change.removed)
}

/// The line that says what changes (the question's second line, and what
/// the answers log keeps of it).
pub fn summary(plan: &Plan) -> String {
    let file = &plan.file;
    match (plan.kind, &plan.previous) {
        (WriteKind::Write, None) => {
            let n = plan.change.added;
            format!("{file}: a new file, {n} line{}", if n == 1 { "" } else { "s" })
        }
        (WriteKind::Write, Some(_)) => format!(
            "{file}: replace its text, {} (the earlier version is kept; undo brings it back)",
            counts(&plan.change)
        ),
        (WriteKind::Append, _) => format!(
            "{file}: add at the end, {} (the earlier version is kept; undo brings it back)",
            counts(&plan.change)
        ),
        (WriteKind::Undo, _) => format!(
            "{file}: undo, back to the last version kept, {} (the current text is kept too)",
            counts(&plan.change)
        ),
    }
}

/// The native "Allow?" for a device's change: who asks (first line, fixed
/// text the answers log knows: remote_ask::WRITE_ASK_DEVICE), what changes
/// (second line), then the before/after view.
pub fn question(device: &str, plan: &Plan) -> String {
    let heading = if plan.previous.is_none() {
        "The new text (+ lines):"
    } else {
        "Before and after (- before, + after):"
    };
    format!(
        "\u{201c}{device}{}\n{}\n\n{heading}\n{}",
        crate::remote_ask::WRITE_ASK_DEVICE,
        summary(plan),
        plan.change.view.join("\n")
    )
}

/// What the PC user is told, and the answers log keeps, after a device's
/// change: the device, the file and the line counts (never the text).
pub fn note(device: &str, plan: &Plan) -> String {
    let file = &plan.file;
    match (plan.kind, &plan.previous) {
        (WriteKind::Write, None) => format!("{device} made {file} in this PC's workspace ({} lines)", plan.change.added),
        (WriteKind::Write, Some(_)) => format!("{device} changed {file} in this PC's workspace ({})", counts(&plan.change)),
        (WriteKind::Append, _) => format!("{device} added to {file} in this PC's workspace ({})", counts(&plan.change)),
        (WriteKind::Undo, _) => {
            format!("{device} undid the last change to {file} in this PC's workspace ({})", counts(&plan.change))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(tag: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("pc-write-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (ws, hist) = (root.join("ws"), root.join("hist"));
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::create_dir_all(&hist).unwrap();
        (ws, hist)
    }

    #[test]
    fn only_text_kinds_that_open_in_a_viewer_are_written() {
        for ok in ["a.txt", "a.md", "A.MD", "a.csv", "a.json", "a.xml", "a.html", "a.log"] {
            assert!(writable(ok), "{ok}");
        }
        for bad in ["a.js", "a.ts", "a.py", "a.sh", "a.sql", "a.exe", "a.bat", "a.ps1", "a.docx", "a.pdf", "a.png", "noext", "a.lnk"] {
            assert!(!writable(bad), "{bad}");
        }
    }

    #[test]
    fn only_plain_text_within_the_cap() {
        assert!(check_text("a\n\tb\r\n").is_ok());
        assert!(check_text(&"x".repeat(MAX_WRITE)).is_ok());
        assert!(check_text(&"x".repeat(MAX_WRITE + 1)).is_err());
        for bad in ["a\u{0}b", "a\u{1b}[2Jb", "a\u{7f}"] {
            assert!(check_text(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn the_diff_matches_the_screens_one() {
        let c = change(Some("a\nb\nc\nd\ne\nf\ng\nh\n"), "a\nb\nc\nD\ne\nf\ng\nh\n");
        assert_eq!((c.added, c.removed), (1, 1));
        assert_eq!(c.view, ["…", "  b", "  c", "- d", "+ D", "  e", "  f", "…"]);
        let c = change(Some("one\n"), "one\ntwo\n");
        assert_eq!((c.added, c.removed), (1, 0));
        assert_eq!(c.view, ["  one", "+ two", "  "]);
        let c = change(Some("x"), "x");
        assert_eq!((c.added, c.removed, c.view.len()), (0, 0, 0));
        // Windows line ends count as the same lines.
        assert_eq!(change(Some("a\r\nb\r\n"), "a\nb\n").added, 0);
    }

    #[test]
    fn a_new_file_says_how_many_lines() {
        let c = change(None, "one\ntwo\n");
        assert_eq!((c.added, c.removed), (2, 0));
        assert_eq!(c.view, ["+ one", "+ two", "+ "]);
        assert_eq!(change(None, "").added, 0);
    }

    #[test]
    fn a_long_change_shows_its_head_and_tail_with_counts() {
        let after: String = (1..=100).map(|i| format!("line {i}\n")).collect();
        let c = change(None, &after);
        assert_eq!(c.added, 100);
        assert_eq!(c.view.len(), VIEW_HEAD + VIEW_TAIL + 1);
        assert_eq!(c.view[0], "+ line 1");
        assert_eq!(c.view[VIEW_HEAD], "[… 85 more lines of the change not shown here …]");
        assert_eq!(c.view.last().unwrap(), "+ ");
        assert_eq!(c.view[c.view.len() - 2], "+ line 100");
        // A long line is cut, saying how much more there is.
        let line = shown_line("+ ", &"é".repeat(VIEW_LINE + 5));
        assert_eq!(line, format!("+ {}… (+5 characters)", "é".repeat(VIEW_LINE)));
        assert_eq!(shown_line("  ", &"a".repeat(VIEW_LINE)), format!("  {}", "a".repeat(VIEW_LINE)));
        // Hidden characters are shown as escapes, never as themselves.
        assert_eq!(shown_line("+ ", "a\u{202e}b\tc\u{200b}"), "+ a\\u{202e}b\\tc\\u{200b}");
        // Short enough for a phone to show whole (pcQuestions.ts: 2000
        // characters, 40 lines), whatever the text.
        let wide: String = (0..400).map(|_| format!("{}\n", "w".repeat(500))).collect();
        let p = Plan { file: "a.md".into(), kind: WriteKind::Write, previous: Some("x".into()), next: wide.clone(), change: change(Some("x"), &wide) };
        let q = question("Pixel 8", &p);
        assert!(q.chars().count() <= 2000, "{}", q.chars().count());
        assert!(q.lines().count() <= 40);
        assert!(q.contains("more lines of the change not shown here"));
    }

    #[test]
    fn the_question_names_the_device_and_the_change() {
        let (ws, hist) = dirs("question");
        let p = plan(&ws, &hist, "notes.md", WriteKind::Write, "hello\nworld\n").unwrap();
        let q = question("Pixel 8", &p);
        assert!(q.starts_with("\u{201c}Pixel 8\u{201d} asks to change a file in your workspace on this PC:\nnotes.md: a new file, 2 lines\n"), "{q}");
        assert!(q.contains("+ hello\n+ world"));
        assert_eq!(note("Pixel 8", &p), "Pixel 8 made notes.md in this PC's workspace (2 lines)");
        // The answers log and the "answered on a device" note keep who and
        // what, never the text.
        let logged = crate::remote_ask::loggable(&q);
        assert!(!logged.contains("hello") && logged.contains("notes.md: a new file, 2 lines"), "{logged}");
        assert!(!crate::remote_ask::answered_note("Pixel 8", true, &q).contains("hello"));
        apply(&ws, &hist, &p).unwrap();
        let p = plan(&ws, &hist, "notes.md", WriteKind::Append, "again\n").unwrap();
        assert!(summary(&p).starts_with("notes.md: add at the end, +1 \u{2212}0 lines"), "{}", summary(&p));
        assert_eq!(note("Pixel 8", &p), "Pixel 8 added to notes.md in this PC's workspace (+1 \u{2212}0 lines)");
        let _ = std::fs::remove_dir_all(ws.parent().unwrap());
    }

    #[test]
    fn each_change_keeps_the_version_before_and_undo_brings_it_back() {
        let (ws, hist) = dirs("history");
        // New file: nothing to keep yet; undo has nothing to go back to.
        let p = plan(&ws, &hist, "notes.md", WriteKind::Write, "one\n").unwrap();
        apply(&ws, &hist, &p).unwrap();
        assert_eq!(std::fs::read_to_string(ws.join("notes.md")).unwrap(), "one\n");
        assert!(snapshots(&hist, "notes.md").is_empty());
        assert!(plan(&ws, &hist, "notes.md", WriteKind::Undo, "").is_err());
        // Replace: the old text is kept.
        let p = plan(&ws, &hist, "notes.md", WriteKind::Write, "two\n").unwrap();
        assert_eq!((p.change.added, p.change.removed), (1, 1));
        apply(&ws, &hist, &p).unwrap();
        let kept = snapshots(&hist, "notes.md");
        assert_eq!(kept.len(), 1);
        assert_eq!(std::fs::read_to_string(hist.join("notes.md").join(&kept[0].0)).unwrap(), "one\n");
        // Append: kept too.
        let p = plan(&ws, &hist, "notes.md", WriteKind::Append, "three\n").unwrap();
        apply(&ws, &hist, &p).unwrap();
        assert_eq!(std::fs::read_to_string(ws.join("notes.md")).unwrap(), "two\nthree\n");
        assert_eq!(snapshots(&hist, "notes.md").len(), 2);
        // Undo: back to the newest kept version, the current one kept too.
        let p = plan(&ws, &hist, "notes.md", WriteKind::Undo, "").unwrap();
        assert_eq!(p.next, "two\n");
        assert!(question("Pixel", &p).contains("- three"));
        apply(&ws, &hist, &p).unwrap();
        assert_eq!(std::fs::read_to_string(ws.join("notes.md")).unwrap(), "two\n");
        assert_eq!(snapshots(&hist, "notes.md").len(), 3);
        // Nothing changes: said so (link.rs asks nothing then).
        assert!(plan(&ws, &hist, "notes.md", WriteKind::Write, "two\n").unwrap().unchanged());
        // The newest MAX_SNAPSHOTS are kept, names as the screens' history.
        for i in 0..MAX_SNAPSHOTS + 3 {
            save_snapshot(&hist, "notes.md", &format!("v{i}")).unwrap();
        }
        let kept = snapshots(&hist, "notes.md");
        assert_eq!(kept.len(), MAX_SNAPSHOTS);
        assert!(kept.iter().all(|(id, at)| snapshot_time(id) == Some(*at)));
        assert_eq!(
            std::fs::read_to_string(hist.join("notes.md").join(&kept[0].0)).unwrap(),
            format!("v{}", MAX_SNAPSHOTS + 2)
        );
        let _ = std::fs::remove_dir_all(ws.parent().unwrap());
    }

    #[test]
    fn snapshot_names_follow_the_screens_rule() {
        assert_eq!(snapshot_time("1763200000000-ab12cd.txt"), Some(1_763_200_000_000));
        for bad in ["x-ab.txt", "1-AB.txt", "1-ab.md", "1-.txt", "-ab.txt", "1-a/b.txt", "1ab.txt"] {
            assert_eq!(snapshot_time(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_change_is_refused_when_the_file_changed_meanwhile_or_is_not_text() {
        let (ws, hist) = dirs("refused");
        std::fs::write(ws.join("a.txt"), "first").unwrap();
        let p = plan(&ws, &hist, "a.txt", WriteKind::Write, "mine").unwrap();
        std::fs::write(ws.join("a.txt"), "someone else's").unwrap();
        assert!(apply(&ws, &hist, &p).unwrap_err().contains("changed on the PC while the question was open"));
        assert_eq!(std::fs::read_to_string(ws.join("a.txt")).unwrap(), "someone else's");
        // A new file that appeared meanwhile is not written over.
        let p = plan(&ws, &hist, "b.txt", WriteKind::Write, "mine").unwrap();
        std::fs::write(ws.join("b.txt"), "theirs").unwrap();
        assert!(apply(&ws, &hist, &p).is_err());
        assert_eq!(std::fs::read_to_string(ws.join("b.txt")).unwrap(), "theirs");
        // Not text, too large, a folder: never changed.
        std::fs::write(ws.join("bin.txt"), [0xff, 0xfe, 0]).unwrap();
        assert!(plan(&ws, &hist, "bin.txt", WriteKind::Write, "x").is_err());
        std::fs::write(ws.join("big.txt"), "x".repeat(MAX_WRITE + 1)).unwrap();
        assert!(plan(&ws, &hist, "big.txt", WriteKind::Write, "x").is_err());
        std::fs::create_dir_all(ws.join("dir.txt")).unwrap();
        assert!(plan(&ws, &hist, "dir.txt", WriteKind::Write, "x").is_err());
        // Appending makes nothing new; too much in all is refused.
        assert!(plan(&ws, &hist, "none.txt", WriteKind::Append, "x").is_err());
        std::fs::write(ws.join("full.txt"), "x".repeat(MAX_WRITE)).unwrap();
        assert!(plan(&ws, &hist, "full.txt", WriteKind::Append, "y").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(ws.join("a.txt"), ws.join("link.txt")).unwrap();
            assert!(plan(&ws, &hist, "link.txt", WriteKind::Write, "x").is_err());
        }
        let _ = std::fs::remove_dir_all(ws.parent().unwrap());
    }

    #[test]
    fn names_are_checked_as_for_reads() {
        let (ws, hist) = dirs("names");
        for bad in ["../x.txt", "..", "a/b.txt", "a\\b.txt", "C:/x.txt", "/etc/x.txt", ".env.txt", "desktop.ini", "CON.txt", "run.js", "x.bat"] {
            assert!(plan(&ws, &hist, bad, WriteKind::Write, "x").is_err(), "{bad}");
        }
        assert!(std::fs::read_dir(&ws).unwrap().next().is_none());
        let _ = std::fs::remove_dir_all(ws.parent().unwrap());
    }
}
