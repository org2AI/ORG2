//! Each open owns an independent lease. Active leases are never evicted.
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

const MAX_CONNECTIONS: usize = 16;
static LIVE_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static POOL: std::sync::LazyLock<Mutex<HashMap<String, Arc<Entry>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

struct Entry {
    connection: Mutex<Option<Connection>>,
    interrupt: OnceLock<rusqlite::InterruptHandle>,
    closed: AtomicBool,
    counted: AtomicBool,
}

impl Drop for Entry {
    fn drop(&mut self) {
        if self.counted.load(Ordering::Acquire) {
            LIVE_CONNECTIONS.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

pub fn open(path: &str) -> Result<String, String> {
    let id = format!("db-lease:{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
    let entry = Arc::new(Entry {
        connection: Mutex::new(None),
        interrupt: OnceLock::new(),
        closed: AtomicBool::new(false),
        counted: AtomicBool::new(false),
    });
    {
        let mut pool = POOL.lock().unwrap_or_else(|e| e.into_inner());
        if LIVE_CONNECTIONS.load(Ordering::Acquire) >= MAX_CONNECTIONS {
            return Err(format!("Database connection limit ({MAX_CONNECTIONS}) reached. Close a database before opening another."));
        }
        LIVE_CONNECTIONS.fetch_add(1, Ordering::AcqRel);
        entry.counted.store(true, Ordering::Release);
        pool.insert(id.clone(), entry.clone());
    }
    // Reserve capacity before doing I/O, but never hold the registry lock during I/O.
    let result = (|| {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.execute_batch("PRAGMA synchronous = NORMAL; PRAGMA cache_size = -8000;")?;
        let _ = entry.interrupt.set(conn.get_interrupt_handle());
        *entry.connection.lock().unwrap_or_else(|e| e.into_inner()) = Some(conn);
        Ok::<_, rusqlite::Error>(())
    })();
    if let Err(error) = result {
        close(&id);
        return Err(error.to_string());
    }
    Ok(id)
}

pub fn close(connection_id: &str) {
    let entry = POOL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(connection_id);
    if let Some(entry) = entry {
        entry.closed.store(true, Ordering::Release);
        if let Some(interrupt) = entry.interrupt.get() {
            interrupt.interrupt();
        }
        // A running operation owns its Arc until it unwinds. Dropping the last
        // Arc closes SQLite outside the registry lock.
    }
}

pub fn with<F, T>(connection_id: &str, func: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> rusqlite::Result<T>,
{
    let entry = POOL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(connection_id)
        .cloned()
        .ok_or_else(|| format!("DB connection not found: {connection_id}"))?;
    let connection = entry.connection.lock().unwrap_or_else(|e| e.into_inner());
    if entry.closed.load(Ordering::Acquire) {
        return Err("Database connection closed".into());
    }
    let connection = connection
        .as_ref()
        .ok_or("Database connection is still opening")?;
    func(connection).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Create a real SQLite file the pool can open read-write.
    fn seeded_db(dir: &std::path::Path, name: &str) -> String {
        let path = dir.join(name);
        let conn = Connection::open(&path).expect("create db");
        conn.execute_batch("CREATE TABLE t (a); INSERT INTO t VALUES (1)")
            .expect("seed");
        drop(conn);
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn independent_leases_for_same_file_survive_peer_close() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = seeded_db(dir.path(), "shared.db");
        let first = open(&path).unwrap();
        let second = open(&path).unwrap();
        assert_ne!(first, second);
        close(&first);
        assert_eq!(
            with(&second, |c| c.query_row(
                "SELECT COUNT(*) FROM t",
                [],
                |r| r.get::<_, i64>(0)
            ))
            .unwrap(),
            1
        );
        close(&second);
    }

    #[test]
    fn capacity_rejects_new_lease_without_invalidating_existing_owners() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = seeded_db(dir.path(), "capacity.db");
        let leases: Vec<_> = (0..MAX_CONNECTIONS).map(|_| open(&path).unwrap()).collect();
        assert!(open(&path).unwrap_err().contains("limit"));
        for id in &leases {
            assert!(with(id, |_| Ok(())).is_ok());
        }
        close(&leases[0]);
        let replacement = open(&path).unwrap();
        for id in leases {
            close(&id);
        }
        close(&replacement);
    }

    #[test]
    fn an_independent_database_is_not_blocked_by_another_operation() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let first = open(&seeded_db(dir.path(), "first.db")).unwrap();
        let second = open(&seeded_db(dir.path(), "second.db")).unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let first_id = first.clone();
        let worker = std::thread::spawn(move || {
            with(&first_id, |_| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
        });
        started_rx.recv().unwrap();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let second_id = second.clone();
        let reader = std::thread::spawn(move || {
            done_tx
                .send(with(&second_id, |c| {
                    c.query_row("SELECT 1", [], |r| r.get::<_, i64>(0))
                }))
                .unwrap();
        });
        let result = done_rx.recv_timeout(std::time::Duration::from_secs(2));
        // Always release the worker, including when the regression is present.
        release_tx.send(()).unwrap();
        worker.join().unwrap().unwrap();
        reader.join().unwrap();
        assert_eq!(result.unwrap().unwrap(), 1);
        close(&first);
        close(&second);
    }

    #[test]
    fn open_fails_for_a_path_that_does_not_exist() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("nope.sqlite");

        // The pool opens READ_WRITE without CREATE, so browsing must never
        // conjure an empty database at a mistyped path.
        assert!(open(missing.to_str().unwrap()).is_err());
        assert!(!missing.exists());
    }

    #[test]
    fn with_runs_the_closure_against_the_pooled_connection() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().expect("tempdir");
        let path = seeded_db(dir.path(), "with.sqlite");
        let id = open(&path).expect("open");

        let count = with(&id, |conn| {
            conn.query_row("SELECT COUNT(*) FROM t", [], |row| row.get::<_, i64>(0))
        })
        .expect("with");
        assert_eq!(count, 1);

        close(&id);
    }

    #[test]
    fn with_reports_the_missing_connection_id_after_close() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().expect("tempdir");
        let path = seeded_db(dir.path(), "closed.sqlite");
        let id = open(&path).expect("open");
        close(&id);

        let err = with(&id, |conn| conn.query_row("SELECT 1", [], |_| Ok(()))).unwrap_err();
        assert!(err.contains("DB connection not found"));
        assert!(err.contains(&id), "the error names the id the caller sent");
    }

    #[test]
    fn close_is_a_no_op_for_an_unknown_connection_id() {
        let _guard = TEST_LOCK.lock().unwrap();
        close("db:/never/opened.sqlite");
    }

    #[test]
    fn with_surfaces_closure_errors_as_strings() {
        let _guard = TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().expect("tempdir");
        let path = seeded_db(dir.path(), "err.sqlite");
        let id = open(&path).expect("open");

        let err = with(&id, |conn| {
            conn.query_row("SELECT * FROM missing", [], |_| Ok(()))
        })
        .unwrap_err();
        assert!(err.contains("missing"), "got {err}");

        close(&id);
    }
}
