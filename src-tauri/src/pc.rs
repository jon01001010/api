//! The PC's own tools (desktop app only, SECURITY.md rule 6). Each starts
//! off (Toolbox switch).
//!
//! - `pc_info`: memory, disk space, graphics cards, processor and system
//!   version. Read only.
//! - `run_command`: one PowerShell (Windows) or shell (Linux) command, shown
//!   in full in a native dialog every time (never "always allow"), run in the
//!   workspace folder, stopped after 60 s; its output comes back (capped).
//! - `open_workspace_file`: a workspace file opened in its app (asks).
//!   Documents, pictures, text and media only: never programs or scripts,
//!   which opening would run.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The workspace as the screens name it (src/services/talents/fileWorkspace.ts).
const WORKSPACE: &str = "Documents/PocketAgentFiles";
const COMMAND_TIME_LIMIT: Duration = Duration::from_secs(60);
const MAX_OUTPUT: usize = 32 * 1024;
const MAX_COMMAND: usize = 2000;

fn workspace(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(WORKSPACE);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    name: String,
    mount: String,
    total: u64,
    free: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PcInfo {
    system: String,
    processor: String,
    cores: usize,
    total_memory: u64,
    available_memory: u64,
    disks: Vec<Disk>,
    gpus: Vec<crate::system::Gpu>,
    uptime_seconds: u64,
}

#[tauri::command(async)]
pub fn pc_info(app: AppHandle) -> PcInfo {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    let disks = sysinfo::Disks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|d| Disk {
            name: d.name().to_string_lossy().into_owned(),
            mount: d.mount_point().to_string_lossy().into_owned(),
            total: d.total_space(),
            free: d.available_space(),
        })
        .collect();
    PcInfo {
        system: sysinfo::System::long_os_version().unwrap_or_default(),
        processor: sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        total_memory: sys.total_memory(),
        available_memory: sys.available_memory(),
        disks,
        gpus: crate::system::gpus(&app),
        uptime_seconds: sysinfo::System::uptime(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ran {
    exit_code: Option<i32>,
    output: String,
    timed_out: bool,
}

/// What the dialog shows: the whole command and where it runs.
pub fn command_question(command: &str) -> String {
    format!(
        "DesktopAgent wants to run this command on your PC (in its workspace folder):\n\n{command}\n\nA command can do anything you can do on this PC. Only allow it if you understand it."
    )
}

pub fn check_command(command: &str) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() || command.len() > MAX_COMMAND {
        return Err(format!("The command must be 1–{MAX_COMMAND} characters"));
    }
    if command.chars().any(|c| c == '\0') {
        return Err("The command has invalid characters".into());
    }
    Ok(command.to_string())
}

fn shell(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        c.creation_flags(0x0800_0000); // no console window
        c
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    }
}

fn cut(mut text: String) -> String {
    if text.len() > MAX_OUTPUT {
        let mut end = MAX_OUTPUT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n[… output cut]");
    }
    text
}

/// Runs one command (after the user said yes), with the time limit.
pub fn run(command: &str, dir: &Path, limit: Duration) -> Result<Ran, String> {
    let mut child = shell(command)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run it: {e}"))?;
    // Read the output while it runs (a full pipe would stall the command).
    // Programs the command started may keep the output open after it is
    // stopped, so the reading gives up a moment after the command ends.
    let reader = |pipe: Option<Box<dyn std::io::Read + Send>>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut s = Vec::new();
            if let Some(p) = pipe {
                let _ = std::io::Read::read_to_end(&mut std::io::Read::take(p, (MAX_OUTPUT * 2) as u64), &mut s);
            }
            let _ = tx.send(s);
        });
        rx
    };
    let out = reader(child.stdout.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>));
    let err = reader(child.stderr.take().map(|p| Box::new(p) as Box<dyn std::io::Read + Send>));
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < limit => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                timed_out = true;
                let _ = child.kill();
                break child.wait().ok();
            }
        }
    };
    let grace = Duration::from_secs(2);
    let stdout = String::from_utf8_lossy(&out.recv_timeout(grace).unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&err.recv_timeout(grace).unwrap_or_default()).into_owned();
    // Errors first, so a long output can't push them out.
    let output = if stderr.trim().is_empty() {
        stdout
    } else {
        format!("[errors]\n{stderr}\n[output]\n{stdout}")
    };
    Ok(Ran {
        exit_code: status.and_then(|s| s.code()),
        output: cut(output),
        timed_out,
    })
}

#[tauri::command]
pub async fn run_command(app: AppHandle, command: String) -> Result<Ran, String> {
    let command = check_command(&command)?;
    // Every time, natively, with the whole command; no "always allow".
    if !crate::approval::ask(&app, &command_question(&command)).await {
        return Err("The user said no. Nothing was run.".into());
    }
    let dir = workspace(&app)?;
    tauri::async_runtime::spawn_blocking(move || run(&command, &dir, COMMAND_TIME_LIMIT))
        .await
        .map_err(|e| e.to_string())?
}

/// Kinds of file that open in a viewer or editor, never ones that run.
const OPENABLE: &[&str] = &[
    "txt", "md", "csv", "json", "html", "htm", "xml", "log", "pdf", "docx", "doc", "xlsx", "xls",
    "pptx", "ppt", "odt", "ods", "odp", "rtf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg",
    "mp3", "wav", "ogg", "m4a", "mp4", "webm", "mkv",
];

pub fn openable(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(_, ext)| OPENABLE.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn open_workspace_file(app: AppHandle, name: String) -> Result<(), String> {
    if name.contains(['/', '\\', ':']) || name.contains("..") || name.trim().is_empty() {
        return Err("Use a workspace file name (no folders)".into());
    }
    if !openable(&name) {
        return Err("Only documents, pictures, text and media files are opened (never programs or scripts)".into());
    }
    let path = workspace(&app)?.join(&name);
    if !path.is_file() {
        return Err(format!("No workspace file named {name}"));
    }
    let question = format!("DesktopAgent wants to open this workspace file in its app:\n\n{name}");
    if !crate::approval::ask(&app, &question).await {
        return Err("The user said no. Nothing was opened.".into());
    }
    crate::open::launch(&path.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_runs_in_the_given_folder_with_its_output() {
        let dir = std::env::temp_dir();
        let ran = run("echo hello && pwd", &dir, Duration::from_secs(10)).unwrap();
        assert_eq!(ran.exit_code, Some(0));
        assert!(ran.output.contains("hello"));
        assert!(!ran.timed_out);
    }

    #[test]
    fn a_long_command_is_stopped() {
        let ran = run("sleep 30", &std::env::temp_dir(), Duration::from_millis(300)).unwrap();
        assert!(ran.timed_out);
    }

    #[test]
    fn errors_and_long_output_come_back_cut() {
        let ran = run("yes x | head -c 100000; echo oops 1>&2; exit 3", &std::env::temp_dir(), Duration::from_secs(10)).unwrap();
        assert_eq!(ran.exit_code, Some(3));
        assert!(ran.output.contains("[… output cut]"));
        assert!(ran.output.contains("oops"));
    }

    #[test]
    fn the_dialog_shows_the_whole_command() {
        let q = command_question("Get-ChildItem C:\\");
        assert!(q.contains("Get-ChildItem C:\\"));
        assert!(q.contains("Only allow it if you understand it"));
        assert!(check_command("   ").is_err());
        assert!(check_command(&"x".repeat(MAX_COMMAND + 1)).is_err());
    }

    #[test]
    fn programs_and_scripts_are_never_opened() {
        for bad in ["run.exe", "x.bat", "x.cmd", "x.ps1", "x.lnk", "x.js", "x.vbs", "x.msi", "x.scr", "noext"] {
            assert!(!openable(bad), "{bad}");
        }
        for ok in ["report.docx", "photo.JPG", "notes.md", "song.mp3"] {
            assert!(openable(ok), "{ok}");
        }
    }
}
