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

fn client(app: &AppHandle) -> Result<Arc<Phone>, String> {
    if let Some(c) = CLIENT.get() {
        return Ok(c.clone());
    }
    // Its own key, kept in the app's settings folder (not the PC's link key).
    let key = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("link")
        .join("client.key");
    let made = Arc::new(Phone::new(&key, None)?);
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
}
