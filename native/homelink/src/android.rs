//! The Android door to the home link (class
//! `com.pocketagent.homelink.HomeLinkNative`). Every call answers with JSON
//! (`{"ok":true,...}` or `{"ok":false,"error":"..."}`), so nothing here can
//! crash the app. Calls wait on the network: Kotlin calls them off the main
//! thread.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, OnceLock};

use jni::objects::{JClass, JObject, JString};
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

/// Runs one call; any failure inside (a Rust panic) becomes an error answer
/// instead of closing the app.
fn guarded(f: impl FnOnce() -> serde_json::Value) -> serde_json::Value {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| fail("The home link hit an internal error"))
}

/// Set once: the Java runtime and the app's context, which iroh needs on
/// Android to read the phone's network and DNS settings.
static CONTEXT_READY: OnceLock<()> = OnceLock::new();

#[no_mangle]
pub extern "system" fn Java_com_pocketagent_homelink_HomeLinkNative_init(
    mut env: JNIEnv,
    _class: JClass,
    context: JObject,
) -> jstring {
    let value = guarded(|| {
        if CONTEXT_READY.get().is_some() {
            return serde_json::json!({"ok": true});
        }
        let vm = match env.get_java_vm() {
            Ok(vm) => vm,
            Err(e) => return fail(e),
        };
        // Kept for the life of the app, as iroh requires.
        let global = match env.new_global_ref(&context) {
            Ok(g) => g,
            Err(e) => return fail(e),
        };
        #[cfg(target_os = "android")]
        unsafe {
            iroh::dns::install_android_jni_context(
                vm.get_java_vm_pointer() as *mut std::ffi::c_void,
                global.as_obj().as_raw() as *mut std::ffi::c_void,
            );
        }
        std::mem::forget(global);
        std::mem::forget(vm);
        let _ = CONTEXT_READY.set(());
        serde_json::json!({"ok": true})
    });
    answer(&mut env, value)
}

fn phone(key_file: &str) -> Result<Arc<Phone>, String> {
    if CONTEXT_READY.get().is_none() {
        return Err("The home link was not set up (init)".into());
    }
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
    let value = guarded(|| match phone(&key_file).and_then(|p| p.pair(&qr, &name)) {
        Ok(pc) => serde_json::json!({"ok": true, "pc": pc}),
        Err(e) => fail(e),
    });
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
    let value = guarded(|| match phone(&key_file).and_then(|p| p.status(&pc)) {
        Ok(s) => serde_json::json!({
            "ok": true,
            "running": s.running,
            "apiKey": s.api_key,
            "events": s.events,
            "build": s.build,
            "lastModel": s.last_model,
            "route": s.route,
        }),
        Err(e) => fail(e),
    });
    answer(&mut env, value)
}

#[no_mangle]
pub extern "system" fn Java_com_pocketagent_homelink_HomeLinkNative_startModel(
    mut env: JNIEnv,
    _class: JClass,
    key_file: JString,
    pc: JString,
) -> jstring {
    let (key_file, pc) = (text(&mut env, &key_file), text(&mut env, &pc));
    let value = guarded(|| match phone(&key_file).and_then(|p| p.start_model(&pc)) {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => fail(e),
    });
    answer(&mut env, value)
}

#[no_mangle]
pub extern "system" fn Java_com_pocketagent_homelink_HomeLinkNative_sync(
    mut env: JNIEnv,
    _class: JClass,
    key_file: JString,
    pc: JString,
    body: JString,
) -> jstring {
    let (key_file, pc, body) = (text(&mut env, &key_file), text(&mut env, &pc), text(&mut env, &body));
    let value = guarded(|| match phone(&key_file).and_then(|p| p.sync(&pc, &body)) {
        // The PC's answer is JSON already; pass it on as it is.
        Ok(answer) => serde_json::from_str(&answer).unwrap_or_else(|_| fail("The PC's answer was not readable")),
        Err(e) => fail(e),
    });
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
    let value = guarded(|| match phone(&key_file).and_then(|p| p.open_tunnel(&pc)) {
        Ok(port) => serde_json::json!({"ok": true, "port": port}),
        Err(e) => fail(e),
    });
    answer(&mut env, value)
}

#[no_mangle]
pub extern "system" fn Java_com_pocketagent_homelink_HomeLinkNative_closeTunnel(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let value = guarded(|| {
        if let Some(p) = PHONE.get() {
            p.close_tunnel();
        }
        serde_json::json!({"ok": true})
    });
    answer(&mut env, value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failure_inside_becomes_an_error_not_a_crash() {
        let answer = guarded(|| panic!("something inside went wrong"));
        assert_eq!(answer["ok"], false);
        assert_eq!(answer["error"], "The home link hit an internal error");
    }
}
