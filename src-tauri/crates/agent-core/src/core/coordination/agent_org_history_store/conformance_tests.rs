use super::*;

#[test]
fn saved_materialization_preserves_membership_without_a_template_snapshot_or_parent_link() {
    let conn = database();
    seed_old(&conn);
    conn.execute_batch(
        "UPDATE agent_org_runtime_runs SET org_snapshot_json=NULL;
         UPDATE agent_sessions SET parent_session_id=NULL WHERE session_id='member';",
    )
    .unwrap();
    init_agent_org_schemas(&conn).unwrap();
    let member = descriptor(&conn, "member").unwrap().unwrap();
    assert_eq!(member.root_session_id.as_deref(), Some("root"));
    assert_eq!(member.members.len(), 2);
    assert!(member.members.iter().any(|m| {
        m.session_id == "member"
            && m.member_id.as_deref() == Some("alice")
            && m.name.as_deref() == Some("Alice")
    }));
    let copied_body: String = conn
        .query_row(
            "SELECT e.content FROM org_history_copies c
             JOIN events e ON e.session_id=c.copy_session_id
             WHERE c.source_session_id='member'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(copied_body, "Saved member reply");
    assert_eq!(count(&conn, "agent_org_execution_runs"), 0);
}

#[test]
fn finalization_and_background_history_inputs_retire_without_interpreting_execution_state() {
    // These two branch heads have identical 39-table DDL, including the four
    // changes that make the official old validator reject either version.
    let schema = include_str!("../fixtures/background_history_agent_org.sql");
    let conn = database();
    seed_with_schema(&conn, schema);
    assert_eq!(
        old_fingerprint(&conn),
        "d96f244c1ddb4293c82109cf8dc4ca0a41179f4aa464a22b81c69ffe65f9313c"
    );
    conn.execute_batch(
        "ALTER TABLE agent_org_runtime_runs ADD COLUMN intermediate_payload BLOB;
        UPDATE agent_org_runtime_runs SET intermediate_payload=X'0001ff';",
    )
    .unwrap();
    init_agent_org_schemas(&conn).unwrap();
    assert_eq!(
        descriptor(&conn, "root").unwrap().unwrap().mode,
        HistoryMode::HistoryOnly
    );
    assert_eq!(count(&conn, "agent_org_execution_runs"), 0);
    let blob: Vec<u8> = conn
        .query_row(
            "SELECT intermediate_payload FROM org_history_raw_1_agent_org_runtime_runs",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(blob, [0, 1, 255]);
    assert!(page(&conn, "root", None, 100)
        .unwrap()
        .items
        .iter()
        .any(|i| i.content == "Saved report"));
}

#[test]
fn completion_marker_with_all_execution_tables_missing_is_corruption_not_first_install() {
    let conn = database();
    seed_old(&conn);
    init_agent_org_schemas(&conn).unwrap();
    let names=conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_org_execution_%'").unwrap()
        .query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=OFF").unwrap();
    for name in names {
        conn.execute_batch(&format!("DROP TABLE {}", quoted(&name)))
            .unwrap();
    }
    let before = count(&conn, "org_history_schema_objects");
    assert!(init_agent_org_schemas(&conn).is_err());
    assert!(!table_exists(&conn, "agent_org_execution_runs").unwrap());
    assert_eq!(count(&conn, "org_history_schema_objects"), before);
    assert_eq!(count(&conn, "org_history_sessions"), 2);
}

#[test]
fn repeated_old_team_import_does_not_retire_current_members_or_rescan_archived_bodies() {
    let conn = database();
    seed_old(&conn);
    init_agent_org_schemas(&conn).unwrap();
    conn.execute_batch("INSERT INTO agent_sessions(session_id,name,status,created_at,updated_at,org_member_id)
        VALUES ('current-member','Current member','running','now','now','alice');
        INSERT INTO agent_org_execution_runs
        (id,org_id,coordinator_agent_id,root_session_id,entry_mode,status,created_at,updated_at)
        VALUES ('current-run','org','coord','current-root','standalone_session','running','now','now');
        INSERT INTO agent_org_execution_member_materializations
        (org_run_id,member_id,agent_id,generation,session_id,authority_class,status,created_at,updated_at)
        VALUES ('current-run','alice','agent',1,'current-member','starting','succeeded','now','now');
        INSERT INTO agent_sessions(session_id,name,status,created_at,updated_at)
        VALUES ('old-new','Downgrade team','idle','now','now');
        INSERT INTO agent_org_runtime_runs
        (id,org_id,coordinator_agent_id,root_session_id,entry_mode,status,created_at,updated_at)
        VALUES ('old-new-run','org','coord','old-new','standalone_session','idle','now','now');").unwrap();
    // Any attempt to scan/re-copy already archived bodies would now include this
    // additional row; the next cutover owns only previously unimported sources.
    event(&conn, "root", "after-retirement", "Not a new source", 2);
    init_agent_org_schemas(&conn).unwrap();
    assert!(!is_history(&conn, "current-member").unwrap());
    assert!(is_history(&conn, "old-new").unwrap());
    assert!(!page(&conn, "root", None, 100)
        .unwrap()
        .items
        .iter()
        .any(|i| i.content == "Not a new source"));
    assert_eq!(count(&conn, "agent_org_execution_runs"), 1);
}

#[test]
fn large_archive_pages_use_keyset_index_and_normal_restart_writes_no_history() {
    let conn = database();
    seed_old(&conn);
    conn.execute_batch("BEGIN").unwrap();
    for n in 0..5000 {
        event(
            &conn,
            "root",
            &format!("large-{n}"),
            &"x".repeat(1024),
            n + 2,
        );
    }
    conn.execute_batch("COMMIT").unwrap();
    let start = std::time::Instant::now();
    init_agent_org_schemas(&conn).unwrap();
    let migration = start.elapsed();
    let changes = conn.total_changes();
    let start = std::time::Instant::now();
    for _ in 0..3 {
        init_agent_org_schemas(&conn).unwrap();
    }
    let restart = start.elapsed();
    assert_eq!(conn.total_changes(), changes);
    let query_plan: String = conn
        .query_row(
            "EXPLAIN QUERY PLAN SELECT id FROM org_history_items
        WHERE root_session_id=?1 AND (created_at,id)>(?2,?3) ORDER BY created_at,id LIMIT 51",
            ["root", "2026-09-01", "item"],
            |r| r.get(3),
        )
        .unwrap();
    assert!(query_plan.contains("idx_org_history_items_page"));
    let first = page(&conn, "root", None, 50).unwrap();
    assert_eq!(first.items.len(), 50);
    assert!(first.next_cursor.is_some());
    eprintln!("5,000 KiB history: atomic import {migration:?}; three normal restarts {restart:?}; one page {} rows",first.items.len());
}

#[test]
fn two_initializers_archive_populated_database_exactly_once() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let conn = Connection::open(file.path()).unwrap();
    crate::foundation::persistence::test_schema::ensure_agent_sessions_schema(&conn);
    crate::foundation::persistence::test_schema::ensure_session_events_schema(&conn);
    conn.execute_batch("CREATE TABLE session_turn_intents(session_id TEXT,turn_intent_id TEXT,org_run_id TEXT,status TEXT);").unwrap();
    seed_old(&conn);
    drop(conn);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let workers = (0..2)
        .map(|_| {
            let path = file.path().to_owned();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let conn = Connection::open(path).unwrap();
                conn.busy_timeout(std::time::Duration::from_secs(5))
                    .unwrap();
                barrier.wait();
                init_agent_org_schemas(&conn).unwrap();
            })
        })
        .collect::<Vec<_>>();
    for worker in workers {
        worker.join().unwrap();
    }
    let conn = Connection::open(file.path()).unwrap();
    assert_eq!(count(&conn, "org_history_archives"), 1);
    assert_eq!(count(&conn, "org_history_sessions"), 2);
    assert_eq!(count(&conn, "org_history_copies"), 2);
    assert_eq!(count(&conn, "agent_org_execution_runs"), 0);
}
