//! PocketAgent for Windows: the same app as on the phone, shown in Windows'
//! own web view. This native part does only what the screens can't do
//! themselves, each through a command listed in capabilities/default.json.
//! Anything outside the app's own folder asks the user first (approval.rs).

mod approval;
mod docs;
mod download;
mod files;
#[cfg(feature = "link")]
mod link;
#[cfg(not(feature = "link"))]
#[path = "link_unavailable.rs"]
mod link;
mod model_server;
mod net;
mod open;
mod pc;
mod pc_extra;
mod preview;
mod profile;
mod remembered;
mod secrets;
mod system;
mod timing;
mod transfer;

use tauri::Manager;

#[cfg(feature = "link")]
fn link_state() -> link::Link {
    link::Link::default()
}
#[cfg(not(feature = "link"))]
fn link_state() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // The quick-chat key: registered only when switched on (pc_extra.rs).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Tray icon by the clock: open DesktopAgent, or quit.
        .setup(|app| {
            let _ = pc_extra::tray(app);
            Ok(())
        })
        .manage(timing::Timing::new())
        .manage(profile::StartupProfile::default())
        .on_page_load(|webview, payload| {
            let finished = matches!(payload.event(), tauri::webview::PageLoadEvent::Finished);
            webview.state::<timing::Timing>().mark(finished);
            if !finished {
                // Windows: where the page's time goes while it starts.
                profile::start(webview);
            }
        })
        .manage(net::Requests::default())
        .manage(model_server::ModelServer::default())
        .manage(download::Downloads::default())
        // HTML previews: their own address, sandboxed, no network (rule 3).
        .manage(preview::Previews::default())
        // Home link: off until the user switches it on (link.rs).
        .manage(link_state())
        .register_uri_scheme_protocol(preview::SCHEME, |ctx, request| {
            preview::respond(&ctx.app_handle().state::<preview::Previews>(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            files::fs_exists,
            files::fs_read,
            files::fs_write,
            files::fs_mkdir,
            files::fs_list,
            files::fs_stat,
            files::fs_remove,
            files::fs_copy,
            files::fs_move,
            docs::doc_to_text,
            download::fs_download,
            download::fs_download_cancel,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            net::http_request,
            net::http_abort,
            open::open_external,
            pc::pc_info,
            pc::run_command,
            pc::open_workspace_file,
            pc_extra::clipboard_read,
            pc_extra::notify,
            pc_extra::media_key,
            pc_extra::print_file,
            pc_extra::take_screenshot,
            pc_extra::quick_key_set,
            model_server::pick_model_file,
            model_server::model_server_start,
            model_server::model_server_stop,
            system::system_info,
            timing::startup_timing,
            transfer::pick_import_file,
            transfer::save_copy,
            preview::preview_put,
            link::link_pair,
            link::link_on,
            link::link_off,
            link::link_status,
            link::link_forget,
        ])
        .build(tauri::generate_context!())
        .expect("error while building PocketAgent");
    app.run(|handle, event| {
        // Never leave the model server running after the app closes.
        if let tauri::RunEvent::Exit = event {
            if let Some(mut running) = handle
                .state::<model_server::ModelServer>()
                .0
                .lock()
                .unwrap()
                .take()
            {
                let _ = running.child.kill();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    /// A plain (non-async) command runs on the window's main thread and
    /// freezes the whole window while it works (the 37 s Windows start).
    /// Every command must be `async` or `#[tauri::command(async)]`.
    #[test]
    fn no_command_blocks_the_main_thread() {
        let sources = [
            include_str!("files.rs"),
            include_str!("download.rs"),
            include_str!("secrets.rs"),
            include_str!("net.rs"),
            include_str!("model_server.rs"),
            include_str!("system.rs"),
            include_str!("timing.rs"),
            include_str!("docs.rs"),
            include_str!("transfer.rs"),
            include_str!("open.rs"),
            include_str!("pc.rs"),
            include_str!("pc_extra.rs"),
            include_str!("profile.rs"),
            include_str!("preview.rs"),
            include_str!("link.rs"),
            include_str!("link_unavailable.rs"),
        ];
        for source in sources {
            let lines: Vec<&str> = source.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if line.trim() == "#[tauri::command]" {
                    // The function line (skipping other attributes).
                    let next = lines[i + 1..]
                        .iter()
                        .find(|l| !l.trim_start().starts_with("#["))
                        .copied()
                        .unwrap_or("");
                    assert!(
                        next.contains("async fn"),
                        "command runs on the main thread: {next}"
                    );
                }
            }
        }
    }
}
