//! The PC's workspace, read only, for a paired device ("The phone uses the
//! PC's tools", stage 1; link.rs request "tool"). Only the files directly in
//! the workspace folder (Documents/PocketAgentFiles in the app's folder),
//! each by its name: never a folder, a path, `..`, a hidden or system file,
//! or a link to somewhere else. Text files and documents only (documents as
//! text through docs.rs, the PC's own reader), at most MAX_TEXT of text.
//!
//! The name goes through the same check as the PC's own file tools
//! (pc::workspace_file, used by open and print) and, before it, the same
//! rule the screens use for workspace names (fileWorkspace.ts
//! `safeWorkspaceName`), plus hidden and system names refused.

// Used by link.rs only (the Windows type-check here builds without it).
#![cfg_attr(not(feature = "link"), allow(dead_code))]

use std::path::Path;

use serde::Serialize;

/// Most text sent back for one file (cut beyond, with a note).
pub const MAX_TEXT: usize = 256 * 1024;
/// Most files listed (the rest are counted).
pub const MAX_LISTED: usize = 500;
/// Longest name (as in fileWorkspace.ts).
const MAX_NAME: usize = 120;

/// Text files read as they are (the screens' own list, fileWorkspace.ts).
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "json", "csv", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "java", "kt",
    "log", "yaml", "yml", "sh", "sql",
];

/// Names Windows keeps for devices, and the files it and other systems
/// hide in folders: never listed or read.
const SYSTEM_NAMES: &[&str] = &["desktop.ini", "thumbs.db", "ehthumbs.db"];
const DEVICE_NAMES: &[&str] = &["con", "prn", "aux", "nul", "conin$", "conout$"];

/// A workspace file name a device may name: one plain name (letters,
/// digits, `.`, `_`, `-`, spaces; starting with a letter or digit, so
/// never hidden), no `..`, no folder, no system or device name.
pub fn check_name(name: &str) -> Result<&str, String> {
    const BAD: &str = "Use the name of a file in the PC's workspace (no folders or paths)";
    if name.is_empty()
        || name.chars().count() > MAX_NAME
        || name != name.trim()
        || name.ends_with('.')
        || name.contains("..")
    {
        return Err(BAD.into());
    }
    let mut chars = name.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphanumeric()) {
        return Err(BAD.into());
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || "._ -".contains(c)) {
        return Err(BAD.into());
    }
    let lower = name.to_ascii_lowercase();
    let stem = lower.split('.').next().unwrap_or("");
    let numbered = |prefix: &str| {
        stem.len() == prefix.len() + 1
            && stem.starts_with(prefix)
            && stem.as_bytes()[prefix.len()].is_ascii_digit()
    };
    if SYSTEM_NAMES.contains(&lower.as_str()) || DEVICE_NAMES.contains(&stem) || numbered("com") || numbered("lpt") {
        return Err("That is a system file; it is never read from a device".into());
    }
    Ok(name)
}

/// Whether the file may be read: text or a document DesktopAgent reads.
pub fn readable(name: &str) -> bool {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    TEXT_EXTENSIONS.contains(&ext.as_str()) || crate::docs::kind_of(name).is_some()
}

/// A plain file of its own: not a folder, not a link to somewhere else,
/// not hidden or a system file (Windows' attributes).
fn plain_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return false };
    if !meta.file_type().is_file() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_REPARSE_POINT
        if meta.file_attributes() & (0x2 | 0x4 | 0x400) != 0 {
            return false;
        }
    }
    true
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    pub name: String,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub files: Vec<Listed>,
    /// Files left out beyond MAX_LISTED.
    pub more: usize,
}

/// The files directly in the workspace folder that a device may name
/// (folders, links, hidden and system files left out), by name.
pub fn list(dir: &Path) -> Result<Listing, String> {
    let mut files = Vec::new();
    for item in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let Ok(item) = item else { continue };
        let Some(name) = item.file_name().to_str().map(String::from) else { continue };
        let path = item.path();
        if check_name(&name).is_err() || !plain_file(&path) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        files.push(Listed { name, size: meta.len(), modified_ms });
    }
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let more = files.len().saturating_sub(MAX_LISTED);
    files.truncate(MAX_LISTED);
    Ok(Listing { files, more })
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadFile {
    pub name: String,
    pub text: String,
    /// True when the text was cut at MAX_TEXT.
    pub cut: bool,
}

/// Cuts text at MAX_TEXT bytes (on a character boundary).
fn capped(mut text: String) -> (String, bool) {
    if text.len() <= MAX_TEXT {
        return (text, false);
    }
    let mut end = MAX_TEXT;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    (text, true)
}

/// One workspace file's text. `path` comes from pc::workspace_file (the
/// name already checked with check_name). Blocks: call it off the async
/// runtime.
pub fn read(path: &Path, name: &str) -> Result<ReadFile, String> {
    if !plain_file(path) {
        return Err(format!("No workspace file named {name}"));
    }
    if !readable(name) {
        return Err("Only text files and documents (Word, Excel, PowerPoint, OpenDocument, PDF) are read".into());
    }
    let text = if crate::docs::kind_of(name).is_some() {
        crate::docs::read_document(path)?
    } else {
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(MAX_TEXT as u64 + 4)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let longer = bytes.len() > MAX_TEXT;
        match String::from_utf8(bytes) {
            Ok(text) => text,
            // Cut inside a character at the end: keep what is whole.
            Err(e) if longer && e.utf8_error().error_len().is_none() => {
                let valid = e.utf8_error().valid_up_to();
                let mut bytes = e.into_bytes();
                bytes.truncate(valid);
                String::from_utf8(bytes).map_err(|_| "The file is not text".to_string())?
            }
            Err(_) => return Err("The file is not text".into()),
        }
    };
    let (text, cut) = capped(text);
    Ok(ReadFile { name: name.to_string(), text, cut })
}

/// Said to a device that asks for a PDF (security review 2): the PDF
/// reader can crash on a damaged file, and a crash would stop the app.
pub const NO_PDF_FOR_DEVICES: &str = "PDFs in the PC's workspace aren't read for paired devices yet (a damaged PDF could stop DesktopAgent). Open it on the PC, or save it as text or a Word document there.";

/// Most time one device read may take (a slow document is then refused).
pub const DEVICE_READ_TIME: std::time::Duration = std::time::Duration::from_secs(30);
/// Stack for a device's document read (deeply nested documents).
const DEVICE_READ_STACK: usize = 64 * 1024 * 1024;

static DEVICE_READING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// `read`, for a paired device: no PDFs (NO_PDF_FOR_DEVICES), one read at
/// a time, in its own thread with a large stack, and at most `limit`: a
/// read still going then is left to finish on its own (it holds the one
/// slot until it does) and the device is told.
pub fn read_for_device(path: &Path, name: &str, limit: std::time::Duration) -> Result<ReadFile, String> {
    use std::sync::atomic::Ordering;
    if crate::docs::kind_of(name) == Some("pdf") {
        return Err(NO_PDF_FOR_DEVICES.into());
    }
    if DEVICE_READING.swap(true, Ordering::SeqCst) {
        return Err("The PC is still reading another file for a device; try again in a moment".into());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let (path, owned) = (path.to_path_buf(), name.to_string());
    let started = std::thread::Builder::new()
        .name("device-read".into())
        .stack_size(DEVICE_READ_STACK)
        .spawn(move || {
            let read = std::panic::catch_unwind(|| read(&path, &owned))
                .unwrap_or_else(|_| Err("The file could not be read".into()));
            DEVICE_READING.store(false, Ordering::SeqCst);
            let _ = tx.send(read);
        });
    if started.is_err() {
        DEVICE_READING.store(false, Ordering::SeqCst);
        return Err("The file could not be read".into());
    }
    rx.recv_timeout(limit)
        .unwrap_or_else(|_| Err(format!("Reading {name} took too long; it was not sent")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn devices_get_no_pdf_and_a_time_limit() {
        let dir = std::env::temp_dir().join(format!("pa-devread-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pdf = dir.join("report.pdf");
        std::fs::write(&pdf, b"%PDF-1.4 hostile").unwrap();
        assert_eq!(read_for_device(&pdf, "report.pdf", DEVICE_READ_TIME).unwrap_err(), NO_PDF_FOR_DEVICES);
        assert_eq!(read_for_device(&pdf, "REPORT.PDF", DEVICE_READ_TIME).unwrap_err(), NO_PDF_FOR_DEVICES);
        let notes = dir.join("notes.md");
        std::fs::write(&notes, "hello").unwrap();
        assert_eq!(read_for_device(&notes, "notes.md", DEVICE_READ_TIME).unwrap().text, "hello");
        // A damaged document is an error, not a crash.
        let doc = dir.join("bad.docx");
        std::fs::write(&doc, b"not a zip").unwrap();
        assert!(read_for_device(&doc, "bad.docx", DEVICE_READ_TIME).is_err());
        // The slot is free again after each read.
        assert_eq!(read_for_device(&notes, "notes.md", DEVICE_READ_TIME).unwrap().text, "hello");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_plain_workspace_names_pass() {
        for ok in ["notes.md", "budget 2026.xlsx", "a", "Report_v2-final.docx", "x.y.txt"] {
            assert_eq!(check_name(ok), Ok(ok), "{ok}");
        }
        for bad in [
            "",
            "../secret.txt",
            "..",
            "a..b.txt",
            "sub/notes.md",
            "sub\\notes.md",
            "C:notes.md",
            "C:/Windows/win.ini",
            "/etc/passwd",
            ".hidden",
            ".env",
            " notes.md",
            "notes.md ",
            "notes.",
            "-rf",
            "a\u{0}b",
            "a\nb.txt",
            "caf\u{e9}.txt",
            "a\u{202e}txt.md",
            "~notes.md",
        ] {
            assert!(check_name(bad).is_err(), "{bad:?}");
        }
        assert!(check_name(&"a".repeat(121)).is_err());
        assert!(check_name(&"a".repeat(120)).is_ok());
    }

    #[test]
    fn system_and_device_names_are_refused() {
        for bad in ["desktop.ini", "Thumbs.db", "CON", "con.txt", "nul.md", "COM1", "lpt9.txt", "AUX.json"] {
            assert!(check_name(bad).is_err(), "{bad}");
        }
        for ok in ["console.txt", "com.txt", "com10.txt", "lpt.md", "control.md"] {
            assert!(check_name(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn only_text_and_documents_are_read() {
        for ok in ["a.txt", "a.MD", "a.csv", "a.json", "a.docx", "a.xlsx", "a.pdf", "a.odt"] {
            assert!(readable(ok), "{ok}");
        }
        for bad in ["a.exe", "a.png", "a.zip", "a.db", "noext", "a.lnk"] {
            assert!(!readable(bad), "{bad}");
        }
    }

    fn dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("pc-files-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn the_list_shows_plain_files_only() {
        let d = dir("list");
        std::fs::write(d.join("b.txt"), "bb").unwrap();
        std::fs::write(d.join("A.md"), "a").unwrap();
        std::fs::write(d.join(".secret"), "x").unwrap();
        std::fs::write(d.join("desktop.ini"), "x").unwrap();
        std::fs::create_dir_all(d.join("images")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/hostname", d.join("link.txt")).unwrap();
        let listing = list(&d).unwrap();
        let names: Vec<_> = listing.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["A.md", "b.txt"]);
        assert_eq!(listing.files[1].size, 2);
        assert_eq!(listing.more, 0);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn reads_are_text_capped_and_never_follow_links() {
        let d = dir("read");
        std::fs::write(d.join("a.txt"), "hello").unwrap();
        assert_eq!(
            read(&d.join("a.txt"), "a.txt").unwrap(),
            ReadFile { name: "a.txt".into(), text: "hello".into(), cut: false }
        );
        // Longer than the cap: cut, on a whole character.
        let long = format!("{}é{}", "x".repeat(MAX_TEXT - 1), "y".repeat(100));
        std::fs::write(d.join("long.txt"), &long).unwrap();
        let got = read(&d.join("long.txt"), "long.txt").unwrap();
        assert!(got.cut);
        assert_eq!(got.text, "x".repeat(MAX_TEXT - 1));
        // Not text, not a readable kind, a folder: refused.
        std::fs::write(d.join("bin.txt"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(read(&d.join("bin.txt"), "bin.txt").is_err());
        std::fs::write(d.join("x.exe"), "MZ").unwrap();
        assert!(read(&d.join("x.exe"), "x.exe").is_err());
        std::fs::create_dir_all(d.join("dir.txt")).unwrap();
        assert!(read(&d.join("dir.txt"), "dir.txt").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(d.join("a.txt"), d.join("link.txt")).unwrap();
            assert!(read(&d.join("link.txt"), "link.txt").is_err());
        }
        std::fs::remove_dir_all(&d).unwrap();
    }
}
