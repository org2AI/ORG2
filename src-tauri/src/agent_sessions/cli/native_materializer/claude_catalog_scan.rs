//! One budget spans catalog enumeration, metadata reads and publication. The
//! Market path requires a complete inventory before choosing its recent window.
use super::*;
use std::{cell::Cell, time::Instant};

pub(super) struct CatalogScan {
    deadline: Option<Instant>,
    remaining: Cell<u64>,
}
impl CatalogScan {
    pub(super) fn standard() -> Self {
        Self {
            deadline: None,
            remaining: Cell::new(u64::MAX),
        }
    }
    #[cfg_attr(
        not(any(all(target_os = "macos", feature = "market-connect"), test)),
        allow(dead_code)
    )]
    pub(super) fn bounded(deadline: Instant) -> Self {
        Self {
            deadline: Some(deadline),
            remaining: Cell::new(16 * 1024 * 1024),
        }
    }
    pub(super) fn strict(&self) -> bool {
        self.deadline.is_some()
    }
    pub(super) fn check(&self, check: &impl Fn() -> Result<(), String>) -> Result<(), String> {
        check()?;
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            Err("claude_history_import_limit".into())
        } else {
            Ok(())
        }
    }
    fn failure<T>(&self, code: &str, fallback: T) -> Result<T, String> {
        if self.strict() {
            Err(code.into())
        } else {
            Ok(fallback)
        }
    }
    pub(super) fn entries(
        &self,
        root: &Path,
        remaining: &mut usize,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Vec<PathBuf>, String> {
        self.check(check)?;
        if self.strict() && fs::symlink_metadata(root).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("claude_history_catalog_changed".into());
        }
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return self.failure("claude_history_catalog_changed", Vec::new())
            }
            Err(_) => return self.failure("claude_history_catalog_changed", Vec::new()),
        };
        let mut paths = Vec::new();
        for entry in entries {
            self.check(check)?;
            if *remaining == 0 {
                return self.failure("claude_history_import_limit", paths);
            }
            *remaining -= 1;
            match entry {
                Ok(entry) => paths.push(entry.path()),
                Err(_) if self.strict() => return Err("claude_history_catalog_changed".into()),
                Err(_) => {}
            }
        }
        paths.sort();
        Ok(paths)
    }
    pub(super) fn row(
        &self,
        path: &Path,
        check: &impl Fn() -> Result<(), String>,
    ) -> Result<Option<Value>, String> {
        self.check(check)?;
        if path.file_name().and_then(|v| v.to_str()) == Some("scheduled-tasks.json") {
            return Ok(None);
        }
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            return Ok(None);
        }
        let before = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return self.failure("claude_history_catalog_changed", None),
        };
        if !before.is_file() {
            return self.failure("claude_history_catalog_changed", None);
        }
        if before.len() > CLAUDE_DESKTOP_METADATA_MAX_BYTES || before.len() > self.remaining.get() {
            return self.failure("claude_history_import_limit", None);
        }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        if self.strict() {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = match options.open(path) {
            Ok(file) => file,
            Err(_) => return self.failure("claude_history_catalog_changed", None),
        };
        let _opened = file
            .metadata()
            .map_err(|_| "claude_history_catalog_changed")?;
        #[cfg(unix)]
        if self.strict() {
            use std::os::unix::fs::MetadataExt;
            if before.dev() != _opened.dev()
                || before.ino() != _opened.ino()
                || before.nlink() != 1
                || before.uid() != unsafe { libc::geteuid() }
            {
                return Err("claude_history_catalog_changed".into());
            }
        }
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        loop {
            self.check(check)?;
            let count = file
                .read(&mut chunk)
                .map_err(|_| "claude_history_catalog_changed")?;
            if count == 0 {
                break;
            }
            let Some(remaining) = self.remaining.get().checked_sub(count as u64) else {
                return self.failure("claude_history_import_limit", None);
            };
            self.remaining.set(remaining);
            if bytes.len() + count > CLAUDE_DESKTOP_METADATA_MAX_BYTES as usize {
                return self.failure("claude_history_import_limit", None);
            }
            bytes.extend_from_slice(&chunk[..count]);
        }
        let after = file
            .metadata()
            .map_err(|_| "claude_history_catalog_changed")?;
        if self.strict()
            && (before.len() != after.len()
                || before.modified().ok() != after.modified().ok()
                || bytes.len() as u64 != before.len())
        {
            return Err("claude_history_catalog_changed".into());
        }
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(row) if row.is_object() => Ok(Some(row)),
            _ => self.failure("claude_history_catalog_unverified", None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn incomplete_inventory_is_an_error_instead_of_a_partial_recent_window() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("one.json"), b"{}").unwrap();
        fs::write(temp.path().join("two.json"), b"{}").unwrap();
        let scan = CatalogScan::bounded(Instant::now() + Duration::from_secs(5));
        assert_eq!(
            scan.entries(temp.path(), &mut 1, &|| Ok(())),
            Err("claude_history_import_limit".into())
        );
    }

    #[test]
    fn metadata_bytes_share_one_budget_across_rows() {
        let temp = tempfile::tempdir().unwrap();
        let one = temp.path().join("one.json");
        let two = temp.path().join("two.json");
        fs::write(&one, br#"{"x":1}"#).unwrap();
        fs::write(&two, br#"{"x":2}"#).unwrap();
        let scan = CatalogScan {
            deadline: Some(Instant::now() + Duration::from_secs(5)),
            remaining: Cell::new(12),
        };
        assert!(scan.row(&one, &|| Ok(())).unwrap().is_some());
        assert_eq!(
            scan.row(&two, &|| Ok(())),
            Err("claude_history_import_limit".into())
        );
    }

    #[test]
    fn expired_or_revoked_scan_never_reaches_metadata_read() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("not-created.json");
        assert_eq!(
            CatalogScan::bounded(Instant::now()).row(&path, &|| Ok(())),
            Err("claude_history_import_limit".into())
        );
        assert_eq!(
            CatalogScan::bounded(Instant::now() + Duration::from_secs(5))
                .row(&path, &|| Err("native_app_changed".into())),
            Err("native_app_changed".into())
        );
    }
}
