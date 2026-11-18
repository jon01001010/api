//! Owner-only files in the app's settings folder (Linux), for secrets the
//! app's screens must not reach: the link key and paired devices (link.rs)
//! and the screens' own keys and the app PIN record (secrets.rs).
//!
//! The kernel key store (keyring's `linux-native`) is not used for them: a
//! reboot clears it (keyring 3.6.3, src/keyutils.rs: "a reboot clears all
//! keyrings"), and an entry could get stuck so it could be neither read
//! nor written. Windows keeps them in Credential Manager instead.
//!
//! The settings folder (~/.config/<identifier>) is never the data folder
//! the screens' file commands reach (files.rs), nor inside it, nor around
//! it; the model's own reads and writes never reach ~/.config (outside.rs).
//! The folder is 0700, each file 0600, written whole through a temporary
//! file and a rename. The erase PIN removes the whole settings folder
//! (erase.rs).

use std::path::{Path, PathBuf};

/// `config/<sub>`, refused if the settings folder and the data folder are
/// the same, or one is inside the other.
pub fn private_dir(config: &Path, data: &Path, sub: &str) -> Result<PathBuf, String> {
    if config.starts_with(data) || data.starts_with(config) {
        return Err("No private folder for secrets on this system".into());
    }
    Ok(config.join(sub))
}

/// The file's text, None when it isn't there or can't be read.
pub fn read(file: &Path) -> Option<String> {
    std::fs::read_to_string(file).ok()
}

/// Writes the whole file, owner only (folder 0700, file 0600).
pub fn write(file: &Path, value: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let dir = file.parent().ok_or("Bad folder")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("new");
    // A leftover from an earlier write, perhaps with other permissions.
    let _ = std::fs::remove_file(&tmp);
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    out.write_all(value.as_bytes()).map_err(|e| e.to_string())?;
    out.sync_all().map_err(|e| e.to_string())?;
    drop(out);
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

/// Removes the file; not being there is fine.
pub fn remove(file: &Path) -> Result<(), String> {
    match std::fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn owner_only_and_never_in_the_screens_folder() {
        let home = std::env::temp_dir().join(format!("pa-private-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let config = home.join(".config/app.pocketagent.desktop");
        let data = home.join(".local/share/app.pocketagent.desktop");
        let dir = private_dir(&config, &data, "secrets").unwrap();
        assert!(dir.starts_with(&config) && !dir.starts_with(&data));
        // The same folder, or one inside the other: refused.
        assert!(private_dir(&data, &data, "x").is_err());
        assert!(private_dir(&data.join("cfg"), &data, "x").is_err());
        assert!(private_dir(&home, &data, "x").is_err());

        let file = dir.join("one");
        assert_eq!(read(&file), None);
        write(&file, "first").unwrap();
        write(&file, "second").unwrap();
        assert_eq!(read(&file).as_deref(), Some("second"));
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&file), 0o600);
        assert_eq!(mode(&dir), 0o700);
        assert!(!file.with_extension("new").exists());
        remove(&file).unwrap();
        remove(&file).unwrap();
        assert_eq!(read(&file), None);
        std::fs::remove_dir_all(&home).unwrap();
    }
}
