//! "The PC asks, the phone can answer" (TODO, decided 2026-11-08): while the
//! user allows it on this PC (off by default), each "Allow?" question is also
//! offered to paired devices, which show its exact text and can answer yes
//! or no. The PC's own dialog stays up; the first answer wins.
//!
//! - Only paired devices, over the encrypted home link (link.rs asks here).
//! - A question waits at most 2 minutes for a device; no answer means no
//!   (the PC's own dialog still decides then).
//! - A device answers only yes or no for that one question (never "always").
//! - Every answer from a device is logged on this PC with the device's name.

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

pub const WAIT: Duration = Duration::from_secs(120);

struct Pending {
    text: String,
    asked: Instant,
    tx: oneshot::Sender<(bool, String)>,
}

#[derive(Default)]
pub struct RemoteQuestions {
    allowed: AtomicBool,
    pending: Mutex<HashMap<u64, Pending>>,
    next: AtomicU64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: u64,
    pub text: String,
    pub seconds_left: u64,
}

impl RemoteQuestions {
    pub fn set_allowed(&self, allowed: bool) {
        self.allowed.store(allowed, Ordering::SeqCst);
        if !allowed {
            self.pending.lock().unwrap().clear();
        }
    }

    pub fn allowed(&self) -> bool {
        self.allowed.load(Ordering::SeqCst)
    }

    /// Offers a question to devices (if allowed). The receiver gets the
    /// first device answer: (yes, device name).
    pub fn open(&self, text: &str) -> Option<(u64, oneshot::Receiver<(bool, String)>)> {
        if !self.allowed() {
            return None;
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(
            id,
            Pending {
                text: text.to_string(),
                asked: Instant::now(),
                tx,
            },
        );
        Some((id, rx))
    }

    pub fn close(&self, id: u64) {
        self.pending.lock().unwrap().remove(&id);
    }

    /// The questions waiting (expired ones dropped).
    pub fn list(&self) -> Vec<Question> {
        let mut pending = self.pending.lock().unwrap();
        pending.retain(|_, p| p.asked.elapsed() < WAIT);
        let mut list: Vec<Question> = pending
            .iter()
            .map(|(id, p)| Question {
                id: *id,
                text: p.text.clone(),
                seconds_left: WAIT.saturating_sub(p.asked.elapsed()).as_secs(),
            })
            .collect();
        list.sort_by_key(|q| q.id);
        list
    }

    /// A device's answer; false if that question is gone (answered, expired).
    pub fn answer(&self, id: u64, yes: bool, device: &str) -> bool {
        let Some(p) = self.pending.lock().unwrap().remove(&id) else {
            return false;
        };
        if p.asked.elapsed() >= WAIT {
            return false;
        }
        p.tx.send((yes, device.to_string())).is_ok()
    }
}

/// Writes one line to this PC's log of answers given on devices.
pub fn log_answer(app: &AppHandle, device: &str, yes: bool, question: &str) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    let dir = dir.join("link");
    let _ = std::fs::create_dir_all(&dir);
    let first = question.lines().next().unwrap_or("").chars().take(160).collect::<String>();
    let when = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("answers.log"))
    {
        let _ = writeln!(
            f,
            "{when}\t{device}\t{}\t{first}",
            if yes { "allowed" } else { "not allowed" }
        );
    }
}

/// The PC's switch (Settings: home link card).
#[tauri::command(async)]
pub fn link_answers_allow(app: AppHandle, allowed: bool) {
    app.state::<RemoteQuestions>().set_allowed(allowed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_offered_until_allowed() {
        let q = RemoteQuestions::default();
        assert!(q.open("Run this?").is_none());
        q.set_allowed(true);
        let (id, _rx) = q.open("Run this?").unwrap();
        let list = q.list();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].id, list[0].text.as_str()), (id, "Run this?"));
        assert!(list[0].seconds_left <= 120 && list[0].seconds_left >= 118);
        // Switching it off drops what was waiting.
        q.set_allowed(false);
        assert!(q.list().is_empty());
    }

    #[test]
    fn the_first_answer_wins_once() {
        let q = RemoteQuestions::default();
        q.set_allowed(true);
        let (id, mut rx) = q.open("Open this file?").unwrap();
        assert!(q.answer(id, true, "Pixel"));
        assert_eq!(rx.try_recv().unwrap(), (true, "Pixel".to_string()));
        // A second answer (or one to an unknown question) is refused.
        assert!(!q.answer(id, false, "Laptop"));
        assert!(!q.answer(999, true, "Pixel"));
        assert!(q.list().is_empty());
    }

    #[test]
    fn a_question_closed_on_the_pc_is_gone_for_devices() {
        let q = RemoteQuestions::default();
        q.set_allowed(true);
        let (id, _rx) = q.open("x").unwrap();
        q.close(id);
        assert!(!q.answer(id, true, "Pixel"));
    }
}
