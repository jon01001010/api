//! More of the PC's own tools (desktop app only, SECURITY.md rule 6):
//!
//! - `clipboard_read`: the text on the clipboard, after a native dialog that
//!   shows it (the model gets nothing the user didn't see).
//! - `notify`: a system notification (timers and reminders when the window
//!   is behind others). Shows text only.
//! - `media_key`: play / pause, next, previous, volume (Windows media keys;
//!   on Linux `playerctl` for play / next / previous). The tool asks first.
//! - `print_file`: a workspace document or picture printed by its app,
//!   after a native dialog.
//! - `take_screenshot`: a picture of the screen, after a native dialog;
//!   DesktopAgent hides itself while it is taken. Kept in the app's folder;
//!   the user sees it attached and sends it or removes it. Windows only.
//! - `quick_key_set`: a key combination (Ctrl+Shift+Space) that brings
//!   DesktopAgent to the front from anywhere; off until switched on.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager};

const MAX_CLIPBOARD: usize = 50 * 1024;
/// Screenshots are scaled down to this width (enough for a vision model).
const SHOT_WIDTH: u32 = 1600;
pub const QUICK_KEY: &str = "CommandOrControl+Shift+Space";

fn preview(text: &str, max: usize) -> String {
    let short: String = text.chars().take(max).collect();
    if short.len() < text.len() {
        format!("{short}\n[… {} characters in all]", text.chars().count())
    } else {
        short
    }
}

/// What the clipboard dialog says (the text itself, so the user sees it).
pub fn clipboard_question(text: &str) -> String {
    format!(
        "DesktopAgent wants to give the model the text on your clipboard:\n\n{}",
        preview(text, 600)
    )
}

#[tauri::command]
pub async fn clipboard_read(app: AppHandle) -> Result<String, String> {
    let text = tauri::async_runtime::spawn_blocking(|| {
        arboard::Clipboard::new()
            .and_then(|mut c| c.get_text())
            .map_err(|_| "There is no text on the clipboard".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    if text.trim().is_empty() {
        return Err("There is no text on the clipboard".into());
    }
    if !crate::approval::ask(&app, &clipboard_question(&text)).await {
        return Err("The user said no. Nothing was read.".into());
    }
    let mut text = text;
    if text.len() > MAX_CLIPBOARD {
        let mut end = MAX_CLIPBOARD;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n[… cut]");
    }
    Ok(text)
}

#[tauri::command(async)]
pub fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let title: String = title.chars().take(80).collect();
    let body: String = body.chars().take(300).collect();
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// The media keys a tool may press.
pub fn media_vk(key: &str) -> Option<u16> {
    Some(match key {
        "play_pause" => 0xB3,
        "next" => 0xB0,
        "previous" => 0xB1,
        "stop" => 0xB2,
        "volume_up" => 0xAF,
        "volume_down" => 0xAE,
        "mute" => 0xAD,
        _ => return None,
    })
}

#[tauri::command(async)]
pub fn media_key(key: String) -> Result<(), String> {
    let vk = media_vk(&key).ok_or("Unknown media key")?;
    press(vk, &key)
}

#[cfg(windows)]
fn press(vk: u16, _key: &str) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY,
    };
    let key = |flags: KEYBD_EVENT_FLAGS| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == 2 {
        Ok(())
    } else {
        Err("Windows did not take the key".into())
    }
}

#[cfg(not(windows))]
fn press(_vk: u16, key: &str) -> Result<(), String> {
    let action = match key {
        "play_pause" => "play-pause",
        "next" => "next",
        "previous" => "previous",
        "stop" => "stop",
        _ => return Err("Volume keys work on Windows only".into()),
    };
    std::process::Command::new("playerctl")
        .arg(action)
        .status()
        .map_err(|_| "Media keys need playerctl on Linux".to_string())
        .map(|_| ())
}

/// Kinds that print in their own app (documents, pictures, text).
const PRINTABLE: &[&str] = &[
    "txt", "md", "csv", "html", "htm", "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt",
    "ods", "odp", "rtf", "png", "jpg", "jpeg", "gif", "webp", "bmp",
];

pub fn printable(name: &str) -> bool {
    name.rsplit_once('.')
        .map(|(_, ext)| PRINTABLE.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn workspace_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if name.contains(['/', '\\', ':']) || name.contains("..") || name.trim().is_empty() {
        return Err("Use a workspace file name (no folders)".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("Documents/PocketAgentFiles")
        .join(name);
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("No workspace file named {name}"))
    }
}

#[tauri::command]
pub async fn print_file(app: AppHandle, name: String) -> Result<(), String> {
    if !printable(&name) {
        return Err("Only documents, pictures and text files are printed".into());
    }
    let path = workspace_file(&app, &name)?;
    let question = format!("DesktopAgent wants to print this workspace file (with your default printer and its app):\n\n{name}");
    if !crate::approval::ask(&app, &question).await {
        return Err("The user said no. Nothing was printed.".into());
    }
    print(&path)
}

#[cfg(windows)]
fn print(path: &std::path::Path) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let result = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("print"),
            &HSTRING::from(path.to_string_lossy().as_ref()),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("Windows has no app that prints this kind of file".into())
    }
}

#[cfg(not(windows))]
fn print(path: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("lp")
        .arg(path)
        .status()
        .map_err(|_| "Printing needs the lp command on Linux".to_string())
        .map(|_| ())
}

/// Scales a top-down BGRA picture to at most `max_w` wide, as RGB.
pub fn shrink_bgra(bgra: &[u8], w: u32, h: u32, max_w: u32) -> (Vec<u8>, u32, u32) {
    let (nw, nh) = if w > max_w {
        (max_w, ((h as u64 * max_w as u64) / w as u64).max(1) as u32)
    } else {
        (w, h)
    };
    let mut out = Vec::with_capacity((nw * nh * 3) as usize);
    for y in 0..nh {
        let sy = (y as u64 * h as u64 / nh as u64) as u32;
        for x in 0..nw {
            let sx = (x as u64 * w as u64 / nw as u64) as u32;
            let i = ((sy * w + sx) * 4) as usize;
            out.extend_from_slice(&[bgra[i + 2], bgra[i + 1], bgra[i]]);
        }
    }
    (out, nw, nh)
}

pub fn png_rgb(rgb: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgb).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[cfg(windows)]
fn capture() -> Result<(Vec<u8>, u32, u32), String> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };
    unsafe {
        let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
        let (w, h) = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
        if w <= 0 || h <= 0 {
            return Err("No screen found".into());
        }
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bitmap.into());
        let copied = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (w * h * 4) as usize];
        let rows = GetDIBits(
            mem,
            bitmap,
            0,
            h as u32,
            Some(pixels.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(mem, old);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        if copied.is_err() || rows == 0 {
            return Err("Windows did not give a picture of the screen".into());
        }
        Ok((pixels, w as u32, h as u32))
    }
}

#[cfg(not(windows))]
fn capture() -> Result<(Vec<u8>, u32, u32), String> {
    Err("Screenshots work in the Windows app for now".into())
}

/// Takes a screenshot (after asking), with DesktopAgent hidden, and keeps it
/// in the app's folder. Returns the app's own path for it.
#[tauri::command]
pub async fn take_screenshot(app: AppHandle) -> Result<Option<String>, String> {
    let question = "Take a picture of your screen?\n\nDesktopAgent hides itself for a moment. The picture is attached to your message so you can look at it, and only goes to the model if you send it.";
    if !crate::approval::ask(&app, question).await {
        return Ok(None);
    }
    let window = app.get_webview_window("main");
    if let Some(w) = &window {
        let _ = w.hide();
    }
    tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(400)))
        .await
        .map_err(|e| e.to_string())?;
    let shot = tauri::async_runtime::spawn_blocking(capture).await.map_err(|e| e.to_string())?;
    if let Some(w) = &window {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let (bgra, w, h) = shot?;
    let (rgb, nw, nh) = shrink_bgra(&bgra, w, h, SHOT_WIDTH);
    let png = png_rgb(&rgb, nw, nh)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("Caches/screens");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut tag = [0u8; 4];
    getrandom::fill(&mut tag).map_err(|e| e.to_string())?;
    let name = format!("screen-{}.png", tag.iter().map(|b| format!("{b:02x}")).collect::<String>());
    std::fs::write(dir.join(&name), png).map_err(|e| e.to_string())?;
    Ok(Some(format!("{}/Caches/screens/{name}", crate::files::APP_PREFIX)))
}

/// Brings DesktopAgent to the front (quick-chat key, tray icon).
pub fn bring_forward(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command(async)]
pub fn quick_key_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcuts = app.global_shortcut();
    let on = shortcuts.is_registered(QUICK_KEY);
    if enabled && !on {
        shortcuts
            .on_shortcut(QUICK_KEY, |app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    bring_forward(app);
                }
            })
            .map_err(|e| format!("Ctrl+Shift+Space is taken by another program: {e}"))?;
    } else if !enabled && on {
        shortcuts.unregister(QUICK_KEY).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The tray icon: open DesktopAgent, or quit it.
pub fn tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Open DesktopAgent", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("DesktopAgent")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => bring_forward(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                bring_forward(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_clipboard_dialog_shows_the_text() {
        assert!(clipboard_question("my password is 1234").contains("my password is 1234"));
        let long = "x".repeat(5000);
        assert!(clipboard_question(&long).contains("[… 5000 characters in all]"));
    }

    #[test]
    fn only_media_keys() {
        assert_eq!(media_vk("play_pause"), Some(0xB3));
        assert_eq!(media_vk("volume_up"), Some(0xAF));
        assert_eq!(media_vk("enter"), None);
        assert_eq!(media_vk("alt_f4"), None);
    }

    #[test]
    fn only_documents_and_pictures_print() {
        assert!(printable("report.docx"));
        assert!(printable("photo.JPG"));
        for bad in ["setup.exe", "x.bat", "x.ps1", "x.lnk", "noext"] {
            assert!(!printable(bad), "{bad}");
        }
    }

    #[test]
    fn screenshots_shrink_and_become_png() {
        // 4×2 BGRA, blue-ish pixels.
        let bgra: Vec<u8> = (0..8).flat_map(|_| [255u8, 0, 0, 255]).collect();
        let (rgb, w, h) = shrink_bgra(&bgra, 4, 2, 2);
        assert_eq!((w, h), (2, 1));
        assert_eq!(&rgb[..3], &[0, 0, 255]); // blue in RGB
        let png = png_rgb(&rgb, w, h).unwrap();
        assert_eq!(&png[1..4], b"PNG");
    }
}
