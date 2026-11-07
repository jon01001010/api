//! Start-up timing, to find where a slow start goes (seen on Windows: 45 s).
//! Times are milliseconds since the app process started.

use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use tauri::State;

pub struct Timing {
    pub started: Instant,
    pub marks: Mutex<StartupMarks>,
}

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupMarks {
    /// The window began loading the page.
    pub page_load_started_ms: Option<u128>,
    /// The page (HTML, the app's code file, fonts) finished loading.
    pub page_load_finished_ms: Option<u128>,
}

impl Timing {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            marks: Mutex::new(StartupMarks::default()),
        }
    }

    pub fn mark(&self, finished: bool) {
        let ms = self.started.elapsed().as_millis();
        let mut marks = self.marks.lock().unwrap();
        if finished {
            marks.page_load_finished_ms.get_or_insert(ms);
        } else {
            marks.page_load_started_ms.get_or_insert(ms);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupTiming {
    #[serde(flatten)]
    marks: StartupMarks,
    now_ms: u128,
}

#[tauri::command]
pub fn startup_timing(timing: State<'_, Timing>) -> StartupTiming {
    StartupTiming {
        marks: timing.marks.lock().unwrap().clone(),
        now_ms: timing.started.elapsed().as_millis(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_keep_the_first_time() {
        let t = Timing::new();
        t.mark(false);
        let first = t.marks.lock().unwrap().page_load_started_ms;
        std::thread::sleep(std::time::Duration::from_millis(5));
        t.mark(false);
        assert_eq!(t.marks.lock().unwrap().page_load_started_ms, first);
        assert!(t.marks.lock().unwrap().page_load_finished_ms.is_none());
    }
}
