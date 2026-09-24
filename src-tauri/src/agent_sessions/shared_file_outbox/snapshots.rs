//! Immutable first-capture receipts. Transport never reopens the source path.
use super::Candidate;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PENDING_BYTES: i64 = 256 * 1024 * 1024;

pub(super) fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cloud_file_snapshots (
          identity TEXT NOT NULL, org_id TEXT NOT NULL, session_id TEXT NOT NULL,
          path TEXT NOT NULL, revision TEXT NOT NULL, captured_at INTEGER NOT NULL,
          status TEXT NOT NULL, sha256 TEXT, size_bytes INTEGER NOT NULL DEFAULT 0,
          bytes BLOB,
          PRIMARY KEY(identity, org_id, session_id, path, revision)
        );
        CREATE TABLE IF NOT EXISTS cloud_file_snapshot_usage (
          id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL CHECK(bytes>=0)
        );
        INSERT OR IGNORE INTO cloud_file_snapshot_usage(id,bytes) VALUES(1,0);
        CREATE TRIGGER IF NOT EXISTS cloud_snapshot_insert AFTER INSERT ON cloud_file_snapshots
        WHEN NEW.bytes IS NOT NULL BEGIN
          UPDATE cloud_file_snapshot_usage SET bytes=bytes+NEW.size_bytes WHERE id=1;
        END;
        CREATE TRIGGER IF NOT EXISTS cloud_snapshot_update AFTER UPDATE OF bytes,size_bytes ON cloud_file_snapshots BEGIN
          UPDATE cloud_file_snapshot_usage SET bytes=bytes
            - CASE WHEN OLD.bytes IS NOT NULL THEN OLD.size_bytes ELSE 0 END
            + CASE WHEN NEW.bytes IS NOT NULL THEN NEW.size_bytes ELSE 0 END WHERE id=1;
        END;
        CREATE TRIGGER IF NOT EXISTS cloud_snapshot_delete AFTER DELETE ON cloud_file_snapshots
        WHEN OLD.bytes IS NOT NULL BEGIN
          UPDATE cloud_file_snapshot_usage SET bytes=bytes-OLD.size_bytes WHERE id=1;
        END;",
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: String,
    pub captured_at: Option<i64>,
    pub sha256: Option<String>,
    pub bytes_base64: Option<String>,
}

pub(super) fn exists(
    conn: &Connection,
    scope: &[&str; 3],
    file: &Candidate,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM cloud_file_snapshots
         WHERE identity=?1 AND org_id=?2 AND session_id=?3 AND path=?4 AND revision=?5)",
        params![scope[0], scope[1], scope[2], file.path, file.revision],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

/// All readers, including retry/restart, resolve the first committed receipt.
/// Missing/corrupt/released bytes never authorize a fallback to the source path.
pub(super) fn read(
    conn: &Connection,
    scope: &[&str; 3],
    file: &Candidate,
) -> Result<Snapshot, String> {
    let row = conn
        .query_row(
            "SELECT status, captured_at, sha256, bytes FROM cloud_file_snapshots
         WHERE identity=?1 AND org_id=?2 AND session_id=?3 AND path=?4 AND revision=?5",
            params![scope[0], scope[1], scope[2], file.path, file.revision],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<Vec<u8>>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((mut status, captured_at, hash, bytes)) = row else {
        return Ok(Snapshot {
            status: "not_captured".into(),
            captured_at: None,
            sha256: None,
            bytes_base64: None,
        });
    };
    let bytes_base64 = if let Some(bytes) = bytes {
        if hash.as_deref() != Some(format!("{:x}", Sha256::digest(&bytes)).as_str()) {
            status = "integrity_error".into();
            None
        } else {
            Some(base64::engine::general_purpose::STANDARD.encode(bytes))
        }
    } else {
        None
    };
    Ok(Snapshot {
        status,
        captured_at: Some(captured_at),
        sha256: hash,
        bytes_base64,
    })
}

pub(super) fn save(
    conn: &Connection,
    scope: &[&str; 3],
    file: &Candidate,
    capture: Result<Vec<u8>, &'static str>,
) -> Result<(), String> {
    let tx = database::begin_immediate(conn).map_err(|e| e.to_string())?;
    if exists(&tx, scope, file)? {
        return Ok(());
    }
    let (mut status, mut bytes) = match capture {
        Ok(bytes) => ("captured", Some(bytes)),
        Err(reason) => (reason, None),
    };
    let used: i64 = tx
        .query_row(
            "SELECT bytes FROM cloud_file_snapshot_usage WHERE id=1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if bytes
        .as_ref()
        .is_some_and(|b| used + b.len() as i64 > MAX_PENDING_BYTES)
    {
        status = "local_budget_exceeded";
        bytes = None;
    }
    let hash = bytes.as_ref().map(|b| format!("{:x}", Sha256::digest(b)));
    tx.execute(
        "INSERT INTO cloud_file_snapshots(identity,org_id,session_id,path,revision,captured_at,status,sha256,size_bytes,bytes)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![scope[0],scope[1],scope[2],file.path,file.revision,chrono::Utc::now().timestamp_millis(),status,hash,bytes.as_ref().map_or(0, |b| b.len() as i64),bytes],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub(super) fn release(conn: &Connection, identity: &str, id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE cloud_file_snapshots SET bytes=NULL, status='uploaded'
         WHERE identity=?1 AND (org_id,session_id,path,revision) IN
         (SELECT org_id,session_id,path,revision FROM cloud_file_outbox WHERE id=?2 AND identity=?1)",
        params![identity,id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Reject non-regular and oversized sources before any copying. An OS snapshot
/// is required: metadata comparisons alone cannot prove a coherent capture.
pub(super) fn capture(path: &str) -> Result<Vec<u8>, &'static str> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("invalid_source");
    }
    let meta = std::fs::metadata(path).map_err(|_| "source_unavailable")?;
    if !meta.is_file() {
        return Err("invalid_source");
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err("too_large");
    }
    let snapshot = platform_snapshot(path)?;
    let mut bytes = Vec::new();
    snapshot
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "source_unavailable")?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("too_large");
    }
    Ok(bytes)
}

#[cfg(target_os = "macos")]
fn platform_snapshot(path: &Path) -> Result<File, &'static str> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::{
        ffi::CString,
        os::unix::{ffi::OsStrExt, io::AsRawFd},
    };
    let source = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "source_unavailable")?;
    if !source
        .metadata()
        .map_err(|_| "source_unavailable")?
        .is_file()
    {
        return Err("invalid_source");
    }
    let directory = tempfile::tempdir().map_err(|_| "local_storage_unavailable")?;
    let destination = directory.path().join("capture");
    let target = CString::new(destination.as_os_str().as_bytes()).map_err(|_| "invalid_source")?;
    // SAFETY: source owns a live descriptor and target is a valid C string.
    // fclonefileat clones the opened inode, avoiding a path replacement race.
    let result =
        unsafe { libc::fclonefileat(source.as_raw_fd(), libc::AT_FDCWD, target.as_ptr(), 0) };
    if result != 0 {
        return Err("atomic_capture_unsupported");
    }
    File::open(destination).map_err(|_| "local_storage_unavailable")
    // The temporary name is removed here; the opened snapshot stays alive.
}

#[cfg(target_os = "linux")]
fn platform_snapshot(path: &Path) -> Result<File, &'static str> {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;
    let source = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "source_unavailable")?;
    if !source
        .metadata()
        .map_err(|_| "source_unavailable")?
        .is_file()
    {
        return Err("invalid_source");
    }
    let target = tempfile::tempfile().map_err(|_| "local_storage_unavailable")?;
    // FICLONE is an atomic CoW snapshot on supporting filesystems. Do not fall
    // back to an unverified streaming copy on ext4/cross-volume sources.
    // SAFETY: both descriptors are live and ioctl consumes no pointer argument.
    if unsafe {
        libc::ioctl(
            target.as_raw_fd(),
            0x40049409 as libc::c_ulong,
            source.as_raw_fd(),
        )
    } != 0
    {
        return Err("atomic_capture_unsupported");
    }
    Ok(target)
}

#[cfg(windows)]
fn platform_snapshot(path: &Path) -> Result<File, &'static str> {
    use std::os::windows::fs::OpenOptionsExt;
    // FILE_SHARE_READ excludes existing/new write and delete access for the
    // lifetime of this handle. An incompatible writer makes capture fail.
    let source = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(path)
        .map_err(|_| "source_busy_or_unavailable")?;
    if !source
        .metadata()
        .map_err(|_| "source_unavailable")?
        .is_file()
    {
        return Err("invalid_source");
    }
    Ok(source)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn platform_snapshot(_: &Path) -> Result<File, &'static str> {
    // No timestamp-only fallback: a platform capture provider must establish
    // coherence before this path can claim historical version semantics.
    Err("atomic_capture_unsupported")
}

#[cfg(test)]
mod tests;
