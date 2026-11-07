//! The HTML preview on the desktop (rule 3 in SECURITY.md). The screens hand
//! over a finished preview page (already wrapped: policy first, guard
//! script, frame tags renamed) and get back a random id. The page is then
//! shown in a sandboxed frame from its own address, `pa-preview`, which is
//! not the app's: it gets no Tauri bridge (Tauri gives its secret call key
//! to the app's own page only), and every page is sent with a policy that
//! blocks all network use and keeps it sandboxed, whatever the page says.

use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::State;

/// The scheme the preview frame loads from.
pub const SCHEME: &str = "pa-preview";

/// Sent with every preview page. The same rules as the phone's preview,
/// plus `sandbox allow-scripts`: its own scripts run (clocks, games), but it
/// has no origin, no pop-ups, forms, downloads or storage.
pub const PREVIEW_POLICY: &str = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; \
style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; \
connect-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; \
form-action 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; \
sandbox allow-scripts";

/// Only the last few pages are kept (a chat shows a handful at a time).
const KEEP: usize = 24;
/// Bigger pages are refused (a model's page is a few KB).
const MAX_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct Previews(pub Mutex<VecDeque<(String, String)>>);

fn random_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

impl Previews {
    pub fn put(&self, page: String) -> Result<String, String> {
        if page.len() > MAX_BYTES {
            return Err("This page is too big to preview".into());
        }
        let id = random_id()?;
        let mut pages = self.0.lock().unwrap();
        pages.push_back((id.clone(), page));
        while pages.len() > KEEP {
            pages.pop_front();
        }
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Option<String> {
        let pages = self.0.lock().unwrap();
        pages.iter().find(|(i, _)| i == id).map(|(_, p)| p.clone())
    }
}

/// Stores a preview page and returns its id.
#[tauri::command(async)]
pub fn preview_put(previews: State<'_, Previews>, page: String) -> Result<String, String> {
    previews.put(page)
}

/// Answers `pa-preview://localhost/<id>` (on Windows
/// `http://pa-preview.localhost/<id>`).
pub fn respond(previews: &Previews, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/');
    let page = if request.method() == "GET" && id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit()) {
        previews.get(id)
    } else {
        None
    };
    let (status, body) = match page {
        Some(page) => (StatusCode::OK, page.into_bytes()),
        None => (StatusCode::NOT_FOUND, Vec::new()),
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CONTENT_SECURITY_POLICY, PREVIEW_POLICY)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .body(body)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(previews: &Previews, path: &str) -> Response<Vec<u8>> {
        let request = Request::builder()
            .uri(format!("pa-preview://localhost{path}"))
            .body(Vec::new())
            .unwrap();
        respond(previews, &request)
    }

    #[test]
    fn a_stored_page_is_served_with_the_locked_policy() {
        let previews = Previews::default();
        let id = previews.put("<p>hi</p>".into()).unwrap();
        let response = get(&previews, &format!("/{id}"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), b"<p>hi</p>");
        let policy = response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(policy.contains("default-src 'none'"));
        assert!(policy.contains("connect-src 'none'"));
        assert!(policy.contains("frame-src 'none'"));
        assert!(policy.ends_with("sandbox allow-scripts"));
    }

    #[test]
    fn unknown_or_odd_ids_get_nothing() {
        let previews = Previews::default();
        previews.put("x".into()).unwrap();
        for path in ["/", "/abc", "/../secret", &format!("/{}", "g".repeat(32))] {
            let response = get(&previews, path);
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            assert!(response.body().is_empty());
            // Even an empty answer carries the policy.
            assert!(response.headers().contains_key(header::CONTENT_SECURITY_POLICY));
        }
    }

    #[test]
    fn only_the_last_pages_are_kept_and_big_ones_refused() {
        let previews = Previews::default();
        let first = previews.put("first".into()).unwrap();
        for _ in 0..KEEP {
            previews.put("more".into()).unwrap();
        }
        assert!(previews.get(&first).is_none());
        assert!(previews.put("x".repeat(MAX_BYTES + 1)).is_err());
    }
}
