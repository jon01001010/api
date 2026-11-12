//! Opening something in the PC's own apps: a web page in the browser, an
//! e-mail draft in the mail app, a Windows settings page (the desktop's
//! version of the phone's actions, SECURITY.md rule 6). Only those three
//! kinds, checked here; each one asks first in a native dialog that shows
//! exactly what will open. Nothing is sent or changed by opening: the user
//! does that in the app that opens.

use tauri::AppHandle;

/// Windows settings pages the tools may open (the phone's list).
const SETTINGS_PAGES: &[&str] = &[
    "",
    "network-wifi",
    "bluetooth",
    "batterysaver",
    "display",
    "sound",
    "privacy-location",
    "appsfeatures",
    "notifications",
    "network-airplanemode",
];

/// What may be opened: a web page (http/https, not the app's own
/// `*.localhost` addresses), an e-mail draft (`mailto:`), or one of the
/// settings pages above (`ms-settings:`, Windows only).
pub fn check_target(target: &str) -> Result<String, String> {
    let target = target.trim();
    if target.len() > 4096 || target.chars().any(|c| c.is_control()) {
        return Err("Not something that can be opened".into());
    }
    if let Some(page) = target.strip_prefix("ms-settings:") {
        if cfg!(windows) && SETTINGS_PAGES.contains(&page) {
            return Ok(target.to_string());
        }
        return Err("Not a settings page DesktopAgent opens".into());
    }
    if let Some(rest) = target.strip_prefix("mailto:") {
        // A draft only: addresses, subject and body (never attachments or
        // other fields a mail app might act on).
        if let Some((_, query)) = rest.split_once('?') {
            for pair in query.split('&') {
                let key = pair.split('=').next().unwrap_or("").to_ascii_lowercase();
                if !["to", "cc", "bcc", "subject", "body"].contains(&key.as_str()) {
                    return Err(format!("E-mail drafts can't use \"{key}\""));
                }
            }
        }
        return Ok(target.to_string());
    }
    let url = crate::net::check_url(target)?;
    Ok(url.to_string())
}

/// What the dialog says for each kind.
fn question(target: &str) -> String {
    if target.starts_with("mailto:") {
        format!("DesktopAgent wants to open an e-mail draft in your mail app (you press send):\n\n{target}")
    } else if target.starts_with("ms-settings:") {
        format!("DesktopAgent wants to open Windows settings (nothing is changed):\n\n{target}")
    } else {
        format!("DesktopAgent wants to open this page in your browser:\n\n{target}")
    }
}

#[cfg(windows)]
fn launch(target: &str) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    // The system's own handler for the address; no command line, no shell.
    let result = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &HSTRING::from(target),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    // Values above 32 mean it opened.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("Windows could not open it".into())
    }
}

#[cfg(not(windows))]
fn launch(target: &str) -> Result<(), String> {
    // The desktop's own handler; the address is one argument, no shell.
    std::process::Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open it: {e}"))
}

#[tauri::command]
pub async fn open_external(app: AppHandle, target: String) -> Result<(), String> {
    let target = check_target(&target)?;
    if !crate::approval::ask(&app, &question(&target)).await {
        return Err("The user said no. Nothing was opened.".into());
    }
    launch(&target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_pages_drafts_and_settings_pages() {
        assert!(check_target("https://www.openstreetmap.org/search?query=Vancouver").is_ok());
        assert!(check_target("mailto:a@b.com?subject=Hi&body=Hello").is_ok());
        assert!(check_target("mailto:a@b.com?body=the%20attached%20notes").is_ok());
        // Never files, programs, scripts, other schemes or the app itself.
        for bad in [
            "file:///C:/Windows/System32/calc.exe",
            "C:\\Windows\\System32\\cmd.exe",
            "javascript:alert(1)",
            "ms-settings:windowsupdate-action",
            "shell:startup",
            "http://ipc.localhost/fs_read",
            "mailto:a@b.com?attach=C:/secret.txt",
            "https://example.com/\nx",
            "",
        ] {
            assert!(check_target(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_dialog_says_what_opens() {
        assert!(question("mailto:a@b.com").contains("you press send"));
        assert!(question("https://x.org/").contains("in your browser"));
    }
}
