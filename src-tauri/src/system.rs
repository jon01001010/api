//! The PC's hardware, so the app can tell whether a model fits (the phone
//! gets these from Android): memory, processor cores, and graphics cards
//! with their own memory. Read fresh for every app start (a PC can get a new
//! card or more memory), never kept from an earlier day.

use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    /// Bytes.
    pub total_memory: u64,
    pub free_memory: u64,
    /// Built into the processor: its memory is the PC's own memory, so it
    /// is not counted again.
    pub shared: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    total_memory: u64,
    available_memory: u64,
    cpu_cores: usize,
    gpus: Vec<Gpu>,
}

fn memory() -> (u64, u64) {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    (sys.total_memory(), sys.available_memory())
}

/// A card built into the processor, by name (when Vulkan doesn't say).
fn looks_built_in(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let dedicated = n.contains("nvidia")
        || n.contains("radeon rx")
        || n.contains("radeon pro")
        || n.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| {
            w.len() == 4
                && (w.starts_with('a') || w.starts_with('b'))
                && w[1..].chars().all(|c| c.is_ascii_digit())
        });
    n.contains("graphics") && !dedicated
}

/// Reads llama.cpp's device list ("  Vulkan0: NAME (8192 MiB, 7800 MiB free)")
/// and Vulkan's own note on each card ("ggml_vulkan: 0 = NAME (…) | uma: 1"
/// means it uses the PC's memory).
pub fn parse_devices(text: &str) -> Vec<Gpu> {
    const MIB: u64 = 1024 * 1024;
    let mut uma = std::collections::HashMap::new();
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("ggml_vulkan: ") {
            if let (Some((index, _)), Some(pos)) = (rest.split_once(" = "), rest.find("uma: ")) {
                if let Ok(i) = index.trim().parse::<usize>() {
                    uma.insert(i, rest[pos + 5..].starts_with('1'));
                }
            }
        }
    }
    text.lines()
        .filter_map(|line| {
            let (id, rest) = line.trim().split_once(": ")?;
            let index = id
                .strip_prefix("Vulkan")
                .and_then(|i| i.parse::<usize>().ok());
            let open = rest.rfind(" (")?;
            let name = rest[..open].trim().to_string();
            let inside = rest[open + 2..].strip_suffix(')')?;
            let (total, free) = inside.split_once(", ")?;
            let total: u64 = total.strip_suffix(" MiB")?.trim().parse().ok()?;
            let free: u64 = free.strip_suffix(" MiB free")?.trim().parse().ok()?;
            let shared = index
                .and_then(|i| uma.get(&i).copied())
                .unwrap_or_else(|| looks_built_in(&name));
            Some(Gpu {
                name,
                total_memory: total * MIB,
                free_memory: free * MIB,
                shared,
            })
        })
        .collect()
}

/// Asks the bundled llama.cpp which graphics cards it can use (Vulkan).
fn list_devices(app: &AppHandle) -> Vec<Gpu> {
    let Ok(exe) = crate::model_server::server_exe(app) else {
        return Vec::new();
    };
    let mut command = Command::new(&exe);
    if let Some(dir) = exe.parent() {
        command.current_dir(dir);
    }
    command
        .arg("--list-devices")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // no console window
    }
    let Ok(mut child) = command.spawn() else {
        return Vec::new();
    };
    // A stuck graphics driver must not hold the app up.
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(20) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Vec::new();
            }
        }
    }
    let Ok(out) = child.wait_with_output() else {
        return Vec::new();
    };
    let text =
        String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    parse_devices(&text)
}

/// Graphics cards, read once per app start.
static GPUS: OnceLock<Vec<Gpu>> = OnceLock::new();

/// The graphics cards (read once per app start).
pub fn gpus(app: &AppHandle) -> Vec<Gpu> {
    GPUS.get_or_init(|| list_devices(app)).clone()
}

#[tauri::command(async)]
pub fn system_info(app: AppHandle) -> SystemInfo {
    let (total_memory, available_memory) = memory();
    SystemInfo {
        total_memory,
        available_memory,
        cpu_cores: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        gpus: gpus(&app),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_real_memory() {
        let (total, available) = memory();
        assert!(total > 0);
        assert!(available <= total);
    }

    #[test]
    fn reads_llama_cpps_device_list() {
        let text = "ggml_vulkan: Found 2 Vulkan devices:\n\
            Available devices:\n  \
            Vulkan0: NVIDIA GeForce GTX 1070 (8192 MiB, 7462 MiB free)\n  \
            Vulkan1: Intel(R) UHD Graphics 630 (8028 MiB, 8028 MiB free)\n";
        let gpus = parse_devices(text);
        assert_eq!(gpus.len(), 2);
        assert_eq!(gpus[0].name, "NVIDIA GeForce GTX 1070");
        assert_eq!(gpus[0].total_memory, 8192 * 1024 * 1024);
        assert_eq!(gpus[0].free_memory, 7462 * 1024 * 1024);
        assert!(!gpus[0].shared);
        // Built into the processor: its memory is the PC's own.
        assert!(gpus[1].shared);
        // Vulkan's own note wins over the name.
        let noted = parse_devices(
            "ggml_vulkan: 0 = AMD Radeon 780M (AMD) | uma: 1 | fp16: 1\n  \
             Vulkan0: AMD Radeon 780M (16384 MiB, 16000 MiB free)\n",
        );
        assert!(noted[0].shared);
        assert!(!looks_built_in("Intel(R) Arc(TM) A770 Graphics"));
        assert!(looks_built_in("Intel(R) Arc(TM) Graphics"));
        assert!(looks_built_in("AMD Radeon(TM) Graphics"));
        // No cards: nothing, not an error.
        assert!(parse_devices("Available devices:\n  (none)\n").is_empty());
    }
}
