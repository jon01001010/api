//! The PC's NPU (the processor's AI engine), found without admin rights and
//! without running any command: on Windows from the device list (SetupAPI:
//! "Neural processors" / ComputeAccelerator devices and known PCI IDs), on
//! Linux from sysfs. Read-only: nothing runs on the NPU yet. Never fails:
//! anything unreadable means "none found".

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Npu {
    /// "AMD", "Intel", "Qualcomm" or "unknown".
    pub vendor: String,
    pub name: String,
    /// Its driver is installed and working (Windows: the device started;
    /// Linux: the NPU driver is bound and `/dev/accel/accelN` opens).
    pub driver_ok: bool,
    /// How it was found: "pci-id", "device-class" or "sysfs".
    pub how: String,
}

/// Known NPU PCI IDs (vendor, device) and their names.
const KNOWN: &[(u16, u16, &str, &str)] = &[
    (0x1022, 0x1502, "AMD", "AMD Ryzen AI (XDNA)"),
    (0x1022, 0x17F0, "AMD", "AMD Ryzen AI (XDNA 2)"),
    (0x8086, 0x7D1D, "Intel", "Intel AI Boost (Core Ultra)"),
    (0x8086, 0xAD1D, "Intel", "Intel AI Boost (Core Ultra)"),
    (0x8086, 0x643E, "Intel", "Intel AI Boost (Core Ultra)"),
    (0x8086, 0xB03E, "Intel", "Intel AI Boost (Core Ultra)"),
];

/// A known NPU by its PCI vendor and device ID.
pub fn known(vendor: u16, device: u16) -> Option<(&'static str, &'static str)> {
    KNOWN
        .iter()
        .find(|k| k.0 == vendor && k.1 == device)
        .map(|k| (k.2, k.3))
}

/// Vendor and device from a Windows hardware ID
/// ("PCI\VEN_1022&DEV_17F0&SUBSYS_…"), any letter case.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_hardware_id(id: &str) -> Option<(u16, u16)> {
    let up = id.to_ascii_uppercase();
    let hex = |key: &str| -> Option<u16> {
        let at = up.find(key)? + key.len();
        u16::from_str_radix(up.get(at..at + 4)?, 16).ok()
    };
    Some((hex("VEN_")?, hex("DEV_")?))
}

/// The vendor by PCI vendor ID, or by a name/ID that says it.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn vendor_of(pci_vendor: Option<u16>, text: &str) -> &'static str {
    match pci_vendor {
        Some(0x1022) | Some(0x1002) => return "AMD",
        Some(0x8086) => return "Intel",
        Some(0x17CB) | Some(0x5143) => return "Qualcomm",
        _ => {}
    }
    let t = text.to_ascii_lowercase();
    if t.contains("amd") || t.contains("ryzen") || t.contains("xdna") {
        "AMD"
    } else if t.contains("intel") {
        "Intel"
    } else if t.contains("qualcomm") || t.contains("qcom") || t.contains("hexagon") {
        "Qualcomm"
    } else {
        "unknown"
    }
}

/// One Windows device: is it an NPU? `class` is its setup class name,
/// `ids` its hardware IDs, `name` its friendly name or description.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn from_windows_device(class: &str, ids: &[String], name: &str, started: bool) -> Option<Npu> {
    let pci = ids.iter().find_map(|id| parse_hardware_id(id));
    if let Some((v, d)) = pci {
        if let Some((vendor, known_name)) = known(v, d) {
            return Some(Npu {
                vendor: vendor.into(),
                name: if name.is_empty() {
                    known_name.into()
                } else {
                    name.into()
                },
                driver_ok: started,
                how: "pci-id".into(),
            });
        }
    }
    if !class.eq_ignore_ascii_case("ComputeAccelerator") {
        return None;
    }
    let text = format!("{name} {}", ids.join(" "));
    Some(Npu {
        vendor: vendor_of(pci.map(|p| p.0), &text).into(),
        name: if name.is_empty() {
            "Neural processor".into()
        } else {
            name.into()
        },
        driver_ok: started,
        how: "device-class".into(),
    })
}

/// A Linux accel device by its driver name and PCI IDs (sysfs `vendor` /
/// `device` files hold "0x1022").
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn from_linux_accel(
    driver: Option<&str>,
    vendor: Option<u16>,
    device: Option<u16>,
    opens: bool,
) -> Option<Npu> {
    let by_id = vendor.zip(device).and_then(|(v, d)| known(v, d));
    let by_driver = match driver {
        Some("amdxdna") => Some(("AMD", "AMD Ryzen AI (XDNA)")),
        Some("intel_vpu") => Some(("Intel", "Intel AI Boost (Core Ultra)")),
        Some("qcom_qaic") => Some(("Qualcomm", "Qualcomm Cloud AI")),
        _ => None,
    };
    let (vendor_name, name) = by_id.or(by_driver)?;
    Some(Npu {
        vendor: vendor_name.into(),
        name: name.into(),
        driver_ok: by_driver.is_some() && opens,
        how: "sysfs".into(),
    })
}

/// "0x1022\n" → 0x1022.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_sysfs_hex(text: &str) -> Option<u16> {
    let t = text.trim();
    u16::from_str_radix(t.strip_prefix("0x").unwrap_or(t), 16).ok()
}

#[cfg(target_os = "linux")]
fn detect_here() -> Vec<Npu> {
    use std::fs;
    use std::path::Path;
    let read_hex = |p: &Path| fs::read_to_string(p).ok().and_then(|t| parse_sysfs_hex(&t));
    let mut found = Vec::new();
    let mut seen_pci = Vec::new();
    if let Ok(entries) = fs::read_dir("/sys/class/accel") {
        for entry in entries.flatten() {
            let dev = entry.path().join("device");
            let driver = fs::read_link(dev.join("driver"))
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
            let vendor = read_hex(&dev.join("vendor"));
            let device = read_hex(&dev.join("device"));
            let node = Path::new("/dev/accel").join(entry.file_name());
            let opens = fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&node)
                .is_ok();
            if let Some(npu) = from_linux_accel(driver.as_deref(), vendor, device, opens) {
                if let Ok(real) = fs::canonicalize(&dev) {
                    seen_pci.push(real);
                }
                found.push(npu);
            }
        }
    }
    // A known NPU with no driver loaded has no accel entry: look on the PCI bus.
    if let Ok(entries) = fs::read_dir("/sys/bus/pci/devices") {
        for entry in entries.flatten() {
            let dev = entry.path();
            let (Some(v), Some(d)) = (read_hex(&dev.join("vendor")), read_hex(&dev.join("device")))
            else {
                continue;
            };
            let Some((vendor, name)) = known(v, d) else {
                continue;
            };
            if fs::canonicalize(&dev).is_ok_and(|real| seen_pci.contains(&real)) {
                continue;
            }
            found.push(Npu {
                vendor: vendor.into(),
                name: name.into(),
                driver_ok: false,
                how: "pci-id".into(),
            });
        }
    }
    found
}

#[cfg(windows)]
fn detect_here() -> Vec<Npu> {
    use windows::core::PCWSTR;
    use windows::Win32::Devices::DeviceAndDriverInstallation::*;

    /// A device's text property (REG_SZ or REG_MULTI_SZ) as strings.
    unsafe fn property(
        set: HDEVINFO,
        info: &SP_DEVINFO_DATA,
        prop: SETUP_DI_REGISTRY_PROPERTY,
    ) -> Vec<String> {
        let mut buf = vec![0u8; 2048];
        let mut needed = 0u32;
        if unsafe {
            SetupDiGetDeviceRegistryPropertyW(
                set,
                info,
                prop,
                None,
                Some(&mut buf),
                Some(&mut needed),
            )
        }
        .is_err()
        {
            return Vec::new();
        }
        let len = (needed as usize).min(buf.len()) / 2;
        let wide: Vec<u16> = buf[..len * 2]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        wide.split(|&c| c == 0)
            .filter(|s| !s.is_empty())
            .map(String::from_utf16_lossy)
            .collect()
    }

    let mut found = Vec::new();
    unsafe {
        let Ok(set) =
            SetupDiGetClassDevsW(None, PCWSTR::null(), None, DIGCF_PRESENT | DIGCF_ALLCLASSES)
        else {
            return found;
        };
        let mut index = 0u32;
        loop {
            let mut info = SP_DEVINFO_DATA {
                cbSize: std::mem::size_of::<SP_DEVINFO_DATA>() as u32,
                ..Default::default()
            };
            if SetupDiEnumDeviceInfo(set, index, &mut info).is_err() {
                break;
            }
            index += 1;
            let class = property(set, &info, SPDRP_CLASS)
                .into_iter()
                .next()
                .unwrap_or_default();
            let ids = property(set, &info, SPDRP_HARDWAREID);
            let is_pci_npu = ids
                .iter()
                .filter_map(|id| parse_hardware_id(id))
                .any(|(v, d)| known(v, d).is_some());
            if !is_pci_npu && !class.eq_ignore_ascii_case("ComputeAccelerator") {
                continue;
            }
            let name = property(set, &info, SPDRP_FRIENDLYNAME)
                .into_iter()
                .next()
                .or_else(|| property(set, &info, SPDRP_DEVICEDESC).into_iter().next())
                .unwrap_or_default();
            let mut status = CM_DEVNODE_STATUS_FLAGS(0);
            let mut problem = CM_PROB(0);
            let started = CM_Get_DevNode_Status(&mut status, &mut problem, info.DevInst, 0)
                == CR_SUCCESS
                && problem.0 == 0
                && (status.0 & DN_STARTED.0) != 0;
            if let Some(npu) = from_windows_device(&class, &ids, &name, started) {
                found.push(npu);
            }
        }
        let _ = SetupDiDestroyDeviceInfoList(set);
    }
    found
}

#[cfg(not(any(windows, target_os = "linux")))]
fn detect_here() -> Vec<Npu> {
    Vec::new()
}

/// The PC's NPUs; empty when there is none or nothing could be read.
pub fn detect() -> Vec<Npu> {
    std::panic::catch_unwind(detect_here).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_windows_hardware_ids() {
        assert_eq!(
            parse_hardware_id(r"PCI\VEN_1022&DEV_17F0&SUBSYS_0F3C1043&REV_10"),
            Some((0x1022, 0x17F0))
        );
        assert_eq!(
            parse_hardware_id(r"pci\ven_8086&dev_7d1d"),
            Some((0x8086, 0x7D1D))
        );
        assert_eq!(parse_hardware_id(r"ACPI\QCOM0D0A"), None);
        assert_eq!(parse_hardware_id(r"PCI\VEN_10DE&DEV_1B"), None);
    }

    #[test]
    fn knows_the_npus() {
        assert_eq!(known(0x1022, 0x1502).unwrap().0, "AMD");
        assert_eq!(known(0x1022, 0x17F0).unwrap().0, "AMD");
        for d in [0x7D1D, 0xAD1D, 0x643E, 0xB03E] {
            assert_eq!(known(0x8086, d).unwrap().0, "Intel");
        }
        // A graphics card is not an NPU.
        assert_eq!(known(0x10DE, 0x1B81), None);
    }

    #[test]
    fn windows_devices() {
        let ids = vec![r"PCI\VEN_1022&DEV_17F0&SUBSYS_0F3C1043".to_string()];
        let npu = from_windows_device(
            "ComputeAccelerator",
            &ids,
            "NPU Compute Accelerator Device",
            true,
        )
        .unwrap();
        assert_eq!(
            (npu.vendor.as_str(), npu.how.as_str(), npu.driver_ok),
            ("AMD", "pci-id", true)
        );
        assert_eq!(npu.name, "NPU Compute Accelerator Device");
        // Known ID with no driver: in "Other devices", not started, no name.
        let bare = from_windows_device("", &ids, "", false).unwrap();
        assert_eq!(
            (bare.name.as_str(), bare.driver_ok),
            ("AMD Ryzen AI (XDNA 2)", false)
        );
        // Unknown ID but in the Neural processors class.
        let q = from_windows_device(
            "ComputeAccelerator",
            &[r"ACPI\QCOM0D0A".to_string()],
            "Snapdragon(R) X Elite - X1E80100 - Qualcomm(R) Hexagon(TM) NPU",
            true,
        )
        .unwrap();
        assert_eq!(
            (q.vendor.as_str(), q.how.as_str()),
            ("Qualcomm", "device-class")
        );
        // Anything else is not an NPU.
        let gpu = vec![r"PCI\VEN_10DE&DEV_1B81".to_string()];
        assert_eq!(
            from_windows_device("Display", &gpu, "NVIDIA GeForce GTX 1070", true),
            None
        );
    }

    #[test]
    fn linux_accel_devices() {
        let amd = from_linux_accel(Some("amdxdna"), Some(0x1022), Some(0x17F0), true).unwrap();
        assert_eq!(
            (amd.vendor.as_str(), amd.driver_ok, amd.how.as_str()),
            ("AMD", true, "sysfs")
        );
        assert_eq!(amd.name, "AMD Ryzen AI (XDNA 2)");
        let intel = from_linux_accel(Some("intel_vpu"), None, None, false).unwrap();
        assert_eq!((intel.vendor.as_str(), intel.driver_ok), ("Intel", false));
        // Some other accelerator driver with an unknown ID: not reported.
        assert_eq!(
            from_linux_accel(Some("habanalabs"), Some(0x1da3), Some(0x1020), true),
            None
        );
        assert_eq!(parse_sysfs_hex("0x1022\n"), Some(0x1022));
        assert_eq!(parse_sysfs_hex("0x17f0\r\n"), Some(0x17F0));
        assert_eq!(parse_sysfs_hex(""), None);
    }

    #[test]
    fn detect_never_fails() {
        let _ = detect();
    }
}
