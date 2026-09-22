use super::*;
use std::{cell::RefCell, ffi::CStr, os::raw::c_void, sync::mpsc, time::Duration};

const WAIT: Duration = Duration::from_secs(10);
const OLD_INDEX: &str = "CREATE INDEX idx_learnings_active ON learnings(agent_scope, status) WHERE status != 'deprecated'";

// The workspace does not enable rusqlite's optional hooks feature. Keep this
// narrow authorizer local to tests: it pauses/rejects precisely the CREATE
// following the DROP, without adding synchronization to production code.
struct IndexAuthorizer<'a> {
    conn: &'a Connection,
    _callback: Box<Box<dyn FnMut() -> bool + 'a>>,
}

impl<'a> IndexAuthorizer<'a> {
    fn new(conn: &'a Connection, callback: impl FnMut() -> bool + 'a) -> Self {
        unsafe extern "C" fn authorize(
            state: *mut c_void,
            action: i32,
            name: *const std::os::raw::c_char,
            _: *const std::os::raw::c_char,
            _: *const std::os::raw::c_char,
            _: *const std::os::raw::c_char,
        ) -> i32 {
            // SAFETY: SQLite invokes this synchronously on the registered
            // connection. The boxed callback lives until after unregistering;
            // SQLite supplies a valid C string for CREATE_INDEX's first arg.
            if action == rusqlite::ffi::SQLITE_CREATE_INDEX
                && !name.is_null()
                && unsafe { CStr::from_ptr(name) }.to_bytes() == b"idx_learnings_active"
            {
                let callback = unsafe { &mut *state.cast::<Box<dyn FnMut() -> bool>>() };
                // Never unwind across SQLite's C boundary, including on a
                // failed assertion accidentally added to a future callback.
                if !std::panic::catch_unwind(std::panic::AssertUnwindSafe(callback))
                    .unwrap_or(false)
                {
                    return rusqlite::ffi::SQLITE_DENY;
                }
            }
            rusqlite::ffi::SQLITE_OK
        }
        let mut callback: Box<Box<dyn FnMut() -> bool + 'a>> = Box::new(Box::new(callback));
        // SAFETY: the extra Box provides a stable, sized pointer; this guard
        // keeps both callback and connection alive and unregisters on Drop.
        let result = unsafe {
            rusqlite::ffi::sqlite3_set_authorizer(
                conn.handle(),
                Some(authorize),
                (&mut *callback as *mut Box<dyn FnMut() -> bool>).cast(),
            )
        };
        assert_eq!(result, rusqlite::ffi::SQLITE_OK);
        Self {
            conn,
            _callback: callback,
        }
    }
}

impl Drop for IndexAuthorizer<'_> {
    fn drop(&mut self) {
        // SAFETY: connection is still borrowed/live; unregister before the
        // callback storage is freed so SQLite cannot retain a dangling pointer.
        unsafe {
            rusqlite::ffi::sqlite3_set_authorizer(self.conn.handle(), None, std::ptr::null_mut())
        };
    }
}

fn index_sql(conn: &Connection) -> String {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE name = 'idx_learnings_active'",
        [],
        |row| row.get(0),
    )
    .expect("active index exists")
}

fn seed_old_index(conn: &Connection) {
    init_learnings_table(conn).expect("initialize fixture");
    conn.execute("DROP INDEX idx_learnings_active", []).unwrap();
    conn.execute(OLD_INDEX, []).unwrap();
    conn.execute("INSERT INTO learnings(id, content, created_at, updated_at) VALUES ('original', 'kept', 'now', 'now')", []).unwrap();
}

fn assert_marker(conn: &Connection, marker: &str, expected: i64) {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM learnings WHERE id = ?1",
            [marker],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, expected);
}

#[test]
fn index_rebuild_failure_restores_index_and_preserves_outer_transaction() {
    for nested in [false, true] {
        let conn = Connection::open_in_memory().unwrap();
        seed_old_index(&conn);
        if nested {
            conn.execute_batch("BEGIN; INSERT INTO learnings(id, content, created_at, updated_at) VALUES ('outer', 'kept', 'now', 'now');").unwrap();
        }
        let authorizer = IndexAuthorizer::new(&conn, || false);
        let error = init_learnings_table(&conn).expect_err("injected CREATE must fail");
        drop(authorizer);
        assert_eq!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::AuthorizationForStatementDenied)
        );
        assert_eq!(index_sql(&conn), OLD_INDEX);
        assert_marker(&conn, "original", 1);
        assert_eq!(conn.is_autocommit(), !nested);
        if nested {
            assert_marker(&conn, "outer", 1);
            conn.execute_batch("COMMIT")
                .expect("caller transaction remains usable");
            assert_marker(&conn, "outer", 1);
        }
        // A failed initializer must also leave the connection usable again.
        init_learnings_table(&conn).unwrap();
        assert!(index_sql(&conn).contains("'abandoned'"));
    }
}

#[test]
fn successful_index_rebuild_does_not_commit_callers_transaction() {
    let conn = Connection::open_in_memory().unwrap();
    seed_old_index(&conn);
    conn.execute_batch("BEGIN; INSERT INTO learnings(id, content, created_at, updated_at) VALUES ('outer', 'kept', 'now', 'now');").unwrap();
    init_learnings_table(&conn).unwrap();
    assert!(!conn.is_autocommit());
    assert!(index_sql(&conn).contains("'abandoned'"));
    conn.execute_batch("ROLLBACK").unwrap();
    assert_eq!(index_sql(&conn), OLD_INDEX);
    assert_marker(&conn, "outer", 0);
    assert_marker(&conn, "original", 1);
}

type BusySignal = (mpsc::Sender<&'static str>, mpsc::Receiver<()>);
thread_local! {
    static BUSY_SIGNAL: RefCell<Option<BusySignal>> = const { RefCell::new(None) };
}

fn report_overlap_and_wait(_: i32) -> bool {
    BUSY_SIGNAL.with(|slot| {
        let Some((observed, released)) = slot.borrow_mut().take() else {
            return false;
        };
        observed.send("writer blocked").is_ok() && released.recv_timeout(WAIT).is_ok()
    })
}

#[test]
fn concurrent_initializers_cannot_interleave_active_index_replacement() {
    assert_concurrent_initializers(true);
    assert_concurrent_initializers(false);
}

fn assert_concurrent_initializers(index_exists: bool) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("sessions.db");
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "journal_mode", "WAL").unwrap();
    seed_old_index(&conn);
    if !index_exists {
        conn.execute("DROP INDEX idx_learnings_active", []).unwrap();
    }
    let (start_tx, start_rx) = mpsc::channel();
    let (observed_tx, observed_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let worker = std::thread::spawn(move || {
        let second = Connection::open(path).unwrap();
        BUSY_SIGNAL.with(|slot| *slot.borrow_mut() = Some((observed_tx.clone(), release_rx)));
        second.busy_handler(Some(report_overlap_and_wait)).unwrap();
        ready_tx.send(()).unwrap();
        start_rx.recv_timeout(WAIT).unwrap();
        let result = init_learnings_table(&second);
        // Without an atomic rebuild B completes while A is paused after DROP.
        // With one, B's busy handler reports the held write lock instead.
        let _ = observed_tx.send("initializer completed");
        BUSY_SIGNAL.with(|slot| *slot.borrow_mut() = None);
        result
    });
    ready_rx.recv_timeout(WAIT).unwrap();
    let mut overlap = None;
    let authorizer = IndexAuthorizer::new(&conn, || {
        if start_tx.send(()).is_err() {
            return false;
        }
        overlap = observed_rx.recv_timeout(WAIT).ok();
        overlap.is_some()
    });
    let first_result = init_learnings_table(&conn);
    drop(authorizer);
    let _ = release_tx.send(());
    let second_result = worker.join().expect("second initializer finishes");
    first_result.expect("first initializer succeeds despite concurrent startup");
    second_result.expect("second initializer succeeds after writer release");
    assert_eq!(overlap, Some("writer blocked"));
    assert!(index_sql(&conn).contains("WHERE status NOT IN ('deprecated', 'abandoned')"));
    assert_marker(&conn, "original", 1);
}

fn table_has_column(conn: &Connection, column: &str) -> bool {
    let mut stmt = conn
        .prepare("PRAGMA table_info(learnings)")
        .expect("prepare table_info");
    let mut rows = stmt.query([]).expect("query table_info");
    while let Some(row) = rows.next().expect("row") {
        if row.get::<_, String>(1).expect("name") == column {
            return true;
        }
    }
    false
}

fn index_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
        [name],
        |row| Ok(row.get::<_, i64>(0)? == 1),
    )
    .expect("query index presence")
}

// Regression: a `learnings` table created before the lifecycle / evolution
// columns existed must still upgrade cleanly. `idx_learnings_active` filters
// on `status` and `idx_learnings_parent` indexes `parent_id`; creating them
// in the initial CREATE TABLE batch failed with "no such column: status" on
// any legacy table, aborting init before the ALTER TABLE migrations ran.
#[test]
fn init_learnings_table_upgrades_legacy_table_missing_lifecycle_columns() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    // Pre-lifecycle schema: base columns only, none of the ALTER-added ones.
    conn.execute_batch(
        "CREATE TABLE learnings (
            id           TEXT PRIMARY KEY,
            agent_scope  TEXT NOT NULL DEFAULT '_global',
            content      TEXT NOT NULL,
            category     TEXT NOT NULL DEFAULT 'pattern',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );",
    )
    .expect("create legacy learnings table");
    assert!(!table_has_column(&conn, "status"));
    assert!(!table_has_column(&conn, "parent_id"));

    // This previously errored with "no such column: status".
    init_learnings_table(&conn).expect("upgrade legacy learnings schema");

    assert!(table_has_column(&conn, "status"));
    assert!(table_has_column(&conn, "parent_id"));
    assert!(index_exists(&conn, "idx_learnings_active"));
    assert!(index_exists(&conn, "idx_learnings_parent"));
}
