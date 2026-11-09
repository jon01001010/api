//! Start-up CPU profile (Windows): which of the page's functions keep it
//! busy while it starts (the 39 s Windows start, one unbroken task in the
//! app's own code). WebView2's own profiler (the one Edge's developer tools
//! use) samples the page from when it starts loading until 60 s after; the
//! Start-up time card then lists where the time went. Nothing leaves the PC:
//! the full profile is kept next to the app's settings as
//! `startup-profile.cpuprofile` (it opens in Edge's developer tools).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

/// How long after the page starts loading the profile is stopped.
#[cfg(windows)]
const PROFILE_FOR: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Default)]
pub struct StartupProfile(pub Mutex<Option<ProfileSummary>>);

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hot {
    /// Function name (short in the shipped app), or what the time was.
    pub name: String,
    /// Where it is: file:line:column (columns map back to the source).
    pub place: String,
    pub ms: f64,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    /// Busy time sampled (everything but idle).
    pub busy_ms: f64,
    pub garbage_collector_ms: f64,
    /// Time in the browser itself, outside the page's code.
    pub program_ms: f64,
    /// Most time in the function itself.
    pub top_self: Vec<Hot>,
    /// Most time in the function and everything it called.
    pub top_total: Vec<Hot>,
    /// Why there is no profile, if there is none.
    pub error: Option<String>,
}

fn place(frame: &Value) -> String {
    let url = frame["url"].as_str().unwrap_or("");
    let file = url.rsplit('/').next().unwrap_or("");
    if file.is_empty() {
        return String::new();
    }
    // The protocol counts from 0; editors and source maps from 1 (line).
    let line = frame["lineNumber"].as_i64().unwrap_or(-1) + 1;
    let column = frame["columnNumber"].as_i64().unwrap_or(-1) + 1;
    format!("{file}:{line}:{column}")
}

fn name(frame: &Value) -> String {
    match frame["functionName"].as_str().unwrap_or("") {
        "" => "(anonymous)".into(),
        n => n.chars().take(60).collect(),
    }
}

fn top(map: HashMap<(String, String), f64>, n: usize) -> Vec<Hot> {
    let mut list: Vec<Hot> = map
        .into_iter()
        .map(|((name, place), ms)| Hot { name, place, ms })
        .collect();
    list.sort_by(|a, b| b.ms.total_cmp(&a.ms));
    list.truncate(n);
    list
}

/// Reads a profile (the Chrome DevTools `Profiler.Profile` format).
pub fn summarize(profile: &Value) -> ProfileSummary {
    let nodes = profile["nodes"].as_array().cloned().unwrap_or_default();
    let samples = profile["samples"].as_array().cloned().unwrap_or_default();
    let deltas = profile["timeDeltas"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut by_id: HashMap<i64, &Value> = HashMap::new();
    let mut parent: HashMap<i64, i64> = HashMap::new();
    for node in &nodes {
        let id = node["id"].as_i64().unwrap_or(-1);
        by_id.insert(id, node);
        for child in node["children"].as_array().into_iter().flatten() {
            if let Some(c) = child.as_i64() {
                parent.insert(c, id);
            }
        }
    }
    let mut summary = ProfileSummary::default();
    let mut self_ms: HashMap<(String, String), f64> = HashMap::new();
    let mut total_ms: HashMap<(String, String), f64> = HashMap::new();
    for (i, sample) in samples.iter().enumerate() {
        // Each sample stands for the time until the next one (microseconds).
        let ms = deltas
            .get(i + 1)
            .and_then(|d| d.as_f64())
            .unwrap_or(0.0)
            .max(0.0)
            / 1000.0;
        let Some(id) = sample.as_i64() else { continue };
        let Some(node) = by_id.get(&id) else { continue };
        let frame = &node["callFrame"];
        match frame["functionName"].as_str().unwrap_or("") {
            "(idle)" | "(root)" => continue,
            "(garbage collector)" => summary.garbage_collector_ms += ms,
            "(program)" => summary.program_ms += ms,
            _ => {}
        }
        summary.busy_ms += ms;
        if !frame["functionName"]
            .as_str()
            .unwrap_or("")
            .starts_with('(')
        {
            *self_ms.entry((name(frame), place(frame))).or_default() += ms;
        }
        // Every function on the stack, once each (recursion counted once).
        let mut seen = std::collections::HashSet::new();
        let mut at = Some(id);
        while let Some(current) = at {
            if let Some(n) = by_id.get(&current) {
                let f = &n["callFrame"];
                let fname = f["functionName"].as_str().unwrap_or("");
                if !fname.starts_with('(') {
                    let key = (name(f), place(f));
                    if seen.insert(key.clone()) {
                        *total_ms.entry(key).or_default() += ms;
                    }
                }
            }
            at = parent.get(&current).copied();
        }
    }
    summary.top_self = top(self_ms, 10);
    summary.top_total = top(total_ms, 10);
    summary
}

/// Windows: starts the page's profiler when the page starts loading and
/// stops it a minute later. Elsewhere there is no such profiler (nothing).
#[cfg(windows)]
pub fn start(webview: &tauri::Webview) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Manager;
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = webview.with_webview(|platform| {
        for (method, params) in [
            ("Profiler.enable", "{}"),
            ("Profiler.setSamplingInterval", r#"{"interval":1000}"#),
            ("Profiler.start", "{}"),
        ] {
            let _ = devtools::call(&platform, method, params, |_| {});
        }
    });
    let webview = webview.clone();
    std::thread::spawn(move || {
        std::thread::sleep(PROFILE_FOR);
        let app = webview.app_handle().clone();
        let done = app.clone();
        let asked = webview.with_webview(move |platform| {
            let sent = devtools::call(&platform, "Profiler.stop", "{}", move |answer| {
                let app = done.clone();
                // Read it off the window's thread.
                std::thread::spawn(move || finish(&app, answer));
            });
            if let Err(e) = sent {
                keep(&app, Err(e));
            }
        });
        if let Err(e) = asked {
            keep(&webview.app_handle().clone(), Err(e.to_string()));
        }
    });
}

/// Elsewhere (Linux): no such profiler; the card says so instead of waiting.
#[cfg(not(windows))]
pub fn start(webview: &tauri::Webview) {
    use tauri::Manager;
    *webview.state::<StartupProfile>().0.lock().unwrap() = Some(ProfileSummary {
        error: Some("Windows only".into()),
        ..Default::default()
    });
}

#[cfg(windows)]
fn finish(app: &tauri::AppHandle, answer: Result<String, String>) {
    use tauri::Manager;
    let result = answer.and_then(|text| {
        let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let profile = &value["profile"];
        if let Ok(dir) = app.path().app_data_dir() {
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(dir.join("startup-profile.cpuprofile"), profile.to_string());
        }
        Ok(summarize(profile))
    });
    keep(app, result);
}

#[cfg(windows)]
fn keep(app: &tauri::AppHandle, result: Result<ProfileSummary, String>) {
    use tauri::Manager;
    let summary = result.unwrap_or_else(|error| ProfileSummary {
        error: Some(error),
        ..Default::default()
    });
    *app.state::<StartupProfile>().0.lock().unwrap() = Some(summary);
}

#[cfg(windows)]
mod devtools {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;

    /// One DevTools call on the page (must run on the window's thread).
    pub fn call(
        platform: &tauri::webview::PlatformWebview,
        method: &str,
        params: &str,
        on_answer: impl FnOnce(Result<String, String>) + 'static,
    ) -> Result<(), String> {
        let mut on_answer = Some(on_answer);
        unsafe {
            let webview = platform
                .controller()
                .CoreWebView2()
                .map_err(|e| e.to_string())?;
            let method = windows::core::HSTRING::from(method);
            let params = windows::core::HSTRING::from(params);
            webview
                .CallDevToolsProtocolMethod(
                    &method,
                    &params,
                    &CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                        move |error, answer| {
                            if let Some(f) = on_answer.take() {
                                f(error.map(|_| answer).map_err(|e| e.to_string()));
                            }
                            Ok(())
                        },
                    )),
                )
                .map_err(|e| e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame(name: &str, line: i64, column: i64) -> Value {
        json!({"functionName": name, "url": "http://tauri.localhost/bundle.js",
               "lineNumber": line, "columnNumber": column})
    }

    #[test]
    fn finds_the_busy_function_and_its_callers() {
        // root → render (1:10) → slow (1:99); plus idle and garbage collection.
        let profile = json!({
            "nodes": [
                {"id": 1, "callFrame": {"functionName": "(root)"}, "children": [2, 4, 5]},
                {"id": 2, "callFrame": frame("render", 0, 9), "children": [3]},
                {"id": 3, "callFrame": frame("slow", 0, 98)},
                {"id": 4, "callFrame": {"functionName": "(idle)"}},
                {"id": 5, "callFrame": {"functionName": "(garbage collector)"}},
            ],
            "samples": [3, 3, 3, 2, 4, 5, 3],
            "timeDeltas": [0, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
        });
        let s = summarize(&profile);
        assert_eq!(s.busy_ms, 6.0);
        assert_eq!(s.garbage_collector_ms, 1.0);
        assert_eq!(
            s.top_self[0],
            Hot {
                name: "slow".into(),
                place: "bundle.js:1:99".into(),
                ms: 4.0
            }
        );
        assert_eq!(s.top_total[0].name, "render");
        assert_eq!(s.top_total[0].ms, 5.0);
        assert!(s.top_total.iter().all(|h| !h.name.starts_with('(')));
        assert!(s.top_self.iter().all(|h| !h.name.starts_with('(')));
    }

    /// By hand: PROFILE=path/to.cpuprofile cargo test real_profile -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_profile() {
        let path = std::env::var("PROFILE").expect("PROFILE=file");
        let value: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        println!(
            "{}",
            serde_json::to_string_pretty(&summarize(&value)).unwrap()
        );
    }

    #[test]
    fn an_empty_profile_is_no_error() {
        let s = summarize(&json!({}));
        assert_eq!(s.busy_ms, 0.0);
        assert!(s.top_self.is_empty());
    }
}
