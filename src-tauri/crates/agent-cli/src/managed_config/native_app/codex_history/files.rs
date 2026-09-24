//! Bounded, byte-preserving access to vendor-owned rollouts. In particular a
//! paginated fork's history_base byte offsets must never be rewritten.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
};

const MAX_RECORD: usize = 8 * 1024 * 1024;
pub(super) const MAX_FILES: usize = 30_000;

pub(super) fn valid_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

pub(super) fn physical_id(path: &Path) -> Result<String, String> {
    path.file_stem()
        .and_then(|value| value.to_str())
        .and_then(|value| value.get(value.len().checked_sub(36)?..))
        .filter(|value| valid_id(value))
        .map(str::to_owned)
        .ok_or_else(|| "Invalid Codex physical rollout identity".into())
}

/// Reject links at every component, including a replaced ancestor. The caller
/// still owns the profile/configuration fence while committing the result.
pub(super) fn regular_path(path: &Path, missing: bool) -> Result<(), String> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Invalid Codex history path".into());
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("Codex history path is a symbolic link".into())
            }
            Ok(_) => {}
            Err(e) if missing && e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Cannot inspect Codex history path".into()),
        }
    }
    Ok(())
}

pub(super) fn relative_rollout(home: &Path, path: &Path) -> Result<PathBuf, String> {
    regular_path(path, false)?;
    let relative = path
        .strip_prefix(home)
        .map_err(|_| "Codex rollout escaped its home")?;
    if !matches!(relative.components().next(), Some(Component::Normal(v)) if v == "sessions" || v == "archived_sessions")
        || path.extension().is_none_or(|v| v != "jsonl")
        || !fs::metadata(path)
            .map_err(|_| "Missing Codex rollout")?
            .is_file()
    {
        return Err("Unsupported Codex rollout location or representation".into());
    }
    Ok(relative.to_path_buf())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Stamp {
    pub len: u64,
    modified_ns: u128,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    changed: (i64, i64),
}
impl Stamp {
    pub(super) fn modified_ns(&self) -> u128 {
        self.modified_ns
    }
    /// rename changes ctime on macOS without changing the staged inode or its
    /// bytes. Normal mutation comparisons still use full equality, including
    /// ctime; only recovery of our own journaled rename uses this identity.
    pub(super) fn published_from(&self, staged: &Self) -> bool {
        self.len == staged.len && self.modified_ns == staged.modified_ns && {
            #[cfg(unix)]
            {
                self.device == staged.device && self.inode == staged.inode
            }
            #[cfg(not(unix))]
            {
                false
            }
        }
    }
}
pub(super) fn stamp(path: &Path) -> Result<Stamp, String> {
    regular_path(path, false)?;
    let metadata = fs::metadata(path).map_err(|_| "Cannot inspect Codex rollout")?;
    if !metadata.is_file() {
        return Err("Codex rollout is not a regular file".into());
    }
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Ok(Stamp {
        len: metadata.len(),
        modified_ns: metadata
            .modified()
            .map_err(|_| "Cannot date Codex rollout")?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "Invalid Codex rollout date")?
            .as_nanos(),
        #[cfg(unix)]
        device: metadata.dev(),
        #[cfg(unix)]
        inode: metadata.ino(),
        #[cfg(unix)]
        changed: (metadata.ctime(), metadata.ctime_nsec()),
    })
}

pub(super) fn head(path: &Path) -> Result<Value, String> {
    let file = File::open(path).map_err(|_| "Cannot open Codex rollout")?;
    let mut first = Vec::new();
    BufReader::new(file)
        .take((MAX_RECORD + 1) as u64)
        .read_until(b'\n', &mut first)
        .map_err(|_| "Cannot read Codex rollout metadata")?;
    if first.len() > MAX_RECORD || !first.ends_with(b"\n") {
        return Err("Codex rollout metadata exceeds limit or is incomplete".into());
    }
    let value: Value =
        serde_json::from_slice(&first).map_err(|_| "Invalid Codex rollout metadata")?;
    if value["type"] != "session_meta" || !value["payload"]["id"].as_str().is_some_and(valid_id) {
        return Err("Unsupported Codex rollout metadata".into());
    }
    Ok(value)
}

pub(super) fn tail(path: &Path) -> Result<Value, String> {
    let mut file = File::open(path).map_err(|_| "Cannot open Codex rollout")?;
    let len = file
        .metadata()
        .map_err(|_| "Cannot inspect Codex rollout")?
        .len();
    let start = len.saturating_sub((MAX_RECORD + 1) as u64);
    file.seek(SeekFrom::Start(start))
        .map_err(|_| "Cannot seek Codex rollout")?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| "Cannot read Codex rollout tail")?;
    if !bytes.ends_with(b"\n") {
        return Err("Codex rollout has an incomplete last record".into());
    }
    let content = &bytes[..bytes.len() - 1];
    let offset = content
        .iter()
        .rposition(|v| *v == b'\n')
        .map_or(0, |i| i + 1);
    if (start != 0 && offset == 0) || content.len() - offset > MAX_RECORD {
        return Err("Codex rollout tail exceeds limit".into());
    }
    serde_json::from_slice(&content[offset..]).map_err(|_| "Invalid Codex rollout tail".into())
}

/// Interoperate with Codex's own cross-process lock protocol. Holding only
/// ORG2's lock would not protect a native GUI with a loaded thread.
pub(super) struct WriterLock {
    file: File,
}
impl WriterLock {
    pub fn acquire(home: &Path, id: &str) -> Result<Self, String> {
        if !valid_id(id) {
            return Err("Invalid Codex history identity".into());
        }
        let directory = home.join("thread-writer-locks");
        regular_path(&directory, true)?;
        fs::create_dir_all(&directory).map_err(|_| "Cannot create Codex writer lock directory")?;
        let open = |path: &Path| -> Result<File, String> {
            regular_path(path, true)?;
            OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(path)
                .map_err(|_| "Cannot open Codex writer lock".into())
        };
        let coordination = open(&directory.join(".coordination.lock"))?;
        coordination.try_lock_exclusive().map_err(|_| "busy")?;
        let file = open(&directory.join(format!("{id}.lock")))?;
        file.try_lock_exclusive().map_err(|_| "busy")?;
        Ok(Self { file })
    }
}
impl Drop for WriterLock {
    fn drop(&mut self) {
        // Leave the unlocked file to native's coordinated stale-lock cleanup;
        // deleting it without the coordination lock could admit two writers.
        let _ = FileExt::unlock(&self.file);
    }
}

pub(super) fn inventory(
    home: &Path,
) -> Result<std::collections::BTreeMap<String, PathBuf>, String> {
    inventory_with_check(home, &|| Ok(()))
}

pub(super) fn inventory_with_check(
    home: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<std::collections::BTreeMap<String, PathBuf>, String> {
    let mut result = std::collections::BTreeMap::new();
    let mut queue = vec![
        (home.join("sessions"), 0),
        (home.join("archived_sessions"), 0),
    ];
    let mut visited = 0;
    while let Some((directory, depth)) = queue.pop() {
        check()?;
        if !directory.exists() {
            continue;
        }
        regular_path(&directory, false)?;
        for entry in fs::read_dir(directory).map_err(|_| "Cannot enumerate Codex history")? {
            visited += 1;
            if visited % 64 == 0 {
                check()?;
            }
            if visited > MAX_FILES {
                return Err("Codex rollout inventory exceeds limit".into());
            }
            let entry = entry.map_err(|_| "Cannot enumerate Codex history")?;
            let kind = entry
                .file_type()
                .map_err(|_| "Cannot inspect Codex history entry")?;
            // A stray link is never followed. It only disqualifies the thread
            // whose catalog row points at it, not every fork in the home.
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if depth >= 4 {
                    return Err("Codex history directory exceeds depth limit".into());
                }
                queue.push((entry.path(), depth + 1));
            } else if kind.is_file() {
                let name = entry.file_name();
                let Some(stem) = name.to_str().and_then(|v| v.strip_suffix(".jsonl")) else {
                    continue;
                };
                if let Some(id) = stem
                    .get(stem.len().saturating_sub(36)..)
                    .filter(|v| valid_id(v))
                {
                    if result.insert(id.to_owned(), entry.path()).is_some() {
                        return Err("Codex rollout identity is ambiguous".into());
                    }
                }
            }
        }
    }
    Ok(result)
}

pub(super) fn sync_directory(path: &Path) -> Result<(), String> {
    regular_path(path, false)?;
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| "Cannot flush Codex history directory".into())
}

/// Make newly created directory entries durable before a journal can name them.
pub(super) fn create_directories(path: &Path) -> Result<(), String> {
    regular_path(path, true)?;
    let missing = path
        .ancestors()
        .take_while(|entry| !entry.exists())
        .map(Path::to_path_buf)
        .collect::<Vec<_>>();
    fs::create_dir_all(path).map_err(|_| "Cannot prepare Codex history directory")?;
    for directory in missing {
        sync_directory(&directory)?;
        if let Some(parent) = directory.parent() {
            sync_directory(parent)?;
        }
    }
    Ok(())
}

/// Only called for a changed, unlocked source. The staged copy has exactly the
/// inspected source length, so a growing external file cannot make this
/// endless or leak bytes past the inspected stamp.
pub(super) fn stage_with_check(
    source: &Path,
    destination: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<tempfile::NamedTempFile, String> {
    check()?;
    regular_path(source, false)?;
    regular_path(destination, true)?;
    let parent = destination.parent().ok_or("Missing Codex history parent")?;
    create_directories(parent)?;
    let mut file = File::open(source).map_err(|_| "Cannot open Codex rollout for copying")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot inspect Codex rollout for copying")?;
    if !metadata.is_file() {
        return Err("Codex rollout is not a regular file".into());
    }
    let length = metadata.len();
    let temporary = match clone_into(source, parent) {
        Some(cloned) => {
            check()?;
            let cloned_length = cloned
                .as_file()
                .metadata()
                .map_err(|_| "Cannot inspect staged Codex rollout")?
                .len();
            if cloned_length < length {
                return Err("Codex rollout changed while copying".into());
            }
            cloned
                .as_file()
                .set_len(length)
                .map_err(|_| "Cannot copy Codex rollout")?;
            cloned
        }
        None => copy_with_check(&mut file, length, parent, check)?,
    };
    check()?;
    app_paths::set_sensitive_file_permissions(temporary.path())
        .map_err(|_| "Cannot protect Codex history")?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "Cannot flush Codex history")?;
    check()?;
    Ok(temporary)
}

/// An APFS clone shares blocks with the source until either side writes, so a
/// multi-gigabyte history is staged without copying it. The clone is a
/// point-in-time snapshot of the whole file; the caller truncates it to the
/// inspected length. Any failure other than a name collision falls back to a
/// byte copy.
#[cfg(target_os = "macos")]
fn clone_into(source: &Path, parent: &Path) -> Option<tempfile::NamedTempFile> {
    use std::os::unix::ffi::OsStrExt;
    let source = std::ffi::CString::new(source.as_os_str().as_bytes()).ok()?;
    tempfile::Builder::new()
        .make_in(parent, |path| {
            let destination = std::ffi::CString::new(path.as_os_str().as_bytes())
                .map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
            // SAFETY: both arguments are valid NUL-terminated paths that outlive the call.
            if unsafe { libc::clonefile(source.as_ptr(), destination.as_ptr(), 0) } != 0 {
                return Err(std::io::Error::last_os_error());
            }
            OpenOptions::new().read(true).write(true).open(path)
        })
        .ok()
}
#[cfg(not(target_os = "macos"))]
fn clone_into(_: &Path, _: &Path) -> Option<tempfile::NamedTempFile> {
    None
}

/// Bounded memory and an owner fence between chunks, for filesystems without
/// cloning support.
fn copy_with_check(
    source: &mut File,
    length: u64,
    parent: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<tempfile::NamedTempFile, String> {
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Cannot stage Codex history")?;
    let mut remaining = length;
    let mut buffer = vec![0_u8; 1024 * 1024];
    while remaining > 0 {
        check()?;
        let count = remaining.min(buffer.len() as u64) as usize;
        source
            .read_exact(&mut buffer[..count])
            .map_err(|_| "Codex rollout changed while copying")?;
        check()?;
        temporary
            .write_all(&buffer[..count])
            .map_err(|_| "Cannot copy Codex rollout")?;
        remaining -= count as u64;
    }
    Ok(temporary)
}

pub(super) fn append(path: &Path, value: &Value) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|_| "Cannot append Codex history settings")?;
    serde_json::to_writer(&mut file, value).map_err(|_| "Cannot encode Codex history settings")?;
    file.write_all(b"\n")
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot flush Codex history settings".to_owned())
}

pub(super) fn alias_path(relative: &Path, alias: &str) -> Result<PathBuf, String> {
    let stem = relative
        .file_stem()
        .and_then(|v| v.to_str())
        .ok_or("Invalid Codex rollout filename")?;
    let split = stem
        .len()
        .checked_sub(36)
        .ok_or("Invalid Codex rollout filename")?;
    if !valid_id(&stem[split..])
        || !valid_id(alias)
        || &stem[split..] == alias
        || relative.extension().is_none_or(|v| v != "jsonl")
    {
        return Err("Invalid Codex rollout alias".into());
    }
    Ok(relative.with_file_name(format!("{}{alias}.jsonl", &stem[..split])))
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "11111111-1111-7111-8111-111111111111";
    #[test]
    fn native_writer_lock_blocks_a_second_owner_and_releases_without_unlink() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().canonicalize().unwrap();
        let first = WriterLock::acquire(&home, ID).unwrap();
        assert_eq!(
            WriterLock::acquire(&home, ID).err().as_deref(),
            Some("busy")
        );
        drop(first);
        assert!(WriterLock::acquire(&home, ID).is_ok());
    }
    #[test]
    fn tail_handles_large_history_without_reading_the_prefix() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("rollout.jsonl");
        let mut file = File::create(&path).unwrap();
        file.set_len(4 * 1024 * 1024 * 1024).unwrap();
        file.seek(SeekFrom::End(0)).unwrap();
        file.write_all(b"\n{\"ordinal\":999}\n").unwrap();
        assert_eq!(tail(&path).unwrap()["ordinal"], 999);
    }
    #[test]
    fn partial_tail_and_symlink_never_publish() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("rollout.jsonl");
        fs::write(&path, b"{\"ordinal\":2}").unwrap();
        assert!(tail(&path).is_err());
        #[cfg(unix)]
        {
            let link = root.path().join("link");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert!(regular_path(&link, false).is_err());
        }
    }
    #[cfg(unix)]
    #[test]
    fn inventory_skips_a_stray_link_without_losing_the_other_rollouts() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().canonicalize().unwrap();
        let day = home.join("sessions/2026/09/21");
        fs::create_dir_all(&day).unwrap();
        let real = day.join(format!("rollout-2026-09-21T00-00-00-{ID}.jsonl"));
        fs::write(&real, b"{}\n").unwrap();
        let linked = "22222222-2222-7222-8222-222222222222";
        std::os::unix::fs::symlink(
            &real,
            day.join(format!("rollout-2026-09-21T00-00-01-{linked}.jsonl")),
        )
        .unwrap();
        let inventory = inventory(&home).unwrap();
        assert_eq!(inventory.get(ID), Some(&real));
        assert!(!inventory.contains_key(linked));
    }
    #[test]
    fn recovery_recognizes_its_renamed_inode_but_not_a_later_append() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().canonicalize().unwrap();
        let staged = directory.join(".tmp-history");
        let target = directory.join("rollout.jsonl");
        fs::write(&staged, b"{\"ordinal\":1}\n").unwrap();
        let before = stamp(&staged).unwrap();
        fs::rename(&staged, &target).unwrap();
        assert!(stamp(&target).unwrap().published_from(&before));
        append(&target, &serde_json::json!({"ordinal": 2})).unwrap();
        assert!(!stamp(&target).unwrap().published_from(&before));
    }

    #[test]
    fn byte_copy_cancellation_is_bounded_and_removes_the_partial_file() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().canonicalize().unwrap();
        let source = directory.join("source.jsonl");
        File::create(&source)
            .unwrap()
            .set_len(8 * 1024 * 1024)
            .unwrap();
        let original = stamp(&source).unwrap();
        let checks = std::cell::Cell::new(0);
        let mut file = File::open(&source).unwrap();
        let result = copy_with_check(&mut file, original.len, &directory, &|| {
            checks.set(checks.get() + 1);
            if checks.get() == 3 {
                Err("owner retired".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(result.unwrap_err(), "owner retired");
        assert_eq!(checks.get(), 3);
        assert_eq!(stamp(&source).unwrap(), original);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        let mut file = File::open(&source).unwrap();
        let staged = copy_with_check(&mut file, original.len, &directory, &|| Ok(())).unwrap();
        assert_eq!(fs::metadata(staged.path()).unwrap().len(), original.len);
    }
    #[test]
    fn staging_snapshots_the_inspected_length_and_is_independent_of_the_source() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().canonicalize().unwrap();
        let source = directory.join("source.jsonl");
        let destination = directory.join("nested").join("destination.jsonl");
        fs::write(&source, b"{\"ordinal\":1}\n").unwrap();
        let original = stamp(&source).unwrap();
        let cancelled = stage_with_check(&source, &destination, &|| Err("owner retired".into()));
        assert_eq!(cancelled.unwrap_err(), "owner retired");
        let staged = stage_with_check(&source, &destination, &|| Ok(())).unwrap();
        assert_eq!(fs::metadata(staged.path()).unwrap().len(), original.len);
        assert_eq!(fs::read(staged.path()).unwrap(), b"{\"ordinal\":1}\n");
        append(&source, &serde_json::json!({"ordinal": 2})).unwrap();
        append(staged.path(), &serde_json::json!({"ordinal": 3})).unwrap();
        assert_eq!(
            fs::read(staged.path()).unwrap(),
            b"{\"ordinal\":1}\n{\"ordinal\":3}\n"
        );
        assert_eq!(
            fs::read(&source).unwrap(),
            b"{\"ordinal\":1}\n{\"ordinal\":2}\n"
        );
        assert_eq!(stamp(&source).unwrap().len, original.len * 2);
        let mode = {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::metadata(staged.path()).unwrap().permissions().mode() & 0o777
            }
            #[cfg(not(unix))]
            {
                0o600
            }
        };
        assert_eq!(mode, 0o600);
    }
}
