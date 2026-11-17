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
//!
//! One key per PC (device-circle stage 1, docs/design/device-circle.md): a
//! PC is the same key as a device as it is as a home PC, on the very same
//! endpoint (link.rs device_endpoint). A PC that already had its own
//! device key ("client key") keeps using it until the user chooses "Use one
//! key for this PC" (link_use_one_key); its pairings as a device are then
//! made again by hand (owner's decision 8b: no automatic move). The old key
//! stays in the store, unused.

use std::sync::{Arc, Mutex};

use homelink::Phone;
use serde::Serialize;
use tauri::AppHandle;

static CLIENT: Mutex<Option<Arc<Phone>>> = Mutex::new(None);

/// This PC's own key as the other end (before one key per PC), kept where
/// the screens can't read or write it, like the link key (link.rs
/// read_entry: Credential Manager on Windows, a private file on Linux).
const CLIENT_KEY_ENTRY: &str = "DesktopAgent-link:client-key";
/// "on" once the user chose "Use one key for this PC" (kept like the keys).
const ONE_KEY_ENTRY: &str = "DesktopAgent-link:one-key";

/// Which key this PC uses as a device: its link key when the user chose one
/// key, or when it never had a device key of its own (new installs). A PC
/// with its own device key keeps it: nothing moves by itself.
pub fn uses_link_key(one_key: Option<&str>, has_own_key: bool) -> bool {
    one_key.map(str::trim) == Some("on") || !has_own_key
}

// Kept for the tests (and a later key move); nothing writes a key file now.
#[cfg_attr(not(test), allow(dead_code))]
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

/// The device key this PC had before one key per PC, if any. New ones are
/// no longer made.
fn own_key(app: &AppHandle) -> Result<Option<[u8; 32]>, String> {
    if let Some(key) = crate::link::read_entry(app, CLIENT_KEY_ENTRY).and_then(|t| from_hex(&t)) {
        return Ok(Some(key));
    }
    // Before 2026-11-15 the key was a file in the settings folder
    // (app_config_dir/link/client.key), moved from there on first use.
    // That folder is the screens' own on Windows, so a key found there
    // could have been planted by them: since the security review of
    // 2026-11-17 it is never read (key material only from the Credential
    // Manager entry above). A PC that still had it there uses the one link
    // key instead; pair it again with the PCs that knew the old key.
    let _ = app;
    Ok(None)
}

/// The own device key while this PC still uses it; None: the link key.
fn own_key_in_use(app: &AppHandle) -> Result<Option<[u8; 32]>, String> {
    let one_key = crate::link::read_entry(app, ONE_KEY_ENTRY);
    if uses_link_key(one_key.as_deref(), true) {
        // Chosen: the old key is not even read.
        return Ok(None);
    }
    let own = own_key(app)?;
    Ok(if uses_link_key(one_key.as_deref(), own.is_some()) { None } else { own })
}

/// This PC's old device key while it still uses it (it signs removal
/// notices for the PCs that know this PC by it); None with one key.
pub fn device_key_in_use(app: &AppHandle) -> Option<iroh::SecretKey> {
    own_key_in_use(app).ok().flatten().map(|key| iroh::SecretKey::from_bytes(&key))
}

fn client_slot() -> std::sync::MutexGuard<'static, Option<Arc<Phone>>> {
    CLIENT.lock().unwrap_or_else(|e| e.into_inner())
}

fn client(app: &AppHandle) -> Result<Arc<Phone>, String> {
    let mut slot = client_slot();
    if let Some(c) = slot.as_ref() {
        return Ok(c.clone());
    }
    let made = Arc::new(match own_key_in_use(app)? {
        Some(key) => Phone::with_key(key, None)?,
        // One key: this PC's own link endpoint, so the relay and the other
        // PCs see one key, never two endpoints fighting over it.
        None => Phone::with_endpoint(tauri::async_runtime::block_on(crate::link::device_endpoint(app))?, None)?,
    });
    *slot = Some(made.clone());
    Ok(made)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyMode {
    /// This PC is one key in both roles.
    one_key: bool,
    /// This PC's key as a home PC (what its devices paired with).
    link_key: String,
    /// This PC's key as a device of another PC.
    device_key: String,
}

/// Which keys this PC uses (for "Your devices"). Reads only; no network.
#[tauri::command]
pub async fn link_key_mode(app: AppHandle) -> Result<KeyMode, String> {
    let link_key = crate::link::link_key_id(&app)?;
    let own = own_key_in_use(&app)?;
    Ok(KeyMode {
        one_key: own.is_none(),
        device_key: match own {
            Some(key) => iroh::SecretKey::from_bytes(&key).public().to_string(),
            None => link_key.clone(),
        },
        link_key,
    })
}

/// "Use one key for this PC": from now on this PC uses its link key as a
/// device too. Its pairings as a device (the PCs it uses) stop working and
/// are made again by hand, each asked on that PC as always; nothing moves
/// by itself (decision 8b). The old device key is kept, unused. No network.
#[tauri::command]
pub async fn link_use_one_key(app: AppHandle) -> Result<(), String> {
    crate::link::write_entry(&app, ONE_KEY_ENTRY, "on")?;
    if crate::link::read_entry(&app, ONE_KEY_ENTRY).as_deref().map(str::trim) != Some("on") {
        return Err("Could not keep the choice; nothing changed".into());
    }
    // The next link call makes the device end anew, on the link key.
    if let Some(old) = client_slot().take() {
        old.close_tunnel();
    }
    Ok(())
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
    let this = app.clone();
    answer(app, move |p| {
        let s = p.status(&pc)?;
        // Removal notices both ways (device circle stage 2, link.rs).
        crate::link::circle_round(&this, &p, &pc, &s.removals);
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
    if let Some(c) = client_slot().as_ref() {
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

    /// Device-circle stage 1 (decision 8b): one key for new PCs; a PC that
    /// has its own device key keeps it until the user chooses one key.
    #[test]
    fn a_pc_uses_its_link_key_as_a_device_unless_it_already_had_its_own() {
        use super::uses_link_key;
        // New install: no device key of its own, so the link key.
        assert!(uses_link_key(None, false));
        // Already paired as a device with its own key: kept, nothing moves.
        assert!(!uses_link_key(None, true));
        assert!(!uses_link_key(Some("off"), true));
        assert!(!uses_link_key(Some(""), true));
        assert!(!uses_link_key(Some("yes"), true));
        // Only after "Use one key for this PC".
        assert!(uses_link_key(Some("on"), true));
        assert!(uses_link_key(Some("on\r\n"), true));
        assert!(uses_link_key(Some("on"), false));
    }

    /// The one-key device end is the link endpoint itself, never a second
    /// endpoint made from the link key (two endpoints with one key push
    /// each other off the relay); and no new device keys are made.
    #[test]
    fn one_key_means_the_link_endpoint_itself() {
        let source = &include_str!("link_client.rs").replace("\r\n", "\n");
        let client = &source[source.find("fn client(app").unwrap()..];
        let client = &client[..client.find("#[derive(Serialize)]").unwrap()];
        assert!(client.contains("Phone::with_endpoint(tauri::async_runtime::block_on(crate::link::device_endpoint(app))?"));
        assert_eq!(client.matches("Phone::with_key(").count(), 1);
        assert!(client.contains("Some(key) => Phone::with_key(key, None)?"));
        let own = &source[source.find("fn own_key(app").unwrap()..source.find("fn own_key_in_use").unwrap()];
        assert!(!own.contains("generate()"));
        // Never from a file the screens can write (security review 2026-11-17).
        let code: String = own.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        assert!(!code.contains("std::fs::") && !code.contains("client.key") && !code.contains("app_config_dir"), "{own}");
        let link = &include_str!("link.rs").replace("\r\n", "\n");
        let device = &link[link.find("pub async fn device_endpoint").unwrap()..];
        let device = &device[..device.find("\n}").unwrap()];
        assert!(device.contains("bind(app, &mut running)"));
        assert!(!device.contains("Endpoint::builder"));
        // Switched off, the shared endpoint lets no device in.
        let bind = &link[link.find("async fn bind(").unwrap()..link.find("async fn start(").unwrap()];
        assert!(bind.contains("IncomingFilterOutcome::Reject"));
        assert!(bind.contains("endpoint.set_alpns(Vec::new())"));
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
