//! The PC's real memory and processor count, so the app can tell whether a
//! model fits (the phone gets these from Android).

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    total_memory: u64,
    available_memory: u64,
    cpu_cores: usize,
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    SystemInfo {
        total_memory: sys.total_memory(),
        available_memory: sys.available_memory(),
        cpu_cores: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_real_memory() {
        let info = system_info();
        assert!(info.total_memory > 0);
        assert!(info.available_memory <= info.total_memory);
        assert!(info.cpu_cores >= 1);
    }
}
