use super::*;
use std::io::{Seek, SeekFrom};
fn captured(bytes: &[u8]) -> CapturedFile {
    let mut file = tempfile::tempfile().unwrap();
    file.write_all(bytes).unwrap();
    file.seek(SeekFrom::Start(0)).unwrap();
    CapturedFile {
        file,
        size: bytes.len() as u64,
    }
}

const SCOPE: [&str; 3] = ["endpoint|author", "org", "root"];
fn file(path: &str) -> Candidate {
    Candidate {
        path: path.into(),
        revision: "answer:1".into(),
    }
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    init(&conn).unwrap();
    conn
}
fn decode(snapshot: Snapshot) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(snapshot.bytes_base64.unwrap())
        .unwrap()
}

#[test]
fn first_receipt_survives_reopen_replacement_and_source_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("report.md");
    std::fs::write(&source, b"original").unwrap();
    let candidate = file(source.to_str().unwrap());
    let db = dir.path().join("receipt.db");
    let source_capture = capture(&candidate.path);
    #[cfg(target_os = "linux")]
    if matches!(source_capture, Err("atomic_capture_unsupported")) {
        // A Linux non-CoW filesystem must explicitly reject, not claim an
        // atomic capture. Supported-filesystem integration remains separate.
        assert!(source_capture.is_err());
        return;
    }
    let bytes = source_capture.unwrap();
    {
        let conn = Connection::open(&db).unwrap();
        init(&conn).unwrap();
        save(&conn, &SCOPE, &candidate, Ok(bytes)).unwrap();
    }
    std::fs::write(&source, b"replacement").unwrap();
    let conn = Connection::open(&db).unwrap();
    init(&conn).unwrap();
    save(&conn, &SCOPE, &candidate, Ok(captured(b"replacement"))).unwrap();
    std::fs::remove_file(&source).unwrap();
    assert_eq!(
        decode(read(&conn, &SCOPE, &candidate).unwrap()),
        b"original"
    );
    let next = Candidate {
        revision: "answer:2".into(),
        ..candidate
    };
    save(&conn, &SCOPE, &next, Ok(captured(b"new delivery"))).unwrap();
    assert_eq!(decode(read(&conn, &SCOPE, &next).unwrap()), b"new delivery");
}

#[test]
fn failed_first_capture_cannot_rebind_to_later_source() {
    let conn = database();
    let candidate = file("/missing");
    save(&conn, &SCOPE, &candidate, Err("source_unavailable")).unwrap();
    save(&conn, &SCOPE, &candidate, Ok(captured(b"later"))).unwrap();
    let result = read(&conn, &SCOPE, &candidate).unwrap();
    assert_eq!(result.status, "source_unavailable");
    assert!(result.bytes_base64.is_none());
}

#[test]
fn identity_endpoint_org_session_and_revision_are_isolated() {
    let conn = database();
    let candidate = file("/report");
    save(&conn, &SCOPE, &candidate, Ok(captured(b"private"))).unwrap();
    for scope in [
        ["endpoint|other", "org", "root"],
        ["other|author", "org", "root"],
        ["endpoint|author", "other", "root"],
        ["endpoint|author", "org", "other"],
    ] {
        assert_eq!(
            read(&conn, &scope, &candidate).unwrap().status,
            "not_captured"
        );
    }
    assert_eq!(
        read(
            &conn,
            &SCOPE,
            &Candidate {
                revision: "other".into(),
                ..candidate
            }
        )
        .unwrap()
        .status,
        "not_captured"
    );
}

#[test]
fn corrupt_bytes_are_never_returned_as_available() {
    let conn = database();
    let candidate = file("/report");
    save(&conn, &SCOPE, &candidate, Ok(captured(b"original"))).unwrap();
    conn.execute("UPDATE cloud_file_snapshots SET bytes=X'00'", [])
        .unwrap();
    let result = read(&conn, &SCOPE, &candidate).unwrap();
    assert_eq!(result.status, "integrity_error");
    assert!(result.bytes_base64.is_none());
}

#[test]
fn exhausted_local_budget_records_failure_without_replacing_or_evicting_old_bytes() {
    let conn = database();
    let first = file("/first");
    let second = file("/second");
    save(&conn, &SCOPE, &first, Ok(captured(b"retained"))).unwrap();
    conn.execute(
        "UPDATE cloud_file_snapshots SET size_bytes=?1",
        [MAX_PENDING_BYTES],
    )
    .unwrap();
    save(&conn, &SCOPE, &second, Ok(captured(b"new"))).unwrap();
    assert_eq!(
        read(&conn, &SCOPE, &second).unwrap().status,
        "local_budget_exceeded"
    );
    assert_eq!(decode(read(&conn, &SCOPE, &first).unwrap()), b"retained");
}

#[test]
fn invalid_missing_and_oversized_sources_are_explicit_failures() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(capture("relative").unwrap_err(), "invalid_source");
    assert_eq!(
        capture(dir.path().to_str().unwrap()).unwrap_err(),
        "invalid_source"
    );
    assert_eq!(
        capture(dir.path().join("absent").to_str().unwrap()).unwrap_err(),
        "source_unavailable"
    );
    let path = dir.path().join("large");
    File::create(&path)
        .unwrap()
        .set_len(MAX_FILE_BYTES + 1)
        .unwrap();
    assert_eq!(capture(path.to_str().unwrap()).unwrap_err(), "too_large");
}

#[cfg(target_os = "macos")]
#[test]
fn cloned_handle_retains_original_bytes_under_source_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("file");
    std::fs::write(&path, b"before").unwrap();
    let mut cloned = platform_snapshot(&path).unwrap();
    std::fs::write(&path, b"after").unwrap();
    let mut bytes = Vec::new();
    cloned.read_to_end(&mut bytes).unwrap();
    assert_eq!(bytes, b"before");
}

#[tokio::test]
async fn real_enqueue_captures_before_network_and_uploaded_ack_releases_only_bytes() {
    let _sandbox = crate::test_utils::test_env::sandbox();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("report");
    std::fs::write(&path, b"delivered").unwrap();
    let candidate = file(path.to_str().unwrap());
    super::super::cloud_file_outbox_enqueue(
        SCOPE[0].into(),
        SCOPE[1].into(),
        SCOPE[2].into(),
        vec![candidate.clone()],
    )
    .await
    .unwrap();
    std::fs::write(&path, b"later").unwrap();
    let result = super::super::cloud_file_snapshot_read(
        SCOPE[0].into(),
        SCOPE[1].into(),
        SCOPE[2].into(),
        candidate.clone(),
    )
    .await
    .unwrap();
    #[cfg(target_os = "linux")]
    if result.status == "atomic_capture_unsupported" {
        assert!(result.bytes_base64.is_none());
        return;
    }
    assert_eq!(decode(result), b"delivered");
    let job = super::super::cloud_file_outbox_claim(SCOPE[0].into(), vec![SCOPE[1].into()])
        .await
        .unwrap()
        .job
        .unwrap();
    super::super::cloud_file_outbox_settle(
        SCOPE[0].into(),
        job.id,
        job.lease,
        super::super::Outcome::Uploaded,
    )
    .await
    .unwrap();
    super::super::cloud_file_outbox_enqueue(
        SCOPE[0].into(),
        SCOPE[1].into(),
        SCOPE[2].into(),
        vec![candidate.clone()],
    )
    .await
    .unwrap();
    let receipt = super::super::cloud_file_snapshot_read(
        SCOPE[0].into(),
        SCOPE[1].into(),
        SCOPE[2].into(),
        candidate,
    )
    .await
    .unwrap();
    assert_eq!(receipt.status, "uploaded");
    assert!(receipt.bytes_base64.is_none());
    assert!(receipt.sha256.is_some());
    let conn = database::db::get_connection().unwrap();
    let used: i64 = conn
        .query_row(
            "SELECT bytes FROM cloud_file_snapshot_usage WHERE id=1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(used, 0);
}

#[test]
fn stale_lease_cannot_release_captured_bytes_and_failed_capture_never_marks_uploaded() {
    let conn = database();
    super::super::init_tables(&conn).unwrap();
    let candidate = file("/report");
    save(&conn, &SCOPE, &candidate, Ok(captured(b"captured"))).unwrap();
    super::super::enqueue(
        &conn,
        SCOPE[0],
        SCOPE[1],
        SCOPE[2],
        std::slice::from_ref(&candidate),
    )
    .unwrap();
    let first = super::super::claim(&conn, SCOPE[0], &[SCOPE[1].into()], 0)
        .unwrap()
        .job
        .unwrap();
    let second = super::super::claim(&conn, SCOPE[0], &[SCOPE[1].into()], super::super::LEASE_MS)
        .unwrap()
        .job
        .unwrap();
    super::super::settle(
        &conn,
        SCOPE[0],
        first.id,
        &first.lease,
        super::super::Outcome::Uploaded,
        1,
    )
    .unwrap();
    assert_eq!(
        decode(read(&conn, &SCOPE, &candidate).unwrap()),
        b"captured"
    );
    super::super::settle(
        &conn,
        SCOPE[0],
        second.id,
        &second.lease,
        super::super::Outcome::CaptureFailed,
        2,
    )
    .unwrap();
    assert_eq!(read(&conn, &SCOPE, &candidate).unwrap().status, "captured");
    assert!(super::super::claim(
        &conn,
        SCOPE[0],
        &[SCOPE[1].into()],
        super::super::LEASE_MS * 2
    )
    .unwrap()
    .job
    .is_none());
}

#[cfg(windows)]
#[test]
fn capture_handle_rejects_concurrent_write_access() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("report");
    std::fs::write(&path, b"original").unwrap();
    let snapshot = platform_snapshot(&path).unwrap();
    assert!(std::fs::OpenOptions::new().write(true).open(&path).is_err());
    drop(snapshot);
    assert!(std::fs::OpenOptions::new().write(true).open(&path).is_ok());
}

#[test]
fn incremental_blob_read_is_bounded_and_preserves_capture_after_source_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large");
    let bytes: Vec<u8> = (0..(super::super::snapshot_chunks::CHUNK_BYTES * 3 + 17))
        .map(|n| (n % 251) as u8)
        .collect();
    std::fs::write(&path, &bytes).unwrap();
    let source = capture(path.to_str().unwrap());
    #[cfg(target_os = "linux")]
    if matches!(source, Err("atomic_capture_unsupported")) {
        return;
    }
    let conn = database();
    let candidate = file(path.to_str().unwrap());
    save(&conn, &SCOPE, &candidate, source).unwrap();
    std::fs::remove_file(path).unwrap();
    let mut result = Vec::new();
    while result.len() < bytes.len() {
        let chunk =
            super::super::snapshot_chunks::read(&conn, &SCOPE, &candidate, result.len()).unwrap();
        assert_eq!(chunk.status, "captured");
        assert_eq!(chunk.size, bytes.len());
        assert_eq!(
            chunk.sha256.as_deref(),
            Some(format!("{:x}", Sha256::digest(&bytes)).as_str())
        );
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(chunk.bytes_base64.unwrap())
            .unwrap();
        assert!(decoded.len() <= super::super::snapshot_chunks::CHUNK_BYTES);
        result.extend(decoded);
    }
    assert_eq!(result, bytes);
    assert_eq!(
        super::super::snapshot_chunks::read(&conn, &SCOPE, &candidate, bytes.len() + 1)
            .unwrap()
            .status,
        "integrity_error"
    );
    assert_eq!(
        super::super::snapshot_chunks::read(&conn, &["other", "org", "root"], &candidate, 0)
            .unwrap()
            .status,
        "not_captured"
    );
}

#[test]
fn legacy_accounting_trigger_upgrades_without_rewriting_receipts() {
    let conn = database();
    let candidate = file("/legacy");
    save(&conn, &SCOPE, &candidate, Ok(captured(b"old bytes"))).unwrap();
    // Simulate the previous trigger definition over an existing receipt.
    conn.execute_batch("DROP TRIGGER cloud_snapshot_update;
        CREATE TRIGGER cloud_snapshot_update AFTER UPDATE OF bytes,size_bytes ON cloud_file_snapshots BEGIN
          UPDATE cloud_file_snapshot_usage SET bytes=bytes
            - CASE WHEN OLD.bytes IS NOT NULL THEN OLD.size_bytes ELSE 0 END
            + CASE WHEN NEW.bytes IS NOT NULL THEN NEW.size_bytes ELSE 0 END WHERE id=1;
        END;").unwrap();
    for _ in 0..2 {
        init(&conn).unwrap();
        assert_eq!(
            decode(read(&conn, &SCOPE, &candidate).unwrap()),
            b"old bytes"
        );
        let used: i64 = conn
            .query_row("SELECT bytes FROM cloud_file_snapshot_usage", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(used, 9);
    }
    let triggers: Vec<String> = conn
        .prepare(
            "SELECT sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'cloud_snapshot_%'",
        )
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(triggers.len(), 3);
    assert!(triggers
        .iter()
        .all(|sql| !sql.contains("OLD.bytes") && !sql.contains("NEW.bytes")));
    conn.execute(
        "UPDATE cloud_file_snapshots SET bytes=NULL,status='uploaded'",
        [],
    )
    .unwrap();
    assert_eq!(
        conn.query_row("SELECT bytes FROM cloud_file_snapshot_usage", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let next = file("/next");
    save(&conn, &SCOPE, &next, Ok(captured(b"next"))).unwrap();
    conn.execute("DELETE FROM cloud_file_snapshots WHERE path='/next'", [])
        .unwrap();
    assert_eq!(
        conn.query_row("SELECT bytes FROM cloud_file_snapshot_usage", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}
