//! Files outside the workspace (owner decision 2026-11-15, SECURITY.md
//! rule 6): the model's file tools work in its workspace; to reach outside
//! it names a place (`downloads`, `documents`, `desktop`, `pictures`,
//! `music`, `videos`, `home`) and a path under it, or an absolute path, and
//! every single access asks on this PC (never "always", never answered from
//! a device), showing the facts first: the full resolved path, read / list
//! / write / delete, the size, and for a write a short before/after. What
//! the model says comes after them, under "The model says:".
//!
//! The model is treated as possibly hostile (prompt-injected or
//! misbehaving):
//! - A path is resolved before anything is decided: links, junctions, `..`
//!   and short (8.3) names. UNC and device paths (`\\server`, `\\?\`,
//!   `\\.\`), alternate data streams (`:` in a name), device names and
//!   anything that doesn't resolve cleanly are refused.
//! - Some places are never reachable, even with Allow (`Guard`), checked on
//!   the resolved path: startup folders and scheduled tasks, system
//!   folders, keys and passwords (.ssh, .gnupg, .aws, gh, browser profiles
//!   and their password and cookie files), shell start files, and the
//!   app's own settings, data and keys.
//! - Every access, allowed or refused, is logged (path, action, outcome;
//!   never contents) next to the answers log (remote_ask::log_outside).
//! - Paired devices never come here (link.rs keeps its own workspace-only
//!   tool lists).

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Said when a place is on the deny list (after resolving).
pub const NEVER: &str = "That place is never reachable from the model.";
pub const SAID_NO: &str = "The user said no. Nothing was done.";
/// The places the model may name.
pub const PLACES: &[&str] = &["downloads", "documents", "desktop", "pictures", "music", "videos", "home"];
/// Most names listed from one folder (the rest are counted).
pub const MAX_LISTED: usize = 500;
/// Longest path accepted.
const MAX_PATH: usize = 1024;
/// Largest file deleted (a copy is kept first).
const MAX_DELETE: u64 = 32 * 1024 * 1024;
/// Copies kept of replaced or deleted files (newest first).
const MAX_KEPT: usize = 50;

/// How paths are written: Windows (`C:\…`, any case) or Linux (`/…`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Style {
    Windows,
    Unix,
}

impl Style {
    pub const HERE: Style = if cfg!(windows) { Style::Windows } else { Style::Unix };

    /// For comparing: `/` between parts, lower case on Windows, no
    /// separator at the end.
    pub fn key(self, path: &str) -> String {
        let p = match self {
            Style::Windows => path.replace('\\', "/").to_lowercase(),
            Style::Unix => path.to_string(),
        };
        let t = p.trim_end_matches('/');
        if t.is_empty() { "/".into() } else { t.to_string() }
    }

    fn sep(self) -> char {
        match self {
            Style::Windows => '\\',
            Style::Unix => '/',
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    List,
    Read,
    Write,
    Delete,
}

impl Action {
    pub fn parse(word: &str) -> Result<Action, String> {
        match word {
            "list" => Ok(Action::List),
            "read" => Ok(Action::Read),
            "write" => Ok(Action::Write),
            "delete" => Ok(Action::Delete),
            _ => Err("`action` must be list, read, write or delete".into()),
        }
    }

    pub fn word(self) -> &'static str {
        match self {
            Action::List => "list",
            Action::Read => "read",
            Action::Write => "write",
            Action::Delete => "delete",
        }
    }
}

const DEVICE_NAMES: &[&str] = &["con", "prn", "aux", "nul", "conin$", "conout$", "clock$"];

/// One part of a path (between separators).
fn check_part(part: &str, style: Style) -> Result<(), String> {
    if part == ".." {
        return Err("`..` is not allowed in a path".into());
    }
    if style == Style::Windows {
        if part.contains(':') {
            return Err("A name with `:` (an alternate data stream) is refused".into());
        }
        if part.contains(['<', '>', '"', '|', '?', '*']) {
            return Err("A name with < > \" | ? * is refused".into());
        }
        if part.ends_with('.') || part.ends_with(' ') {
            return Err("A name ending in a dot or a space is refused (Windows would drop it)".into());
        }
        let mut chars = part.chars();
        while chars.by_ref().any(|c| c == '~') {
            if chars.clone().next().is_some_and(|c| c.is_ascii_digit()) {
                return Err("Short (8.3) names such as PROGRA~1 are refused; use the full name".into());
            }
        }
        let lower = part.to_ascii_lowercase();
        let stem = lower.split('.').next().unwrap_or("");
        let numbered = |p: &str| {
            stem.len() == p.len() + 1 && stem.starts_with(p) && stem.as_bytes()[p.len()].is_ascii_digit()
        };
        if DEVICE_NAMES.contains(&stem) || numbered("com") || numbered("lpt") {
            return Err("Device names (CON, NUL, COM1, …) are refused".into());
        }
    }
    Ok(())
}

/// Text every path must pass: not empty, not too long, no hidden
/// characters (controls, bidi, zero-width) that could make the question
/// show something other than what is used.
fn check_text(path: &str) -> Result<(), String> {
    if path.trim().is_empty() || path.chars().count() > MAX_PATH {
        return Err(format!("The path must be 1-{MAX_PATH} characters"));
    }
    if path.chars().any(crate::remote_ask::hidden_char) {
        return Err("The path has control or invisible characters".into());
    }
    Ok(())
}

/// An absolute path in this style, tidied (`.` and doubled separators
/// gone, Windows' drive letter in capitals). UNC and device paths, `..`,
/// a relative or drive-relative path, and names Windows treats specially
/// are refused.
pub fn check_absolute(input: &str, style: Style) -> Result<String, String> {
    check_text(input)?;
    match style {
        Style::Windows => {
            let p = input.replace('/', "\\");
            if p.starts_with("\\\\") {
                return Err("Network (UNC) and device paths (\\\\?\\, \\\\.\\) are refused".into());
            }
            let b = p.as_bytes();
            if !(b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\') {
                return Err(format!("Give a full path such as C:\\Users\\you\\Downloads\\file.txt, or a place: {input}"));
            }
            let mut out = format!("{}:", (b[0] as char).to_ascii_uppercase());
            for part in p[3..].split('\\').filter(|s| !s.is_empty() && *s != ".") {
                check_part(part, style)?;
                out.push('\\');
                out.push_str(part);
            }
            if out.len() == 2 {
                out.push('\\');
            }
            Ok(out)
        }
        Style::Unix => {
            if !input.starts_with('/') {
                return Err(format!("Give a full path such as /home/you/Downloads/file.txt, or a place: {input}"));
            }
            let mut out = String::new();
            for part in input.split('/').filter(|s| !s.is_empty() && *s != ".") {
                check_part(part, style)?;
                out.push('/');
                out.push_str(part);
            }
            if out.is_empty() {
                out.push('/');
            }
            Ok(out)
        }
    }
}

/// A path under a place: relative (no root, no drive), no `..`; empty is
/// the place itself. Its parts.
pub fn check_relative(rel: &str, style: Style) -> Result<Vec<String>, String> {
    if rel.trim().is_empty() {
        return Ok(Vec::new());
    }
    check_text(rel)?;
    let parts: Vec<&str> = match style {
        Style::Windows => {
            if rel.starts_with(['\\', '/']) || rel.contains(':') {
                return Err("The path under a place must be relative, e.g. reports\\may.txt".into());
            }
            rel.split(['\\', '/']).collect()
        }
        Style::Unix => {
            if rel.starts_with('/') {
                return Err("The path under a place must be relative, e.g. reports/may.txt".into());
            }
            rel.split('/').collect()
        }
    };
    let mut out = Vec::new();
    for part in parts.into_iter().filter(|s| !s.is_empty() && *s != ".") {
        check_part(part, style)?;
        out.push(part.to_string());
    }
    Ok(out)
}

/// The path the model named, as text: `base` (the place's folder) and a
/// relative path, or an absolute path when there is no place.
pub fn target_text(base: Option<&str>, path: &str, style: Style) -> Result<String, String> {
    let Some(base) = base else {
        return check_absolute(path, style);
    };
    let mut out = check_absolute(base, style)?;
    for part in check_relative(path, style)? {
        if !out.ends_with(style.sep()) {
            out.push(style.sep());
        }
        out.push_str(&part);
    }
    Ok(out)
}

/// A path as the system resolved it, checked again: on Windows the `\\?\`
/// prefix is taken off, and what is left must be a plain drive path (a
/// network share, `\\?\UNC\…`, or anything else is refused).
pub fn check_resolved(resolved: &str, style: Style) -> Result<String, String> {
    let plain = match style {
        Style::Windows => {
            let rest = resolved.strip_prefix("\\\\?\\").unwrap_or(resolved);
            if rest.starts_with("UNC\\") || rest.starts_with("\\\\") {
                return Err("That path leads to a network share; it is refused".into());
            }
            rest
        }
        Style::Unix => resolved,
    };
    check_absolute(plain, style).map_err(|e| format!("That path does not resolve cleanly ({e})"))
}

/// Where things the model must never reach are, on this PC.
#[derive(Debug, Clone)]
pub struct Guard {
    pub style: Style,
    pub home: Option<String>,
    /// Windows: %APPDATA% (Roaming).
    pub roaming: Option<String>,
    /// Windows: %LOCALAPPDATA%.
    pub local: Option<String>,
    /// Linux: ~/.config (XDG_CONFIG_HOME).
    pub config: Option<String>,
    /// Linux: ~/.local/share (XDG_DATA_HOME).
    pub data: Option<String>,
    /// Windows' own folders as this PC names them (%SystemRoot%,
    /// %ProgramFiles%, %ProgramData%, …).
    pub system: Vec<String>,
    /// The app's own settings, data, keys and logs.
    pub own: Vec<String>,
}

/// Folders closed wherever they are (any part of the path): keys, and
/// (security review 2026-11-17) settings that run code when a program
/// starts or a folder is opened (an editor's tasks, git hooks and config,
/// any `.config`, cargo's config).
const CLOSED_PARTS: &[&str] = &[".ssh", ".gnupg", ".aws", ".vscode", ".git", ".config", ".idea", ".husky", ".cargo", ".kube", ".docker"];
/// Files closed wherever they are (by name, any case): browsers' saved
/// passwords and cookies, stored git and npm keys, shell start files,
/// Windows' own user settings.
const CLOSED_NAMES: &[&str] = &[
    "login data",
    "login data-journal",
    "login data for account",
    "login data for account-journal",
    "cookies",
    "cookies-journal",
    "cookies.sqlite",
    "key3.db",
    "key4.db",
    "logins.json",
    "signons.sqlite",
    ".git-credentials",
    ".npmrc",
    ".bashrc",
    ".bash_profile",
    ".bash_login",
    ".bash_logout",
    ".profile",
    ".zshrc",
    ".zprofile",
    ".zshenv",
    ".zlogin",
    "ntuser.dat",
    // Security review 2026-11-17: more start files and settings that run
    // code or hold keys.
    ".bash_aliases",
    ".zlogout",
    ".cshrc",
    ".tcshrc",
    ".kshrc",
    ".mkshrc",
    ".inputrc",
    ".xprofile",
    ".xinitrc",
    ".xsession",
    ".xsessionrc",
    ".pam_environment",
    ".gitconfig",
    ".netrc",
    "_netrc",
    ".pypirc",
    ".curlrc",
    ".wgetrc",
    ".vimrc",
    "_vimrc",
    ".exrc",
    ".gvimrc",
    ".emacs",
    ".tmux.conf",
    ".screenrc",
    ".lesskey",
    ".yarnrc",
    ".yarnrc.yml",
    "autorun.inf",
    "desktop.ini",
];
/// Windows: runs of folders closed wherever they are (any user, any drive).
const CLOSED_RUNS_WINDOWS: &[&str] = &[
    "/microsoft/windows/start menu",
    "/google/chrome/user data",
    "/microsoft/edge/user data",
    "/bravesoftware/brave-browser/user data",
    "/chromium/user data",
    "/vivaldi/user data",
    "/mozilla/firefox",
    "/opera software",
    "/microsoft/credentials",
    "/microsoft/protect",
    "/microsoft/vault",
    "/github cli",
];
/// Windows: folders at the top of any drive.
const CLOSED_TOP_WINDOWS: &[&str] = &["windows", "programdata", "$recycle.bin", "system volume information", "recovery"];
/// Linux: folders at the top.
const CLOSED_TOP_UNIX: &[&str] = &[
    "etc", "usr", "bin", "sbin", "boot", "var", "lib", "lib32", "lib64", "libx32", "proc", "sys", "dev", "run",
];
/// Under the home folder (both systems).
const CLOSED_IN_HOME: &[&str] = &[
    // Windows: all of AppData (Roaming, Local, LocalLow: programs'
    // settings, start-up entries, the app's own; security review 2026-11-17).
    "AppData",
    ".local/bin",
    ".local/share/applications",
    ".local/share/keyrings",
    ".local/share/systemd",
    ".local/share/nautilus/scripts",
    ".config/gh",
    ".config/autostart",
    ".config/systemd/user",
    ".local/share/systemd/user",
    ".local/share/keyrings",
    ".config/google-chrome",
    ".config/chromium",
    ".config/microsoft-edge",
    ".config/BraveSoftware",
    ".config/vivaldi",
    ".config/opera",
    ".mozilla",
    "snap/firefox",
    "snap/chromium",
];
/// Windows: under %APPDATA% (startup folder, saved credentials and keys,
/// browser profiles, gh's keys).
const CLOSED_IN_ROAMING: &[&str] = &[
    "Microsoft/Windows/Start Menu",
    "Microsoft/Credentials",
    "Microsoft/Protect",
    "Microsoft/Vault",
    "Mozilla/Firefox",
    "Opera Software",
    "GitHub CLI",
];
/// Windows: under %LOCALAPPDATA% (browser profiles, saved credentials).
const CLOSED_IN_LOCAL: &[&str] = &[
    "Google/Chrome/User Data",
    "Microsoft/Edge/User Data",
    "BraveSoftware/Brave-Browser/User Data",
    "Chromium/User Data",
    "Vivaldi/User Data",
    "Mozilla/Firefox",
    "Microsoft/Credentials",
    "Microsoft/Vault",
];
/// Under ~/.config (Linux, wherever XDG puts it).
const CLOSED_IN_CONFIG: &[&str] = &[
    "gh", "autostart", "systemd/user", "google-chrome", "chromium", "microsoft-edge", "BraveSoftware", "vivaldi", "opera",
];
/// Under ~/.local/share (Linux).
const CLOSED_IN_DATA: &[&str] = &["systemd/user", "keyrings"];

fn under(key: &str, base: &str) -> bool {
    key == base || (key.starts_with(base) && (base.ends_with('/') || key[base.len()..].starts_with('/')))
}

impl Guard {
    /// The closed folders, as comparison keys.
    fn closed(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut add = |base: &Option<String>, rels: &[&str]| {
            if let Some(base) = base {
                for rel in rels {
                    out.push(self.style.key(&format!("{base}/{rel}")));
                }
            }
        };
        add(&self.home, CLOSED_IN_HOME);
        add(&self.roaming, CLOSED_IN_ROAMING);
        add(&self.local, CLOSED_IN_LOCAL);
        add(&self.config, CLOSED_IN_CONFIG);
        add(&self.data, CLOSED_IN_DATA);
        // Windows: %APPDATA% and %LOCALAPPDATA% whole, wherever they are
        // (programs' settings that run code; the app's own is closed too).
        // Linux: ~/.config whole, wherever XDG puts it.
        for base in [&self.roaming, &self.local, &self.config].into_iter().flatten() {
            out.push(self.style.key(base));
        }
        out.extend(self.system.iter().chain(&self.own).map(|p| self.style.key(p)));
        out
    }

    /// Whether a resolved path (check_resolved) is never reachable.
    pub fn never_reachable(&self, path: &str) -> bool {
        let key = self.style.key(path);
        if self.closed().iter().any(|base| under(&key, base)) {
            return true;
        }
        let parts: Vec<&str> = key.split('/').filter(|p| !p.is_empty()).collect();
        if parts.iter().any(|p| CLOSED_PARTS.contains(&p.to_lowercase().as_str())) {
            return true;
        }
        let name = parts.last().map(|n| n.to_lowercase()).unwrap_or_default();
        if CLOSED_NAMES.contains(&name.as_str()) || name.ends_with("profile.ps1") {
            return true;
        }
        match self.style {
            Style::Windows => {
                let top = parts.get(1).copied().unwrap_or("");
                CLOSED_TOP_WINDOWS.contains(&top)
                    || top.starts_with("program files")
                    || CLOSED_RUNS_WINDOWS.iter().any(|run| {
                        let mut at = 0;
                        while let Some(i) = key[at..].find(run) {
                            let end = at + i + run.len();
                            if end == key.len() || key[end..].starts_with('/') {
                                return true;
                            }
                            at = end;
                        }
                        false
                    })
            }
            Style::Unix => parts.first().is_some_and(|top| CLOSED_TOP_UNIX.contains(top)),
        }
    }
}

/// Facts about what is asked, worked out by the app (never by the model).
#[derive(Debug, Default)]
pub struct Facts {
    /// The file's size now (None: no such file yet, or a folder).
    pub size_now: Option<u64>,
    /// A write: the size after it.
    pub size_after: Option<u64>,
    /// A write: what changes (escaped, head and tail).
    pub change: Option<crate::pc_write::Change>,
}

/// "1,234 bytes (1.2 KB)".
pub fn size_text(bytes: u64) -> String {
    let digits = bytes.to_string();
    let mut grouped = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    let unit = if bytes == 1 { "byte" } else { "bytes" };
    match bytes {
        0..1024 => format!("{grouped} {unit}"),
        1024..1_048_576 => format!("{grouped} bytes ({:.1} KB)", bytes as f64 / 1024.0),
        _ => format!("{grouped} bytes ({:.1} MB)", bytes as f64 / 1_048_576.0),
    }
}

/// The native question: the app's facts first (what, where, read / list /
/// write / delete, size), then, under approval::MODEL_SAYS, the model's
/// reason and the text it wants to write (escaped, capped).
pub fn question(action: Action, path: &str, facts: &Facts, reason: Option<&str>) -> String {
    use crate::approval::{model_words, MODEL_SAYS};
    let (head, what) = match (action, facts.size_now) {
        (Action::List, _) => ("list a folder", "list (names, sizes and dates of what is in it; nothing is opened)"),
        (Action::Read, _) => ("read a file", "read (its text goes to the model)"),
        (Action::Write, None) => ("make a new file", "write (a new file)"),
        (Action::Write, Some(_)) => ("CHANGE a file", "write (replace its text; the earlier version is kept in DesktopAgent's private folder)"),
        (Action::Delete, _) => ("DELETE a file", "delete (a copy is kept in DesktopAgent's private folder)"),
    };
    // The path is the resolved one, already checked to have no hidden
    // characters (check_text): shown as it is.
    let mut q = format!("The model wants to {head} outside its workspace.\n\nWhere: {path}\nAction: {what}");
    match (action, facts.size_now, facts.size_after) {
        (Action::Write, Some(now), Some(after)) => {
            q.push_str(&format!("\nSize: {} now, {} after", size_text(now), size_text(after)))
        }
        (Action::Write, None, Some(after)) => q.push_str(&format!("\nSize: {}", size_text(after))),
        (_, Some(now), _) => q.push_str(&format!("\nSize: {}", size_text(now))),
        _ => {}
    }
    if let Some(change) = &facts.change {
        q.push_str(&format!("\nLines: +{} \u{2212}{}", change.added, change.removed));
    }
    q.push_str("\n\nAllow it only if you asked for this. It is asked again every time.");
    q.push_str(&format!("\n\n{MODEL_SAYS}\nWhy: "));
    match reason.map(str::trim).filter(|r| !r.is_empty()) {
        Some(reason) => q.push_str(&model_words(reason)),
        None => q.push_str("(no reason given)"),
    }
    if let Some(change) = &facts.change {
        q.push_str(if facts.size_now.is_some() {
            "\nThe change (- before, + after):\n"
        } else {
            "\nThe new text:\n"
        });
        q.push_str(&change.view.join("\n"));
    }
    q
}

/// One line of the log: when, who asked (the model, or the app's own
/// screens), the action, the outcome and the path; never contents. For
/// the model, the thinking behind the request (its last
/// approval::MAX_THINKING characters) at the end, escaped.
pub fn log_line(when: u64, who: &str, action: &str, outcome: &str, path: &str, thinking: Option<&str>) -> String {
    use crate::remote_ask::one_line;
    let mut line = format!("{when}\t{who}\t{}\t{}\t{}", one_line(action), one_line(outcome), one_line(path));
    if let Some(thinking) = thinking.map(str::trim).filter(|t| !t.is_empty()) {
        line.push_str("\tthe model was thinking: ");
        line.push_str(&one_line(&crate::approval::thinking_words(thinking)));
    }
    line
}

// ------------------------------------------------------------ on this PC

/// The deepest part of `path` that exists, resolved by the system (links,
/// junctions, short names), with the rest added as plain names. A link
/// that leads nowhere is refused (it could be pointed anywhere later).
pub fn resolve(path: &Path) -> Result<PathBuf, String> {
    let mut rest = Vec::new();
    let mut at = path.to_path_buf();
    loop {
        if let Ok(real) = std::fs::canonicalize(&at) {
            let mut real = real;
            for part in rest.iter().rev() {
                real.push(part);
            }
            return Ok(real);
        }
        if std::fs::symlink_metadata(&at).is_ok() {
            return Err("That path is a link that leads nowhere; it is refused".into());
        }
        let Some(name) = at.file_name() else {
            return Err("That path does not resolve".into());
        };
        rest.push(name.to_os_string());
        if !at.pop() {
            return Err("That path does not resolve".into());
        }
    }
}

/// A folder as a resolved, checked string (for the guard), or as given.
fn plain(dir: &Path) -> String {
    resolve(dir)
        .ok()
        .and_then(|r| check_resolved(&r.to_string_lossy(), Style::HERE).ok())
        .unwrap_or_else(|| dir.to_string_lossy().into_owned())
}

/// The guard for this PC: its home and settings folders, Windows' own
/// folders, and the app's own folders (each as given and as resolved).
pub fn guard(app: &AppHandle) -> Guard {
    let p = app.path();
    let one = |r: tauri::Result<PathBuf>| r.ok().map(|d| plain(&d));
    let mut system = Vec::new();
    for var in ["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData", "ALLUSERSPROFILE"] {
        if let Some(dir) = std::env::var_os(var).filter(|d| !d.is_empty()) {
            let dir = PathBuf::from(dir);
            system.push(dir.to_string_lossy().into_owned());
            system.push(plain(&dir));
        }
    }
    let mut own = Vec::new();
    let dirs = [
        p.app_config_dir().ok(),
        p.app_data_dir().ok(),
        p.app_local_data_dir().ok(),
        p.app_cache_dir().ok(),
        p.app_log_dir().ok(),
        crate::files::private_dir(app).ok(),
    ];
    for dir in dirs.into_iter().flatten() {
        own.push(dir.to_string_lossy().into_owned());
        own.push(plain(&dir));
    }
    let windows = cfg!(windows);
    Guard {
        style: Style::HERE,
        home: one(p.home_dir()),
        roaming: if windows { one(p.data_dir()) } else { None },
        local: if windows { one(p.local_data_dir()) } else { None },
        config: if windows { None } else { one(p.config_dir()) },
        data: if windows { None } else { one(p.data_dir()) },
        system,
        own,
    }
}

fn place_dir(app: &AppHandle, place: &str) -> Result<PathBuf, String> {
    let p = app.path();
    let dir = match place {
        "downloads" => p.download_dir(),
        "documents" => p.document_dir(),
        "desktop" => p.desktop_dir(),
        "pictures" => p.picture_dir(),
        "music" => p.audio_dir(),
        "videos" => p.video_dir(),
        "home" => p.home_dir(),
        _ => return Err(format!("`place` must be one of: {}", PLACES.join(", "))),
    };
    dir.map_err(|_| format!("This PC has no {place} folder"))
}

/// Where the model's path really is, checked: the shape, then resolved,
/// then checked again, then the deny list (on the resolved path).
pub fn locate(app: &AppHandle, place: Option<&str>, path: &str) -> Result<PathBuf, String> {
    let base = match place.map(str::trim).filter(|p| !p.is_empty()) {
        Some(place) => Some(place_dir(app, place)?.to_string_lossy().into_owned()),
        None => None,
    };
    let named = target_text(base.as_deref(), path, Style::HERE)?;
    checked(app, Path::new(&named))
}

/// An absolute path resolved and checked against the deny list.
pub fn checked(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let named = check_absolute(&path.to_string_lossy(), Style::HERE)?;
    let real = resolve(Path::new(&named))?;
    let real = check_resolved(&real.to_string_lossy(), Style::HERE)?;
    if guard(app).never_reachable(&real) {
        return Err(NEVER.into());
    }
    Ok(PathBuf::from(real))
}

/// Writes one line to the log of access outside the workspace.
pub fn audit(app: &AppHandle, who: &str, action: &str, outcome: &str, path: &str, thinking: Option<&str>) {
    crate::remote_ask::log_outside(app, |when| log_line(when, who, action, outcome, path, thinking));
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    name: String,
    is_dir: bool,
    size: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// The resolved path that was used.
    path: String,
    text: Option<String>,
    cut: bool,
    entries: Option<Vec<Listed>>,
    more: usize,
}

/// A write's plan: the text there now (None: a new file) and the facts.
fn write_facts(real: &Path, content: &str) -> Result<(Option<String>, Facts), String> {
    let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if !crate::pc_write::writable(&name) {
        return Err("Only text files that open in a viewer are written (.txt, .md, .csv, .json, .xml, .html, .log); never programs or scripts".into());
    }
    crate::pc_write::check_text(content)?;
    if !real.parent().is_some_and(Path::is_dir) {
        return Err("That folder doesn't exist; nothing was made".into());
    }
    let before = match std::fs::symlink_metadata(real) {
        Ok(meta) if meta.is_file() => {
            if meta.len() > crate::pc_write::MAX_WRITE as u64 {
                return Err("That file is too large to be replaced by the model".into());
            }
            Some(std::fs::read_to_string(real).map_err(|_| "That file is not text; it is not replaced".to_string())?)
        }
        Ok(_) => return Err("That is not a plain file".into()),
        Err(_) => None,
    };
    let change = crate::pc_write::change(before.as_deref(), content);
    // Never allowed unseen (security review 2026-11-17).
    if !change.whole {
        return Err(crate::pc_write::TOO_LONG_TO_SHOW.into());
    }
    let facts = Facts {
        size_now: before.as_ref().map(|b| b.len() as u64),
        size_after: Some(content.len() as u64),
        change: Some(change),
    };
    Ok((before, facts))
}

/// What a file is now (size and time), to see it didn't change while asked.
fn stamp(real: &Path) -> Option<(u64, Option<std::time::SystemTime>)> {
    std::fs::metadata(real).ok().map(|m| (m.len(), m.modified().ok()))
}

/// A copy of a file before it is replaced or deleted, in the app's private
/// folder (out of the screens' and the model's reach); the newest MAX_KEPT.
fn keep_copy(app: &AppHandle, real: &Path) -> Result<(), String> {
    let dir = crate::files::private_dir(app)?.join("outside").join("kept");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    std::fs::copy(real, dir.join(format!("{ms:013}-{name}"))).map_err(|e| format!("Could not keep a copy first, so nothing was done: {e}"))?;
    let mut kept: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|items| items.flatten().map(|i| i.path()).collect())
        .unwrap_or_default();
    kept.sort();
    let extra = kept.len().saturating_sub(MAX_KEPT);
    for old in &kept[..extra] {
        let _ = std::fs::remove_file(old);
    }
    Ok(())
}

/// The facts for the question, checked before it is asked.
fn facts_for(action: Action, real: &Path, content: Option<&str>) -> Result<(Option<String>, Facts), String> {
    match action {
        Action::List => {
            if !real.is_dir() {
                return Err("That is not a folder".into());
            }
            Ok((None, Facts::default()))
        }
        Action::Read | Action::Delete => {
            let meta = std::fs::metadata(real).map_err(|_| "No such file".to_string())?;
            if !meta.is_file() {
                return Err("That is not a file (folders are listed, never read or deleted whole)".into());
            }
            let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if action == Action::Read && !crate::pc_files::readable(&name) {
                return Err("Only text files and documents (Word, Excel, PowerPoint, OpenDocument, PDF) are read".into());
            }
            if action == Action::Delete && meta.len() > MAX_DELETE {
                return Err("That file is too large to keep a copy of, so it isn't deleted by the model".into());
            }
            Ok((None, Facts { size_now: Some(meta.len()), ..Facts::default() }))
        }
        Action::Write => write_facts(real, content.ok_or("Give the text to write in `content`")?),
    }
}

fn list(real: &Path) -> Result<Outcome, String> {
    let mut entries = Vec::new();
    for item in std::fs::read_dir(real).map_err(|e| e.to_string())?.flatten() {
        let Ok(meta) = item.metadata() else { continue };
        entries.push(Listed {
            name: item.file_name().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let more = entries.len().saturating_sub(MAX_LISTED);
    entries.truncate(MAX_LISTED);
    Ok(Outcome { entries: Some(entries), more, ..Outcome::default() })
}

/// The model's one door to files outside its workspace (tool
/// `outside_files`, DesktopToolsEngine.ts): checked, asked on this PC
/// every time, logged.
#[tauri::command]
pub async fn outside_files(
    app: AppHandle,
    action: String,
    place: Option<String>,
    path: String,
    content: Option<String>,
    reason: Option<String>,
    thinking: Option<String>,
) -> Result<Outcome, String> {
    let action = Action::parse(&action)?;
    // The model's thinking: shown last in the question, kept in the log;
    // never parsed.
    let thinking = thinking.as_deref();
    let named = match place.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(place) => format!("{place}: {path}"),
        None => path.clone(),
    };
    let real = match locate(&app, place.as_deref(), &path) {
        Ok(real) => real,
        Err(e) => {
            let outcome = if e == NEVER { "refused: never reachable" } else { "refused" };
            audit(&app, "model", action.word(), outcome, &named, thinking);
            return Err(e);
        }
    };
    let shown = real.to_string_lossy().into_owned();
    let (before, facts) = match facts_for(action, &real, content.as_deref()) {
        Ok(found) => found,
        Err(e) => {
            audit(&app, "model", action.word(), "refused", &shown, thinking);
            return Err(e);
        }
    };
    let was = stamp(&real);
    let question = crate::approval::with_thinking(&question(action, &shown, &facts, reason.as_deref()), thinking);
    // On this PC only (never a device), every time, never "always".
    if !crate::approval::ask_model_on_this_pc(&app, &question).await {
        audit(&app, "model", action.word(), "said no", &shown, thinking);
        return Err(SAID_NO.into());
    }
    // Nothing may have moved while the question was up.
    let again = locate(&app, place.as_deref(), &path);
    if again.as_ref() != Ok(&real) || stamp(&real) != was {
        audit(&app, "model", action.word(), "refused: changed while asked", &shown, thinking);
        return Err("The file or folder changed while you were asked; nothing was done".into());
    }
    let app2 = app.clone();
    let done = tauri::async_runtime::spawn_blocking(move || -> Result<Outcome, String> {
        match action {
            Action::List => list(&real),
            Action::Read => {
                let name = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let read = std::panic::catch_unwind(|| crate::pc_files::read(&real, &name))
                    .unwrap_or_else(|_| Err("The file could not be read".into()))?;
                Ok(Outcome { text: Some(read.text), cut: read.cut, ..Outcome::default() })
            }
            Action::Write => {
                let content = content.unwrap_or_default();
                let now = std::fs::read_to_string(&real).ok();
                if now != before {
                    return Err("The file changed while you were asked; nothing was written".into());
                }
                if before.is_some() {
                    keep_copy(&app2, &real)?;
                }
                std::fs::write(&real, content).map_err(|e| e.to_string())?;
                Ok(Outcome::default())
            }
            Action::Delete => {
                keep_copy(&app2, &real)?;
                std::fs::remove_file(&real).map_err(|e| e.to_string())?;
                Ok(Outcome::default())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    audit(&app, "model", action.word(), if done.is_ok() { "allowed, done" } else { "allowed, failed" }, &shown, thinking);
    done.map(|mut o| {
        o.path = shown;
        o
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use Style::{Unix, Windows};

    #[test]
    fn windows_paths_are_tidied_and_odd_ones_refused() {
        assert_eq!(check_absolute("c:/Users/me/Downloads/a.txt", Windows).unwrap(), "C:\\Users\\me\\Downloads\\a.txt");
        assert_eq!(check_absolute("C:\\Users\\\\me\\.\\x", Windows).unwrap(), "C:\\Users\\me\\x");
        assert_eq!(check_absolute("D:\\", Windows).unwrap(), "D:\\");
        for bad in [
            "\\\\server\\share\\x.txt",
            "//server/share/x.txt",
            "\\\\?\\C:\\Windows\\x",
            "\\\\.\\PhysicalDrive0",
            "\\\\?\\UNC\\server\\share",
            "C:\\Users\\me\\..\\other\\x",
            "C:\\Users\\me\\notes.txt:secret",
            "C:\\Users\\me\\notes.txt::$DATA",
            "C:notes.txt",
            "notes.txt",
            "\\Users\\me",
            "C:\\PROGRA~1\\x",
            "C:\\Users\\me\\DOCUME~2",
            "C:\\Users\\me\\CON",
            "C:\\Users\\me\\nul.txt",
            "C:\\Users\\me\\com1",
            "C:\\Users\\me\\x.",
            "C:\\Users\\me\\x ",
            "C:\\Users\\me\\a*b",
            "C:\\Users\\me\\a\u{202e}txt.exe",
            "C:\\Users\\me\\a\nb",
            "",
            "   ",
        ] {
            assert!(check_absolute(bad, Windows).is_err(), "{bad:?}");
        }
        assert!(check_absolute(&format!("C:\\{}", "a".repeat(MAX_PATH)), Windows).is_err());
        // Names that only look odd are fine.
        for ok in ["C:\\Users\\me\\con-notes.txt", "C:\\Users\\me\\com10.txt", "C:\\Users\\me\\a~b.txt", "C:\\x\\.hidden"] {
            assert!(check_absolute(ok, Windows).is_ok(), "{ok}");
        }
    }

    #[test]
    fn linux_paths_are_tidied_and_odd_ones_refused() {
        assert_eq!(check_absolute("/home/me//Downloads/./a.txt", Unix).unwrap(), "/home/me/Downloads/a.txt");
        assert_eq!(check_absolute("/", Unix).unwrap(), "/");
        // A backslash is a plain character in a Linux name.
        assert_eq!(check_absolute("/home/me/a\\b", Unix).unwrap(), "/home/me/a\\b");
        // A colon too (no streams on Linux), and ~1.
        assert!(check_absolute("/home/me/a:b~1", Unix).is_ok());
        for bad in ["home/me", "~/x", "/home/me/../root", "..", "/home/\u{200b}me", "/home/me/a\u{1b}b", ""] {
            assert!(check_absolute(bad, Unix).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_place_takes_a_relative_path_only() {
        let win = Some("C:\\Users\\me\\Downloads");
        assert_eq!(target_text(win, "reports/may.txt", Windows).unwrap(), "C:\\Users\\me\\Downloads\\reports\\may.txt");
        assert_eq!(target_text(win, "reports\\may.txt", Windows).unwrap(), "C:\\Users\\me\\Downloads\\reports\\may.txt");
        assert_eq!(target_text(win, "", Windows).unwrap(), "C:\\Users\\me\\Downloads");
        for bad in ["..\\x", "a\\..\\..\\x", "\\x", "/x", "C:\\x", "C:x", "a.txt:stream", "PROGRA~1"] {
            assert!(target_text(win, bad, Windows).is_err(), "{bad:?}");
        }
        let lin = Some("/home/me/Downloads");
        assert_eq!(target_text(lin, "reports/may.txt", Unix).unwrap(), "/home/me/Downloads/reports/may.txt");
        assert_eq!(target_text(lin, ".", Unix).unwrap(), "/home/me/Downloads");
        for bad in ["../x", "a/../../x", "/etc/passwd"] {
            assert!(target_text(lin, bad, Unix).is_err(), "{bad:?}");
        }
        // No place: an absolute path.
        assert_eq!(target_text(None, "/tmp/x", Unix).unwrap(), "/tmp/x");
        assert!(target_text(None, "x", Unix).is_err());
    }

    #[test]
    fn resolved_paths_must_be_plain() {
        assert_eq!(check_resolved("\\\\?\\C:\\Users\\me\\x.txt", Windows).unwrap(), "C:\\Users\\me\\x.txt");
        assert_eq!(check_resolved("C:\\Users\\me", Windows).unwrap(), "C:\\Users\\me");
        assert!(check_resolved("\\\\?\\UNC\\server\\share\\x", Windows).is_err());
        assert!(check_resolved("\\\\server\\share\\x", Windows).is_err());
        assert!(check_resolved("\\\\?\\Volume{1234}\\x", Windows).is_err());
        assert!(check_resolved("\\\\?\\C:\\Users\\me\\x:y", Windows).is_err());
        assert_eq!(check_resolved("/home/me/x", Unix).unwrap(), "/home/me/x");
    }

    fn windows_guard() -> Guard {
        Guard {
            style: Windows,
            home: Some("C:\\Users\\me".into()),
            roaming: Some("C:\\Users\\me\\AppData\\Roaming".into()),
            local: Some("C:\\Users\\me\\AppData\\Local".into()),
            config: None,
            data: None,
            system: vec!["C:\\Windows".into(), "D:\\Apps\\Program Files".into(), "C:\\ProgramData".into()],
            own: vec![
                "C:\\Users\\me\\AppData\\Roaming\\app.pocketagent.desktop".into(),
                "C:\\Users\\me\\AppData\\Local\\app.pocketagent.desktop".into(),
            ],
        }
    }

    fn linux_guard() -> Guard {
        Guard {
            style: Unix,
            home: Some("/home/me".into()),
            roaming: None,
            local: None,
            config: Some("/home/me/.config".into()),
            data: Some("/home/me/.local/share".into()),
            system: vec![],
            own: vec!["/home/me/.config/app.pocketagent.desktop".into(), "/home/me/.local/share/app.pocketagent.desktop".into()],
        }
    }

    #[test]
    fn windows_places_never_reachable() {
        let g = windows_guard();
        for closed in [
            "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\x.lnk",
            "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu",
            "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp\\x.bat",
            "C:\\Windows\\System32\\Tasks\\x",
            "C:\\Windows\\Tasks\\x.job",
            "c:\\windows\\win.ini",
            "C:\\Windows",
            "C:\\Program Files\\App\\x.exe",
            "C:\\Program Files (x86)\\App",
            "E:\\Program Files\\x",
            "D:\\Apps\\Program Files\\x",
            "C:\\ProgramData\\x",
            "C:\\Users\\me\\.ssh\\id_ed25519",
            "C:\\Users\\me\\.ssh",
            "C:\\Users\\me\\.gnupg\\x",
            "C:\\Users\\me\\.aws\\credentials",
            "C:\\Users\\me\\.config\\gh\\hosts.yml",
            "C:\\Users\\me\\AppData\\Roaming\\GitHub CLI\\hosts.yml",
            "C:\\Users\\me\\.git-credentials",
            "C:\\Users\\me\\.npmrc",
            "C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Bookmarks",
            "C:\\Users\\me\\AppData\\Local\\Microsoft\\Edge\\User Data",
            "C:\\Users\\me\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\x",
            "C:\\Users\\me\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles\\a.default\\key4.db",
            "C:\\Users\\me\\Documents\\copied\\Login Data",
            "C:\\Users\\me\\Documents\\copied\\Cookies",
            "C:\\Users\\me\\Documents\\copied\\logins.json",
            "C:\\Users\\me\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1",
            "C:\\Users\\me\\Documents\\PowerShell\\profile.ps1",
            "C:\\Users\\me\\.bashrc",
            "C:\\Users\\me\\NTUSER.DAT",
            "C:\\Users\\me\\AppData\\Roaming\\app.pocketagent.desktop",
            "C:\\Users\\me\\AppData\\Roaming\\app.pocketagent.desktop\\Documents\\PocketAgentFiles\\a.txt",
            "C:\\Users\\me\\AppData\\Local\\app.pocketagent.desktop\\link\\answers.log",
            "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Credentials\\x",
            "C:\\Users\\other\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\x",
            // Security review 2026-11-17: settings that run code.
            "C:\\Users\\me\\AppData\\Roaming\\KeePass\\KeePass.config.xml",
            "C:\\Users\\me\\AppData\\Roaming\\Code\\User\\settings.json",
            "C:\\Users\\me\\AppData\\Local\\Programs\\x\\x.exe",
            "C:\\Users\\me\\AppData\\LocalLow\\x",
            "C:\\Users\\me\\Documents\\project\\.vscode\\tasks.json",
            "C:\\Users\\me\\Documents\\project\\.git\\hooks\\pre-commit",
            "C:\\Users\\me\\Documents\\project\\.git\\config",
            "C:\\Users\\me\\.gitconfig",
            "C:\\Users\\me\\_netrc",
            "D:\\stick\\autorun.inf",
        ] {
            assert!(g.never_reachable(closed), "{closed}");
        }
        for open in [
            "C:\\Users\\me",
            "C:\\Users\\me\\Downloads\\report.pdf",
            "C:\\Users\\me\\Documents\\notes.txt",
            "C:\\Users\\me\\Documents\\passwords.kdbx",
            "C:\\Users\\me\\Desktop\\Windows notes.txt",
            "C:\\Users\\me\\Documents\\windows",
            "D:\\Music\\x.mp3",
            "C:\\Users\\me\\Documents\\my.sshkeys.txt",
            "C:\\Users\\me\\Documents\\Mozilla\\Firefox notes.txt",
            "C:\\Users\\me\\AppDataX\\x",
            "C:\\",
        ] {
            assert!(!g.never_reachable(open), "{open}");
        }
    }

    #[test]
    fn linux_places_never_reachable() {
        let g = linux_guard();
        for closed in [
            "/etc/passwd",
            "/etc",
            "/usr/bin/sh",
            "/bin/sh",
            "/sbin/x",
            "/boot/grub",
            "/var/spool/cron",
            "/proc/self/environ",
            "/dev/sda",
            "/home/me/.ssh/id_rsa",
            "/home/me/.gnupg",
            "/home/me/.aws/credentials",
            "/home/me/.config/gh/hosts.yml",
            "/home/me/.git-credentials",
            "/home/me/.npmrc",
            "/home/me/.bashrc",
            "/home/me/.profile",
            "/home/me/.zshrc",
            "/home/me/.config/powershell/Microsoft.PowerShell_profile.ps1",
            "/home/me/.config/autostart/x.desktop",
            "/home/me/.config/systemd/user/x.service",
            "/home/me/.local/share/systemd/user/x.service",
            "/home/me/.config/google-chrome/Default/Login Data",
            "/home/me/.config/chromium/Default",
            "/home/me/.mozilla/firefox/x.default/logins.json",
            "/home/me/snap/firefox/common",
            "/home/me/.local/share/keyrings/login.keyring",
            "/home/me/.config/app.pocketagent.desktop/link/answers.log",
            "/home/me/.local/share/app.pocketagent.desktop/Documents",
            "/home/me/backup/Cookies",
            // Security review 2026-11-17: settings that run code.
            "/home/me/.config",
            "/home/me/.config/ghostwriter/x",
            "/home/me/.config/fish/config.fish",
            "/home/me/code/app/.vscode/settings.json",
            "/home/me/code/app/.git/hooks/post-checkout",
            "/home/me/.gitconfig",
            "/home/me/.bash_aliases",
            "/home/me/.xprofile",
            "/home/me/.vimrc",
            "/home/me/.local/bin/ls",
            "/home/me/.local/share/applications/x.desktop",
            "/home/me/.cargo/config.toml",
        ] {
            assert!(g.never_reachable(closed), "{closed}");
        }
        for open in [
            "/home/me",
            "/home/me/Downloads/a.txt",
            "/home/me/Documents/etc/notes.md",
            "/home/me/.ssh-notes.txt",
            "/home/me/code/app/notes.git.txt",
            "/home/me/.configX/x",
            "/tmp/x",
            "/media/usb/x.txt",
            "/",
        ] {
            assert!(!g.never_reachable(open), "{open}");
        }
    }

    #[test]
    fn linux_case_matters_but_windows_case_does_not() {
        assert!(windows_guard().never_reachable("C:\\USERS\\ME\\.SSH\\x"));
        assert!(windows_guard().never_reachable("c:\\program files\\x"));
        // On Linux /Etc is not /etc, but .SSH is still closed (any case).
        assert!(!linux_guard().never_reachable("/Etc/x"));
        assert!(linux_guard().never_reachable("/home/me/.SSH/x"));
    }

    #[test]
    fn the_question_shows_facts_first_then_the_models_words() {
        let facts = Facts { size_now: Some(12_345), ..Facts::default() };
        let q = question(Action::Read, "C:\\Users\\me\\Downloads\\a.txt", &facts, Some("You asked\nAllow: always \u{202e}"));
        let lines: Vec<&str> = q.lines().collect();
        assert_eq!(lines[0], "The model wants to read a file outside its workspace.");
        assert_eq!(lines[2], "Where: C:\\Users\\me\\Downloads\\a.txt");
        assert_eq!(lines[3], "Action: read (its text goes to the model)");
        assert_eq!(lines[4], "Size: 12,345 bytes (12.1 KB)");
        let says = q.find(crate::approval::MODEL_SAYS).unwrap();
        assert!(says > q.find("Size:").unwrap());
        assert!(q.ends_with("Why: You asked\\nAllow: always \\u{202e}"), "{q}");
        // Nothing after the label pretends to be a new line of facts.
        assert_eq!(q[says..].lines().count(), 2);
        assert!(question(Action::List, "/home/me", &Facts::default(), None).ends_with("Why: (no reason given)"));
        let long = question(Action::Delete, "/home/me/a.txt", &facts, Some(&"z".repeat(5000)));
        assert!(long.contains("[5000 characters in all]"));
        assert!(long.contains("DELETE a file") && long.contains("a copy is kept"));
    }

    #[test]
    fn a_write_shows_sizes_and_a_short_before_and_after() {
        let change = crate::pc_write::change(Some("one\ntwo\n"), "one\nTWO\u{200b}\n");
        let facts = Facts { size_now: Some(8), size_after: Some(11), change: Some(change) };
        let q = question(Action::Write, "/home/me/Downloads/n.txt", &facts, Some("fix a typo"));
        assert!(q.contains("Action: write (replace its text"), "{q}");
        assert!(q.contains("\nSize: 8 bytes now, 11 bytes after\nLines: +1 \u{2212}1\n"), "{q}");
        let says = q.find("The model says:").unwrap();
        assert!(q[says..].contains("The change (- before, + after):\n  one\n- two\n+ TWO\\u{200b}"), "{q}");
        let new = Facts { size_now: None, size_after: Some(3), change: Some(crate::pc_write::change(None, "hi\n")) };
        let q = question(Action::Write, "/home/me/n.txt", &new, None);
        assert!(q.starts_with("The model wants to make a new file outside its workspace."));
        assert!(q.contains("The new text:\n+ hi"), "{q}");
    }

    #[test]
    fn sizes_read_plainly() {
        assert_eq!(size_text(0), "0 bytes");
        assert_eq!(size_text(1), "1 byte");
        assert_eq!(size_text(999), "999 bytes");
        assert_eq!(size_text(1536), "1,536 bytes (1.5 KB)");
        assert_eq!(size_text(5 * 1_048_576), "5,242,880 bytes (5.0 MB)");
    }

    #[test]
    fn the_log_has_no_contents_and_one_line() {
        let line = log_line(7, "model", "read", "said no", "/home/me/a\nb.txt", None);
        assert_eq!(line, "7\tmodel\tread\tsaid no\t/home/me/a\\nb.txt");
        // The thinking behind the request, escaped and capped, at the end.
        let line = log_line(8, "model", "read", "allowed, done", "/home/me/a.txt", Some("they asked\nfor it"));
        assert_eq!(line, "8\tmodel\tread\tallowed, done\t/home/me/a.txt\tthe model was thinking: they asked\\\\nfor it");
        let line = log_line(9, "model", "read", "said no", "/x", Some(&"t".repeat(2000)));
        assert!(line.contains("[\u{2026} 1400 characters before]") && line.lines().count() == 1, "{line}");
    }

    #[test]
    fn links_are_resolved_before_deciding() {
        let dir = std::env::temp_dir().join(format!("pa-outside-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("real")).unwrap();
        std::fs::write(dir.join("real").join("a.txt"), "x").unwrap();
        let real = std::fs::canonicalize(dir.join("real")).unwrap();
        // A file that isn't there yet: its folder resolved, the name added.
        assert_eq!(resolve(&dir.join("real").join("new.txt")).unwrap(), real.join("new.txt"));
        assert_eq!(resolve(&dir.join("real").join("x").join("y.txt")).unwrap(), real.join("x").join("y.txt"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("real"), dir.join("link")).unwrap();
            assert_eq!(resolve(&dir.join("link").join("a.txt")).unwrap(), real.join("a.txt"));
            // A link that leads nowhere is refused.
            std::os::unix::fs::symlink(dir.join("gone"), dir.join("dangling")).unwrap();
            assert!(resolve(&dir.join("dangling")).is_err());
            // A link into a closed place is caught on its target.
            let g = Guard { own: vec![real.to_string_lossy().into_owned()], ..linux_guard() };
            let through = resolve(&dir.join("link").join("a.txt")).unwrap();
            assert!(g.never_reachable(&check_resolved(&through.to_string_lossy(), Unix).unwrap()));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
