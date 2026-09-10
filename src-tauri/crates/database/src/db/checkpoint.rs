//! Observable, protocol-safe SQLite WAL maintenance.
//!
//! WAL files are never deleted directly. Maintenance uses SQLite's checkpoint
//! protocol on a dedicated non-pooled connection after excluding in-process
//! writers. A busy reader is a normal, reported result: the WAL remains intact
//! and a later global tick or next startup can retry.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rusqlite::Connection;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WalCheckpointMode {
    Passive,
    Restart,
    Truncate,
}

impl WalCheckpointMode {
    fn pragma(self) -> &'static str {
        match self {
            Self::Passive => "PRAGMA wal_checkpoint(PASSIVE)",
            Self::Restart => "PRAGMA wal_checkpoint(RESTART)",
            Self::Truncate => "PRAGMA wal_checkpoint(TRUNCATE)",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalCheckpointReport {
    pub database_path: PathBuf,
    pub mode: WalCheckpointMode,
    pub busy: i64,
    pub log_frames: i64,
    pub checkpointed_frames: i64,
    pub wal_bytes_before: u64,
    pub wal_bytes_after: u64,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WalMaintenanceOutcome {
    BelowHighWater { wal_bytes: u64 },
    AlreadyRunning { wal_bytes: u64 },
    WriterBusy { wal_bytes: u64 },
    Checkpointed(WalCheckpointReport),
}

static SESSIONS_CHECKPOINT_RUNNING: AtomicBool = AtomicBool::new(false);

struct CheckpointSingleFlight;

impl Drop for CheckpointSingleFlight {
    fn drop(&mut self) {
        SESSIONS_CHECKPOINT_RUNNING.store(false, Ordering::Release);
    }
}

pub fn wal_path(database_path: &Path) -> PathBuf {
    let mut value = database_path.as_os_str().to_os_string();
    value.push("-wal");
    PathBuf::from(value)
}

pub fn wal_bytes(database_path: &Path) -> u64 {
    std::fs::metadata(wal_path(database_path))
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

pub fn checkpoint_database(
    database_path: &Path,
    mode: WalCheckpointMode,
    busy_timeout: Duration,
) -> Result<WalCheckpointReport, String> {
    let started = Instant::now();
    if !database_path.exists() {
        return Err(format!(
            "refusing to create missing database during checkpoint: {}",
            database_path.display()
        ));
    }
    let wal_bytes_before = wal_bytes(database_path);
    let conn = Connection::open(database_path).map_err(|error| {
        format!(
            "open dedicated checkpoint connection for {} failed: {error}",
            database_path.display()
        )
    })?;
    conn.busy_timeout(busy_timeout)
        .map_err(|error| format!("set checkpoint busy timeout failed: {error}"))?;
    let (busy, log_frames, checkpointed_frames) = conn
        .query_row(mode.pragma(), [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|error| {
            format!(
                "{} checkpoint for {} failed: {error}",
                mode.pragma(),
                database_path.display()
            )
        })?;
    drop(conn);
    Ok(WalCheckpointReport {
        database_path: database_path.to_path_buf(),
        mode,
        busy,
        log_frames,
        checkpointed_frames,
        wal_bytes_before,
        wal_bytes_after: wal_bytes(database_path),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

/// One global high-water owner for sessions.db. Callers may invoke this from a
/// low-frequency process timer, but concurrent calls coalesce and a busy
/// writer causes an immediate skip rather than foreground contention.
pub fn checkpoint_sessions_if_wal_exceeds(
    high_water_bytes: u64,
    writer_wait: Duration,
    sqlite_busy_timeout: Duration,
) -> Result<WalMaintenanceOutcome, String> {
    let path = super::connection::get_db_path();
    let bytes = wal_bytes(&path);
    if bytes < high_water_bytes {
        return Ok(WalMaintenanceOutcome::BelowHighWater { wal_bytes: bytes });
    }
    if SESSIONS_CHECKPOINT_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(WalMaintenanceOutcome::AlreadyRunning { wal_bytes: bytes });
    }
    let _single_flight = CheckpointSingleFlight;
    let Some(result) = super::writer::try_with_sessions_writer(writer_wait, || {
        checkpoint_database(&path, WalCheckpointMode::Restart, sqlite_busy_timeout)
    }) else {
        return Ok(WalMaintenanceOutcome::WriterBusy { wal_bytes: bytes });
    };
    result.map(WalMaintenanceOutcome::Checkpointed)
}

pub fn checkpoint_sessions_for_shutdown(
    writer_wait: Duration,
    sqlite_busy_timeout: Duration,
) -> Result<WalMaintenanceOutcome, String> {
    let path = super::connection::get_db_path();
    let bytes = wal_bytes(&path);
    if SESSIONS_CHECKPOINT_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(WalMaintenanceOutcome::AlreadyRunning { wal_bytes: bytes });
    }
    let _single_flight = CheckpointSingleFlight;
    let Some(result) = super::writer::try_with_sessions_writer(writer_wait, || {
        checkpoint_database(&path, WalCheckpointMode::Truncate, sqlite_busy_timeout)
    }) else {
        return Ok(WalMaintenanceOutcome::WriterBusy { wal_bytes: bytes });
    };
    result.map(WalMaintenanceOutcome::Checkpointed)
}

pub fn checkpoint_projects_for_shutdown(
    sqlite_busy_timeout: Duration,
) -> Result<WalCheckpointReport, String> {
    checkpoint_database(
        &app_paths::projects_db(),
        WalCheckpointMode::Truncate,
        sqlite_busy_timeout,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "orgii-checkpoint-{label}-{}-{nonce}.db",
            std::process::id()
        ))
    }

    fn remove_sqlite_files(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(wal_path(path));
        let mut shm = path.as_os_str().to_os_string();
        shm.push("-shm");
        let _ = std::fs::remove_file(PathBuf::from(shm));
    }

    fn seed_large_wal(path: &Path) -> Connection {
        let mut conn = Connection::open(path).expect("writer connection");
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA wal_autocheckpoint=0;
             CREATE TABLE payloads(id INTEGER PRIMARY KEY, body BLOB NOT NULL);",
        )
        .expect("WAL schema");
        let tx = conn.transaction().expect("payload transaction");
        let payload = vec![0x5a_u8; 8 * 1024];
        for id in 0..512_i64 {
            tx.execute(
                "INSERT INTO payloads(id,body) VALUES(?1,?2)",
                rusqlite::params![id, &payload],
            )
            .expect("payload row");
        }
        tx.commit().expect("payload commit");
        assert!(wal_bytes(path) > 1024 * 1024, "fixture needs a real WAL");
        conn
    }

    #[test]
    fn truncate_checkpoint_reclaims_wal_without_losing_data() {
        let path = temp_db_path("truncate");
        let writer = seed_large_wal(&path);
        let report = checkpoint_database(
            &path,
            WalCheckpointMode::Truncate,
            Duration::from_millis(250),
        )
        .expect("truncate checkpoint");
        assert_eq!(report.busy, 0);
        assert_eq!(report.wal_bytes_after, 0);
        assert!(report.wal_bytes_before > 1024 * 1024);
        let rows: i64 = writer
            .query_row("SELECT COUNT(*) FROM payloads", [], |row| row.get(0))
            .expect("read checkpointed data");
        assert_eq!(rows, 512);
        let integrity: String = writer
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .expect("integrity check");
        assert_eq!(integrity, "ok");
        drop(writer);
        remove_sqlite_files(&path);
    }

    #[test]
    fn busy_reader_preserves_wal_until_a_later_safe_retry() {
        let path = temp_db_path("busy-reader");
        let writer = seed_large_wal(&path);
        let reader = Connection::open(&path).expect("reader connection");
        reader.execute_batch("BEGIN").expect("reader transaction");
        let _: i64 = reader
            .query_row("SELECT COUNT(*) FROM payloads", [], |row| row.get(0))
            .expect("hold read snapshot");
        writer
            .execute("INSERT INTO payloads(body) VALUES(zeroblob(8192))", [])
            .expect("newer WAL frame");

        let busy = checkpoint_database(
            &path,
            WalCheckpointMode::Truncate,
            Duration::from_millis(25),
        )
        .expect("busy is a checkpoint result, not an error");
        assert_eq!(busy.busy, 1);
        assert!(busy.wal_bytes_after > 0, "busy WAL must never be deleted");

        reader.execute_batch("COMMIT").expect("release reader");
        drop(reader);
        let recovered = checkpoint_database(
            &path,
            WalCheckpointMode::Truncate,
            Duration::from_millis(250),
        )
        .expect("retry after reader release");
        assert_eq!(recovered.busy, 0);
        assert_eq!(recovered.wal_bytes_after, 0);
        let integrity: String = writer
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .expect("integrity check");
        assert_eq!(integrity, "ok");
        drop(writer);
        remove_sqlite_files(&path);
    }
}
