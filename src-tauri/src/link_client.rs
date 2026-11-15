//! This PC as the *other* end of a home link (PC to PC): a second PC (e.g. a
//! laptop) uses the main PC's model, the same way the phone does. The phone's
//! own link library (native/homelink) does the work; these commands answer
//! with the same JSON as the phone's Android door, so the screens'
//! home link code (src/services/homeLink) works unchanged.
//!
//! Same rules as the phone (SECURITY.md rule 6): pairing only from the main
//! PC's one-time code (pasted here, as a laptop has no camera to scan the QR);
//! the main PC asks its user; afterwards only the main PC's model server is
//! reached, through a local port on 127.0.0.1.

use std::sync::{Arc, OnceLock};

use homelink::Phone;
use tauri::{AppHandle, Manager};

static CLIENT: OnceLock<Arc<Phone>> = OnceLock::new();

/// This PC's own key as the other end (not the PC's link key), kept where
/// the screens can't read or write it, like the link key (link.rs
/// read_entry: Credential Manager on Windows, a private file on Linux).
const CLIENT_KEY_ENTRY: &str = "DesktopAgent-link:client-key";

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn from_hex(text: &str) -> Option<[u8; 32]> {
    let text = text.trim();
    if text.len() != 64 || !text.is_ascii() {
        return None;
    }
    let mut key = [0u8; 32];
    for (i, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(key)
}

fn client_key(app: &AppHandle) -> Result<[u8; 32], String> {
    if let Some(key) = crate::link::read_entry(app, CLIENT_KEY_ENTRY).and_then(|t| from_hex(&t)) {
        return Ok(key);
    }
    // Before 2026-11-15 the key was a file in the settings folder, which on
    // Windows is the screens' own folder: moved (pairing is kept).
    let old = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("link")
        .join("client.key");
    let key = std::fs::read(&old)
        .ok()
        .and_then(|bytes| <[u8; 32]>::try_from(bytes.as_slice()).ok())
        .unwrap_or_else(|| iroh::SecretKey::generate().to_bytes());
    crate::link::write_entry(app, CLIENT_KEY_ENTRY, &to_hex(&key))?;
    if crate::link::read_entry(app, CLIENT_KEY_ENTRY).and_then(|t| from_hex(&t)) == Some(key) {
        let _ = std::fs::remove_file(&old);
    }
    Ok(key)
}

fn client(app: &AppHandle) -> Result<Arc<Phone>, String> {
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    let key = client_key(app)?;
    let made = Arc::new(Phone::with_key(key, None)?);
    Ok(CLIENT.get_or_init(|| made).clone())
}

fn fail(e: impl std::fmt::Display) -> String {
    serde_json::json!({"ok": false, "error": e.to_string()}).to_string()
}

/// Runs a blocking link call on a plain thread of its own (the library runs
/// its own async engine, which must not start inside the app's), as JSON.
async fn answer(
    app: AppHandle,
    f: impl FnOnce(Arc<Phone>) -> Result<serde_json::Value, String> + Send + 'static,
) -> String {
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        // A failure inside must come back as an error, never close the app.
        let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            match client(&app).and_then(f) {
                Ok(v) => v.to_string(),
                Err(e) => fail(e),
            }
        }))
        .unwrap_or_else(|_| fail("The home link hit an internal error"));
        let _ = tx.send(out);
    });
    rx.await.unwrap_or_else(|_| fail("The home link stopped"))
}

/// This PC's name as the main PC shows it ("Pair with … ?").
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC".into())
}

#[tauri::command]
pub async fn homelink_pair(app: AppHandle, qr: String) -> String {
    answer(app, move |p| {
        let pc = p.pair(&qr, &device_name())?;
        Ok(serde_json::json!({"ok": true, "pc": pc}))
    })
    .await
}

#[tauri::command]
pub async fn homelink_status(app: AppHandle, pc: String) -> String {
    answer(app, move |p| {
        let s = p.status(&pc)?;
        Ok(serde_json::json!({
            "ok": true,
            "running": s.running,
            "apiKey": s.api_key,
            "events": s.events,
            "build": s.build,
            "lastModel": s.last_model,
            "route": s.route,
        }))
    })
    .await
}

#[tauri::command]
pub async fn homelink_start_model(app: AppHandle, pc: String) -> String {
    answer(app, move |p| {
        p.start_model(&pc)?;
        Ok(serde_json::json!({"ok": true}))
    })
    .await
}

#[tauri::command]
pub async fn homelink_sync(app: AppHandle, pc: String, body: String) -> String {
    answer(app, move |p| {
        let reply = p.sync(&pc, &body)?;
        serde_json::from_str(&reply).map_err(|_| "The PC's answer was not readable".to_string())
    })
    .await
}

#[tauri::command]
pub async fn homelink_questions(app: AppHandle, pc: String) -> String {
    answer(app, move |p| p.questions(&pc)).await
}

/// Yes or no to one of the other PC's questions (never "always").
#[tauri::command]
pub async fn homelink_answer_question(app: AppHandle, pc: String, id: u64, yes: bool) -> String {
    answer(app, move |p| {
        p.answer_question(&pc, id, yes)?;
        Ok(serde_json::json!({"ok": true}))
    })
    .await
}

/// Asks the other PC for a picture (only while allowed there for this
/// PC). Saved in this PC's workspace `images` folder, under a name made
/// here, so the chat shows it like one made on this PC.
#[tauri::command]
pub async fn homelink_picture(
    app: AppHandle,
    pc: String,
    prompt: String,
    width: Option<u32>,
    height: Option<u32>,
    steps: Option<u32>,
) -> String {
    let dir = match crate::pc::workspace(&app) {
        Ok(dir) => dir.join(crate::image_gen::IMAGES_DIR),
        Err(e) => return fail(e),
    };
    answer(app, move |p| {
        let picture = p.picture(&pc, &prompt, width, height, steps)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = crate::image_gen::new_name()?;
        std::fs::write(dir.join(&name), &picture.png).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({
            "ok": true,
            "path": format!(
                "{}/{}/{}/{name}",
                crate::files::APP_PREFIX,
                crate::pc::WORKSPACE,
                crate::image_gen::IMAGES_DIR
            ),
            "name": name,
            "seed": picture.seed,
            "seconds": picture.seconds,
        }))
    })
    .await
}

/// One of the other PC's read-only tools (only while allowed there for
/// this PC; reading its workspace asks there once per chat). `args`: JSON;
/// only the named fields the library sends are taken from it.
#[tauri::command]
pub async fn homelink_tool(app: AppHandle, pc: String, name: String, chat: String, args: String) -> String {
    answer(app, move |p| p.tool(&pc, &name, &chat, &args)).await
}

#[tauri::command]
pub async fn homelink_open_tunnel(app: AppHandle, pc: String) -> String {
    answer(app, move |p| {
        let port = p.open_tunnel(&pc)?;
        Ok(serde_json::json!({"ok": true, "port": port}))
    })
    .await
}

#[tauri::command]
pub async fn homelink_close_tunnel() -> String {
    if let Some(c) = CLIENT.get() {
        c.close_tunnel();
    }
    serde_json::json!({"ok": true}).to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn errors_come_back_as_json() {
        let text = super::fail("Could not reach the PC");
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["ok"], false);
        assert_eq!(v["error"], "Could not reach the PC");
    }

    #[test]
    fn the_key_is_kept_as_hex_and_read_back_exactly() {
        let key: [u8; 32] = std::array::from_fn(|i| (i * 7) as u8);
        assert_eq!(super::from_hex(&super::to_hex(&key)), Some(key));
        assert_eq!(super::from_hex(&format!(" {}\n", super::to_hex(&key))), Some(key));
        assert_eq!(super::from_hex("abc"), None);
        assert_eq!(super::from_hex(&"zz".repeat(32)), None);
        assert_eq!(super::from_hex(&"é".repeat(32)), None);
    }
}
