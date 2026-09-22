//! One file lock per application data root. The file is never unlinked: doing
//! so would allow two processes to lock different inodes for the same grant.
use fs2::FileExt;
use std::{
    fs::{File, OpenOptions},
    path::Path,
    time::{Duration, Instant},
};

pub(crate) fn acquire(instance: &str) -> Result<File, &'static str> {
    let root = Path::new(instance);
    if !root.is_absolute() || !root.is_dir() {
        return Err("invalid_credential_scope");
    }
    let path = root.join(".market-auth.lock");
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("invalid_credential_lock");
    }
    let file = options
        .open(path)
        .map_err(|_| "credential_lock_unavailable")?;
    if !file
        .metadata()
        .map_err(|_| "credential_lock_unavailable")?
        .is_file()
    {
        return Err("invalid_credential_lock");
    }
    let start = Instant::now();
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(file),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if start.elapsed() >= Duration::from_secs(10) {
                    return Err("credential_operation_busy");
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return Err("credential_lock_unavailable"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn competing_owners_share_one_lock_and_release_on_drop() {
        let root = std::env::temp_dir().join(format!(
            "market-lock-{}-{}",
            std::process::id(),
            crate::random_nonce()
        ));
        std::fs::create_dir(&root).unwrap();
        let first = acquire(root.to_str().unwrap()).unwrap();
        let second = OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join(".market-auth.lock"))
            .unwrap();
        assert_eq!(
            second.try_lock_exclusive().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        drop(first);
        second.try_lock_exclusive().unwrap();
        drop(second);
        std::fs::remove_dir_all(root).unwrap();
    }
}
