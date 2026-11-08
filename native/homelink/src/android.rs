//! The Android door to the home link (class
//! `com.pocketagent.homelink.HomeLinkNative`). Every call answers with JSON
//! (`{"ok":true,...}` or `{"ok":false,"error":"..."}`), so nothing here can
//! crash the app. Calls wait on the network: Kotlin calls them off the main
//! thread.

use std::sync::{Arc, OnceLock};

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;

use crate::Phone;

/// One phone per app (its key lives in the app's private folder).
static PHONE: OnceLock<Arc<Phone>> = OnceLock::new();

fn text(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s).map(|s| s.into()).unwrap_or_default()
}

fn answer(env: &mut JNIEnv, value: serde_json::Value) -> jstring {
    env.new_string(value.to_string())
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

fn fail(e: impl std::fmt::Display) -> serde_json::Value {
    serde_json::json!({"ok": false, "error": e.to_string()})
}

fn phone(key_file: &str) -> Result<Arc<Phone>, String> {
    if let Some(p) = PHONE.get() {
        return Ok(p.clone());
    }
    // TEST ONLY: where relays are out of reach, a test can give the PC's
    // address. Phones never set this; they dial the PC by its key.
    let hint = std::env::var("HOMELINK_PC_ADDR").ok().and_then(|a| a.parse().ok());
    let made = Arc::new(Phone::new(std::path::Path::new(key_file), hint)?);
    Ok(PHONE.get_or_init(|| made).clone())
}

#[no_mangle]
pub extern "system" fn Java_com_pocketagent_homelink_HomeLinkNative_pair(
    mut env: JNIEnv,
    _class: JClass,
    key_file: JString,
    qr: JString,
    name: JString,
) -> jstring {
    let (key_file, qr, name) = (text(&mut env, &key_file), text(&mut env, &qr), text(&mut env, &name));
    let result = phone(&key_file).and_then(|p| p.pair(&qr, &name));
    let value = match result {
        Ok(pc) => serde_json::json!({"ok": true, "pc": pc}),
        Err(e) => fail(e),
    };
    answer(&mut env, value)
}

#[no_mangle]
pub extern "system" fn Java_com_pocketagent_homelink_HomeLinkNative_status(
    mut env: JNIEnv,
    _class: JClass,
    key_file: JString,
    pc: JString,
) -> jstring {
    let (key_file, pc) = (text(&mut env, &key_file), text(&mut env, &pc));
    let value = match phone(&key_file).and_then(|p| p.status(&pc)) {
        Ok(s) => serde_json::json!({
            "ok": true,
            "running": s.running,
            "apiKey": s.api_key,
            "events": s.events,
        }),
        Err(e) => fail(e),
    };
    answer(&mut env, value)
}

#[no_mangle]
pub extern "system" fn Java_com_pocketagent_homelink_HomeLinkNative_openTunnel(
    mut env: JNIEnv,
    _class: JClass,
    key_file: JString,
    pc: JString,
) -> jstring {
    let (key_file, pc) = (text(&mut env, &key_file), text(&mut env, &pc));
    let value = match phone(&key_file).and_then(|p| p.open_tunnel(&pc)) {
        Ok(port) => serde_json::json!({"ok": true, "port": port}),
        Err(e) => fail(e),
    };
    answer(&mut env, value)
}

#[no_mangle]
pub extern "system" fn Java_com_pocketagent_homelink_HomeLinkNative_closeTunnel(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    if let Some(p) = PHONE.get() {
        p.close_tunnel();
    }
    answer(&mut env, serde_json::json!({"ok": true}))
}
