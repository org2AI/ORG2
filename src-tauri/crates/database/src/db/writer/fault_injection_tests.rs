//! Isolated SQLite contention simulations using the production WAL writer
//! serializer and BEGIN IMMEDIATE helper. Never opens the user's sessions.db.
use super::{begin_immediate, with_sessions_writer};
use rusqlite::{params, Connection, Result as SqliteResult};
use std::sync::{mpsc, Arc, Barrier};
use std::thread;
use std::time::Duration;

const DEADLINE: Duration = Duration::from_secs(20);

fn isolated_db() -> (tempfile::TempDir, std::path::PathBuf) {
    let sandbox = tempfile::tempdir().expect("isolated tempdir");
    let path = sandbox.path().join("fault-lab.sqlite3");
    let conn = Connection::open(&path).expect("open isolated database");
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS synthetic_turn_results(
           session_no INTEGER NOT NULL,
           turn_no INTEGER NOT NULL,
           PRIMARY KEY(session_no, turn_no)
         );",
    ).expect("initialize WAL and isolated fixture schema");
    drop(conn);
    (sandbox, path)
}

fn concurrent_wal_profile(worker_count: usize, rows_per_worker: usize) {
    // Files are scoped to a unique TempDir. These tests must never point
    // get_connection() at an actual user sessions database or reset its pool.
    let (_sandbox, path) = isolated_db();
    let gate = Arc::new(Barrier::new(worker_count + 1));
    let (notify, finished) = mpsc::channel::<(usize, SqliteResult<()>)>();
    let mut threads = Vec::with_capacity(worker_count);

    for worker in 0..worker_count {
        let writer_path = path.clone();
        let barrier = Arc::clone(&gate);
        let result_tx = notify.clone();
        threads.push(thread::spawn(move || {
            barrier.wait();
            let result = (|| -> SqliteResult<()> {
                let conn = Connection::open(&writer_path)?;
                // With the Rust writer mutex, concurrent in-process writes
                // must serialize without ever exhausting this backstop.
                conn.busy_timeout(Duration::from_millis(500))?;
                with_sessions_writer(|| {
                    let tx = begin_immediate(&conn)?;
                    for turn in 0..rows_per_worker {
                        tx.execute(
                            "INSERT INTO synthetic_turn_results(session_no, turn_no)
                             VALUES (?1, ?2)",
                            params![worker as i64, turn as i64],
                        )?;
                    }
                    tx.commit()
                })
            })();
            let _ = result_tx.send((worker, result));
        }));
    }
    drop(notify);
    gate.wait();

    // A hung writer is a bounded test failure rather than an indefinitely
    // running CI job. No detached cleanup actor or retry loop is introduced.
    for _ in 0..worker_count {
        let (worker, result) = finished.recv_timeout(DEADLINE)
            .expect("concurrent writer did not finish before bounded deadline");
        result.unwrap_or_else(|error| {
            panic!("SQLite write failed in synthetic Session {worker}: {error}")
        });
    }
    for handle in threads {
        handle.join().expect("synthetic writer thread panicked");
    }

    let conn = Connection::open(&path).expect("verify isolated database");
    let recorded: i64 = conn.query_row(
        "SELECT COUNT(*) FROM synthetic_turn_results", [], |row| row.get(0),
    ).expect("read committed row count");
    assert_eq!(recorded, (worker_count * rows_per_worker) as i64,
        "lost writes or duplicate turns under concurrent WAL writers");
    let mut statement = conn.prepare(
        "SELECT session_no, COUNT(*) FROM synthetic_turn_results GROUP BY session_no",
    ).expect("prepare per-session count");
    let per_session = statement.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
    }).expect("group query");
    let mut seen = 0usize;
    for item in per_session {
        let (_, count) = item.expect("read per-session result");
        assert_eq!(count, rows_per_worker as i64);
        seen += 1;
    }
    assert_eq!(seen, worker_count);
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("verify SQLite file integrity");
    assert_eq!(integrity, "ok");
}

#[test]
fn five_simultaneous_wal_writers_are_serialized() {
    concurrent_wal_profile(5, 12);
}

#[test]
fn twenty_simultaneous_wal_writers_are_serialized() {
    concurrent_wal_profile(20, 8);
}

#[test]
fn fifty_simultaneous_wal_writers_are_serialized() {
    concurrent_wal_profile(50, 6);
}

/// In WAL mode, an unrelated reader must be able to observe the last
/// committed snapshot while one writer owns an uncommitted transaction.
#[test]
fn reader_is_not_blocked_by_an_in_process_writer_transaction() {
    let (_sandbox, path) = isolated_db();
    let (entered_tx, entered_rx) = mpsc::sync_channel::<()>(1);
    let (release_tx, release_rx) = mpsc::sync_channel::<()>(1);
    let writer_path = path.clone();
    let writer = thread::spawn(move || -> SqliteResult<()> {
        let conn = Connection::open(&writer_path)?;
        with_sessions_writer(|| {
            let tx = begin_immediate(&conn)?;
            tx.execute(
                "INSERT INTO synthetic_turn_results(session_no, turn_no) VALUES(1, 1)", [],
            )?;
            let _ = entered_tx.send(());
            release_rx.recv_timeout(Duration::from_secs(5))
                .expect("test reader must release the writer");
            tx.commit()
        })
    });
    entered_rx.recv_timeout(Duration::from_secs(5))
        .expect("writer must reach held transaction");

    let reader = Connection::open(&path).expect("open independent SQLite reader");
    reader.busy_timeout(Duration::from_millis(500)).expect("set reader timeout");
    let before: i64 = reader.query_row(
        "SELECT COUNT(*) FROM synthetic_turn_results", [], |row| row.get(0),
    ).expect("WAL reader must see committed state while writer has BEGIN IMMEDIATE");
    assert_eq!(before, 0, "uncommitted writes must not leak to another reader");

    release_tx.send(()).expect("release held writer transaction");
    writer.join().expect("writer thread completes").expect("commit succeeds");
    let after: i64 = reader.query_row(
        "SELECT COUNT(*) FROM synthetic_turn_results", [], |row| row.get(0),
    ).expect("reader can see committed result");
    assert_eq!(after, 1);
}
