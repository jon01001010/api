//! Whether the app is locked (the app PIN, src/services/appLock): the
//! screens say so with `app_set_locked` whenever it changes. While it is
//! locked, the native side
//! - holds every "Allow?" question (paired devices', in-flight runs', the
//!   screens'): it waits for the unlock for at most LOCKED_WAIT, then it is
//!   refused with LOCKED_REFUSAL (approval.rs). A question waiting for the
//!   unlock is not offered to paired devices either. Unlocking in time
//!   shows it as usual. Refused rather than held for ever: a device's
//!   request and a run must not hang while nobody is at the PC.
//! - says nothing in its notifications but BLANK_TITLE / BLANK_BODY (no
//!   question, device name, file name, prompt or thinking): `notify`.
//!
//! At start the state is not known yet: locked if the app PIN is on (its
//! record is in the key store, secrets.rs), else unlocked, so a PC without
//! the PIN never waits for the screens. With the PIN on, the screens report
//! "unlocked" after the PIN is entered; until then questions wait at most
//! LOCKED_WAIT each and are refused, so nothing can hang at start (the home
//! link itself never waits for this, only its questions do).

use std::sync::OnceLock;
use std::time::Duration;

use tauri::AppHandle;

/// Most time a question waits for the unlock before it is refused.
pub const LOCKED_WAIT: Duration = Duration::from_secs(30);
/// What the asker is told then.
pub const LOCKED_REFUSAL: &str = "The app is locked on the PC, so it couldn't ask there. Nothing was done.";
/// The only words of a notification while the app is locked.
pub const BLANK_TITLE: &str = "DesktopAgent: something needs your attention";
pub const BLANK_BODY: &str = "Unlock DesktopAgent to see it.";
/// The app PIN's entry in the key store (appLock.ts LOCK_SERVICE; a test
/// keeps them equal).
pub const LOCK_SERVICE: &str = "pocketagent-app-lock";

/// true: locked (or not known yet). Starts locked; `init` unlocks it at
/// once when the app PIN is off.
fn state() -> &'static tokio::sync::watch::Sender<bool> {
    static STATE: OnceLock<tokio::sync::watch::Sender<bool>> = OnceLock::new();
    STATE.get_or_init(|| tokio::sync::watch::channel(true).0)
}

/// At start (lib.rs setup): unlocked unless the app PIN is on, or its
/// record can't be read (then the screens decide).
pub fn init(app: &AppHandle) {
    if let Ok(None) = crate::secrets::read(app, LOCK_SERVICE) {
        set_locked(false);
    }
}

pub fn set_locked(locked: bool) {
    state().send_replace(locked);
}

pub fn is_locked() -> bool {
    *state().borrow()
}

/// Waits until the app is unlocked, at most `within`. True when unlocked.
pub async fn wait_unlocked(within: Duration) -> bool {
    let mut rx = state().subscribe();
    let unlocked = async move { rx.wait_for(|locked| !*locked).await.is_ok() };
    matches!(tokio::time::timeout(within, unlocked).await, Ok(true))
}

/// What a notification may say: blank while locked.
pub fn shown<'a>(locked: bool, title: &'a str, body: &'a str) -> (&'a str, &'a str) {
    if locked {
        (BLANK_TITLE, BLANK_BODY)
    } else {
        (title, body)
    }
}

/// Shows a notification; while the app is locked, only BLANK_TITLE /
/// BLANK_BODY.
pub fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let (title, body) = shown(is_locked(), title, body);
    let _ = app.notification().builder().title(title).body(body).show();
}

/// The screens tell whether the app is locked (app PIN): true when the PIN
/// screen is up, false once unlocked or when the PIN is off.
#[tauri::command]
pub async fn app_set_locked(locked: bool) -> Result<(), String> {
    set_locked(locked);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locked_notifications_say_nothing() {
        assert_eq!(shown(false, "Answered on Pixel", "Pixel allowed: read secret.txt"), ("Answered on Pixel", "Pixel allowed: read secret.txt"));
        let (title, body) = shown(true, "Answered on Pixel", "Pixel allowed: read secret.txt");
        assert_eq!((title, body), (BLANK_TITLE, BLANK_BODY));
        assert!(!format!("{title}{body}").contains("Pixel"));
    }

    #[test]
    fn the_lock_entry_is_the_apps() {
        let ts = include_str!("../../src/services/appLock/appLock.ts").replace("\r\n", "\n");
        assert!(ts.contains(&format!("const LOCK_SERVICE = '{LOCK_SERVICE}';")));
    }

    /// One test for the shared state (tests run in parallel).
    #[test]
    fn questions_wait_for_the_unlock_or_are_refused() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        rt.block_on(async {
            // Not known yet at start: locked.
            assert!(is_locked());
            let started = std::time::Instant::now();
            assert!(!wait_unlocked(Duration::from_millis(50)).await);
            assert!(started.elapsed() >= Duration::from_millis(50));
            // Unlocking releases a waiting question.
            let waiting = tokio::spawn(wait_unlocked(Duration::from_secs(5)));
            tokio::task::yield_now().await;
            set_locked(false);
            assert!(waiting.await.unwrap());
            assert!(wait_unlocked(Duration::from_millis(1)).await);
            app_set_locked(true).await.unwrap();
            assert!(is_locked());
            app_set_locked(false).await.unwrap();
            assert!(!is_locked());
        });
    }
}
