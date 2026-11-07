// The app's own commands are listed here so each one must also be allowed
// in capabilities/default.json (nothing is allowed by default).
const COMMANDS: &[&str] = &[
    "fs_exists",
    "fs_read",
    "fs_write",
    "fs_mkdir",
    "fs_list",
    "fs_stat",
    "fs_remove",
    "fs_copy",
    "fs_move",
    "secret_get",
    "secret_set",
    "secret_delete",
    "http_request",
    "http_abort",
    "pick_model_file",
    "model_server_start",
    "model_server_stop",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
