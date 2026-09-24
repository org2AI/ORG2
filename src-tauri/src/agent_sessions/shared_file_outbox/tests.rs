use super::*;

fn candidate(path: &str, revision: &str) -> Candidate {
    Candidate {
        path: path.into(),
        revision: revision.into(),
    }
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    init_tables(&conn).unwrap();
    conn
}
fn take(conn: &Connection, now: i64) -> Claim {
    claim(conn, "endpoint|author", &["org".into()], now).unwrap()
}
fn seed(conn: &Connection) {
    enqueue(
        conn,
        "endpoint|author",
        "org",
        "root",
        &[candidate("/report.md", "event:1")],
    )
    .unwrap();
}

#[tokio::test]
async fn command_round_trip_uses_the_initialized_isolated_database() {
    let _sandbox = crate::test_utils::test_env::sandbox();
    cloud_file_outbox_enqueue(
        "endpoint|author".into(),
        "org".into(),
        "root".into(),
        vec![candidate("/report.md", "event:1")],
    )
    .await
    .unwrap();
    let job = cloud_file_outbox_claim("endpoint|author".into(), vec!["org".into()])
        .await
        .unwrap()
        .job
        .unwrap();
    cloud_file_outbox_settle(
        "endpoint|author".into(),
        job.id,
        job.lease,
        Outcome::Uploaded,
    )
    .await
    .unwrap();
    let empty = cloud_file_outbox_claim("endpoint|author".into(), vec!["org".into()])
        .await
        .unwrap();
    assert!(empty.job.is_none());
    assert!(empty.retry_at.is_none());
}

#[test]
fn durable_reopen_and_idempotent_enqueue_preserve_pending_revision() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("outbox.db");
    {
        let conn = Connection::open(&path).unwrap();
        init_tables(&conn).unwrap();
        seed(&conn);
        seed(&conn);
    }
    let conn = Connection::open(path).unwrap();
    init_tables(&conn).unwrap();
    let job = take(&conn, 1).job.unwrap();
    assert_eq!(job.path, "/report.md");
    assert_eq!(job.revision, "event:1");
    assert!(take(&conn, 2).job.is_none());
    settle(
        &conn,
        "endpoint|author",
        job.id,
        &job.lease,
        Outcome::Uploaded,
        2,
    )
    .unwrap();
    assert!(take(&conn, LEASE_MS + 2).retry_at.is_none());
}

#[test]
fn account_endpoint_org_and_stale_lease_cannot_consume_another_job() {
    let conn = database();
    seed(&conn);
    assert!(claim(&conn, "endpoint|other", &["org".into()], 1)
        .unwrap()
        .job
        .is_none());
    assert!(claim(&conn, "other|author", &["org".into()], 1)
        .unwrap()
        .job
        .is_none());
    assert!(claim(&conn, "endpoint|author", &["other".into()], 1)
        .unwrap()
        .job
        .is_none());
    let old = take(&conn, 1).job.unwrap();
    assert!(take(&conn, LEASE_MS).job.is_none());
    let current = take(&conn, LEASE_MS + 1).job.unwrap();
    assert_ne!(old.lease, current.lease);
    settle(
        &conn,
        "endpoint|author",
        old.id,
        &old.lease,
        Outcome::Uploaded,
        LEASE_MS + 2,
    )
    .unwrap();
    settle(
        &conn,
        "endpoint|other",
        current.id,
        &current.lease,
        Outcome::Uploaded,
        LEASE_MS + 2,
    )
    .unwrap();
    assert_eq!(take(&conn, LEASE_MS + 3).retry_at, Some(2 * LEASE_MS + 1));
}

#[test]
fn two_connections_share_a_single_lease() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("outbox.db");
    let first = Connection::open(&path).unwrap();
    let second = Connection::open(&path).unwrap();
    init_tables(&first).unwrap();
    seed(&first);
    assert!(take(&first, 1).job.is_some());
    assert!(take(&second, 1).job.is_none());
    assert!(take(&second, LEASE_MS + 1).job.is_some());
}

#[test]
fn quota_defers_existing_and_new_files_in_the_same_org_only() {
    let conn = database();
    seed(&conn);
    enqueue(
        &conn,
        "endpoint|author",
        "other",
        "root",
        &[candidate("/other", "e")],
    )
    .unwrap();
    let job = take(&conn, 1).job.unwrap();
    settle(
        &conn,
        "endpoint|author",
        job.id,
        &job.lease,
        Outcome::Quota,
        2,
    )
    .unwrap();
    enqueue(
        &conn,
        "endpoint|author",
        "org",
        "another-root",
        &[candidate("/new", "e")],
    )
    .unwrap();
    assert!(take(&conn, 3).job.is_none());
    assert_eq!(take(&conn, 3).retry_at, Some(30 * 60_000 + 2));
    assert!(claim(&conn, "endpoint|author", &["other".into()], 3)
        .unwrap()
        .job
        .is_some());
    assert!(take(&conn, 30 * 60_000 + 2).job.is_some());
}

#[test]
fn retry_is_durable_bounded_and_does_not_starve_other_files() {
    let conn = database();
    seed(&conn);
    let job = take(&conn, 1).job.unwrap();
    settle(
        &conn,
        "endpoint|author",
        job.id,
        &job.lease,
        Outcome::Retry,
        2,
    )
    .unwrap();
    assert_eq!(take(&conn, 3).retry_at, Some(5002));
    enqueue(
        &conn,
        "endpoint|author",
        "org",
        "root",
        &[candidate("/second", "e")],
    )
    .unwrap();
    assert_eq!(take(&conn, 3).job.unwrap().path, "/second");
    conn.execute(
        "UPDATE cloud_file_outbox SET attempts = 32 WHERE id = ?1",
        [job.id],
    )
    .unwrap();
    let job = take(&conn, 5002).job.unwrap();
    settle(
        &conn,
        "endpoint|author",
        job.id,
        &job.lease,
        Outcome::Retry,
        5003,
    )
    .unwrap();
    let retry_at: i64 = conn
        .query_row(
            "SELECT next_attempt_at FROM cloud_file_outbox WHERE id = ?1",
            [job.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(retry_at, 5003 + 30 * 60_000);
}

#[test]
fn unavailable_source_is_not_acknowledged_and_cancel_releases_lease() {
    let conn = database();
    seed(&conn);
    let job = take(&conn, 1).job.unwrap();
    settle(
        &conn,
        "endpoint|author",
        job.id,
        &job.lease,
        Outcome::SourceUnavailable,
        2,
    )
    .unwrap();
    let job = take(&conn, 30 * 60_000 + 2).job.unwrap();
    settle(
        &conn,
        "endpoint|author",
        job.id,
        &job.lease,
        Outcome::Cancelled,
        30 * 60_000 + 3,
    )
    .unwrap();
    assert!(take(&conn, 30 * 60_000 + 3).job.is_some());
}

#[test]
fn bad_candidate_rejects_whole_batch_without_losing_existing_rows() {
    let conn = database();
    seed(&conn);
    assert!(enqueue(
        &conn,
        "endpoint|author",
        "org",
        "root",
        &[candidate("/valid", "e"), candidate("", "e")]
    )
    .is_err());
    assert!(enqueue(
        &conn,
        "endpoint|author",
        "org",
        "root",
        &vec![candidate("/x", "e"); 257]
    )
    .is_err());
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM cloud_file_outbox", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}
