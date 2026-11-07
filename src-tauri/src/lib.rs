//! PocketAgent for Windows: the same app as on the phone, shown in Windows'
//! own web view. This native part does only what the screens can't do
//! themselves, each through a command listed in capabilities/default.json.
//! Anything outside the app's own folder asks the user first (approval.rs).

mod approval;
mod files;
mod model_server;
mod net;
mod secrets;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(net::Requests::default())
        .manage(model_server::ModelServer::default())
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
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            net::http_request,
            net::http_abort,
            model_server::pick_model_file,
            model_server::model_server_start,
            model_server::model_server_stop,
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
