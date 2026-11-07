//! PocketAgent for Windows: the same app as on the phone, shown in Windows'
//! own web view. This native part does only what the screens can't do
//! themselves, each through a command listed in capabilities/default.json.
//! Anything outside the app's own folder asks the user first (approval.rs).

mod approval;
mod download;
mod files;
mod model_server;
mod net;
mod preview;
mod secrets;
mod system;
mod timing;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(timing::Timing::new())
        .on_page_load(|webview, payload| {
            let finished = matches!(payload.event(), tauri::webview::PageLoadEvent::Finished);
            webview.state::<timing::Timing>().mark(finished);
        })
        .manage(net::Requests::default())
        .manage(model_server::ModelServer::default())
        .manage(download::Downloads::default())
        // HTML previews: their own address, sandboxed, no network (rule 3).
        .manage(preview::Previews::default())
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
            download::fs_download,
            download::fs_download_cancel,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            net::http_request,
            net::http_abort,
            model_server::pick_model_file,
            model_server::model_server_start,
            model_server::model_server_stop,
            system::system_info,
            timing::startup_timing,
            preview::preview_put,
        ])
        .build(tauri::generate_context!())
        .expect("error while building PocketAgent");
    app.run(|handle, event| {
        // Never leave the model server running after the app closes.
        if let tauri::RunEvent::Exit = event {
            if let Some(mut child) = handle
                .state::<model_server::ModelServer>()
                .0
                .lock()
                .unwrap()
                .take()
            {
                let _ = child.kill();
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
            include_str!("preview.rs"),
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
