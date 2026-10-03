use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

use super::*;
use crate::coordination::init_agent_org_schemas;

fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    crate::foundation::persistence::test_schema::ensure_agent_sessions_schema(&conn);
    conn.execute_batch("CREATE TABLE events (
        id TEXT PRIMARY KEY,session_id TEXT NOT NULL,event_type TEXT NOT NULL,function_name TEXT,
        thread_id TEXT,args_json TEXT NOT NULL DEFAULT '{}',result_json TEXT NOT NULL DEFAULT '{}',
        content TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,meta_json TEXT,history_sequence INTEGER,
        UNIQUE(id,session_id));
        CREATE INDEX idx_events_session_id ON events(session_id);
        CREATE TABLE session_turn_intents(session_id TEXT,turn_intent_id TEXT,org_run_id TEXT,status TEXT);")
        .unwrap();
    conn
}

fn seed_old(conn: &Connection) {
    seed_with_schema(
        conn,
        include_str!("../fixtures/official_v2_0_8_agent_org.sql"),
    );
}

fn seed_with_schema(conn: &Connection, schema: &str) {
    conn.execute_batch(schema).unwrap();
    conn.execute_batch("INSERT INTO agent_sessions(session_id,name,status,created_at,updated_at,org_member_id)
        VALUES ('root','Original Team','running','2026-09-01','2026-09-01','coordinator');
        INSERT INTO agent_sessions(session_id,name,status,created_at,updated_at,org_member_id,parent_session_id)
        VALUES ('member','Alice','running','2026-09-01','2026-09-01','alice','root');
        INSERT INTO agent_org_runtime_runs
        (id,org_id,coordinator_agent_id,root_session_id,org_snapshot_json,entry_mode,status,created_at,updated_at)
        VALUES ('run-old','org','coord','root','{\"orgName\":\"Original Team\",\"members\":[{\"id\":\"alice\",\"name\":\"Alice\"}]}',
            'standalone_session','running','2026-09-01','2026-09-01');
        INSERT INTO agent_org_runtime_member_materializations
        (org_run_id,member_id,agent_id,generation,session_id,authority_class,status,created_at,updated_at)
        VALUES ('run-old','alice','agent',1,'member','starting','succeeded','2026-09-01','2026-09-01');
        INSERT INTO session_turn_intents VALUES ('member','pending-turn','run-old','queued');
        INSERT INTO agent_org_runtime_inbox
        (recipient_agent_id,recipient_member_id,sender_agent_id,org_run_id,payload_kind,payload_json,created_at)
        VALUES ('agent','alice','_user','run-old','plain','{\"kind\":\"plain\",\"summary\":\"Question\",\"text\":\"Saved group question\"}', '2026-09-01');").unwrap();
    event(conn, "root", "report", "Saved report", 1);
    event(conn, "member", "reply", "Saved member reply", 1);
}

fn event(conn: &Connection, session: &str, id: &str, content: &str, sequence: i64) {
    conn.execute("INSERT OR REPLACE INTO events
        (id,session_id,event_type,function_name,result_json,content,created_at,history_sequence)
        VALUES (?1,?2,'raw','message',?3,?4,'2026-09-01',?5)",params![id,session,
        serde_json::json!({"message":{"content":content},"agent_org_execution":{"turn_intent_id":"pending-turn"},"turnIntentId":"pending-turn"}).to_string(),content,sequence]).unwrap();
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM {}", quoted(table)),
        [],
        |row| row.get(0),
    )
    .unwrap()
}

fn old_fingerprint(conn: &Connection) -> String {
    // Exact v2.0.8 scanner and hashing algorithm, including SQL whitespace.
    let mut stmt = conn
        .prepare(
            "SELECT type,name,tbl_name,sql FROM sqlite_master
        WHERE sql IS NOT NULL AND type IN ('table','index','trigger')
        AND (name LIKE 'agent_org_runtime_%' OR tbl_name LIKE 'agent_org_runtime_%')
        ORDER BY type,name",
        )
        .unwrap();
    let snapshot = stmt
        .query_map([], |row| {
            let kind: String = row.get(0)?;
            let name: String = row.get(1)?;
            let table: String = row.get(2)?;
            let sql: String = row.get(3)?;
            Ok(format!(
                "{kind}|{name}|{table}|{:x}\n",
                Sha256::digest(sql.trim().as_bytes())
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
        .concat();
    format!("{:x}", Sha256::digest(snapshot.as_bytes()))
}

#[test]
fn official_old_validator_accepts_fixed_area_beside_new_objects_and_archives() {
    let conn = database();
    seed_old(&conn);
    let expected = "ca0b99fc4d60fe4a4d691c405114d7e48009b8b86fdeec78cf1a0f82998cd352";
    assert_eq!(old_fingerprint(&conn), expected);
    init_agent_org_schemas(&conn).unwrap();
    assert_eq!(old_fingerprint(&conn), expected);
    assert_eq!(count(&conn, "agent_org_runtime_runs"), 0);
    assert_eq!(count(&conn, "agent_org_execution_runs"), 0);
    assert_eq!(count(&conn, "org_history_sessions"), 2);
    assert_eq!(count(&conn, "org_history_raw_1_agent_org_runtime_runs"), 1);
    let original: String = conn
        .query_row(
            "SELECT status FROM org_history_raw_1_agent_org_runtime_runs",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        original, "running",
        "retirement must not fabricate a task/run outcome"
    );
    assert_eq!(
        require_writable(&conn, "root").unwrap_err(),
        READ_ONLY_ERROR
    );
    assert_eq!(
        require_writable(&conn, "member").unwrap_err(),
        READ_ONLY_ERROR
    );
    assert_eq!(
        require_current_run(&conn, "run-old").unwrap_err(),
        READ_ONLY_ERROR
    );
    let view = descriptor(&conn, "member").unwrap().unwrap();
    assert_eq!(view.root_session_id.as_deref(), Some("root"));
    assert_eq!(view.members.len(), 2);
    assert!(page(&conn, "root", None, 10)
        .unwrap()
        .items
        .iter()
        .any(|item| item.content == "Saved group question"));
    let raw_active_objects: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
        WHERE tbl_name LIKE 'org_history_raw_%' AND type IN ('index','trigger')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw_active_objects, 0);
}

#[test]
fn official_old_group_mention_is_copied_before_execution_schema_exists() {
    let conn = database();
    seed_old(&conn);
    conn.execute(
        "UPDATE events SET result_json=?2 WHERE id=?1",
        params![
            "reply",
            serde_json::json!({
                "message": {"content": "Saved member reply"},
                "agent_org_user_directed_reply": {
                    "source_kind": "group_mention",
                    "content": "Saved member reply"
                }
            })
            .to_string()
        ],
    )
    .unwrap();

    init_agent_org_schemas(&conn).unwrap();

    assert_eq!(count(&conn, "agent_org_execution_runs"), 0);
    let copied: String = conn
        .query_row(
            "SELECT e.content FROM org_history_copies c
             JOIN events e ON e.session_id=c.copy_session_id
             WHERE c.source_session_id='member' AND e.content='Saved member reply'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(copied, "Saved member reply");
}

#[test]
fn partial_old_tables_keep_shared_member_identity_and_body_without_inventing_a_run() {
    let conn = database();
    seed_old(&conn);
    conn.execute_batch(
        "PRAGMA foreign_keys=OFF;DROP TABLE agent_org_runtime_runs;
        DROP TABLE agent_org_runtime_member_materializations;PRAGMA foreign_keys=ON;",
    )
    .unwrap();
    init_agent_org_schemas(&conn).unwrap();
    let view = descriptor(&conn, "member").unwrap().unwrap();
    assert_eq!(view.root_session_id.as_deref(), Some("root"));
    assert_eq!(count(&conn, "agent_org_execution_runs"), 0);
    let copy: String = conn
        .query_row(
            "SELECT copy_session_id FROM org_history_copies WHERE source_session_id='member'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT content FROM events WHERE session_id=?1",
            [copy],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "Saved member reply"
    );
    assert!(conn
        .query_row(
            "SELECT run_id FROM org_history_sessions WHERE session_id='member'",
            [],
            |r| r.get::<_, Option<String>>(0)
        )
        .unwrap()
        .is_none());
}

#[test]
fn raw_schema_blobs_and_all_changes_roll_back_when_completion_write_fails() {
    let conn = database();
    seed_old(&conn);
    conn.execute_batch(
        "CREATE TRIGGER reject_cutover BEFORE INSERT ON org_history_state
        BEGIN SELECT RAISE(ABORT,'injected storage failure'); END;",
    )
    .unwrap();
    assert!(init_agent_org_schemas(&conn).is_err());
    assert_eq!(count(&conn, "agent_org_runtime_runs"), 1);
    assert!(!table_exists(&conn, "agent_org_execution_runs").unwrap());
    assert!(!table_exists(&conn, "org_history_raw_1_agent_org_runtime_runs").unwrap());
    assert_eq!(count(&conn, "org_history_sessions"), 0);
    assert_eq!(count(&conn, "agent_sessions"), 2);
    let enabled: bool = conn
        .pragma_query_value(None, "foreign_keys", |r| r.get(0))
        .unwrap();
    assert!(enabled);
    conn.execute_batch("DROP TRIGGER reject_cutover").unwrap();
    init_agent_org_schemas(&conn).unwrap();
}

#[test]
fn restarts_validate_without_recopying_or_resetting_current_teams() {
    let conn = database();
    seed_old(&conn);
    init_agent_org_schemas(&conn).unwrap();
    conn.execute_batch(
        "INSERT INTO agent_org_execution_runs
        (id,org_id,coordinator_agent_id,root_session_id,entry_mode,status,created_at,updated_at)
        VALUES ('new-run','org','coord','new-root','standalone_session','running','now','now');",
    )
    .unwrap();
    let events = count(&conn, "events");
    let raw = count(&conn, "org_history_schema_objects");
    for _ in 0..3 {
        init_agent_org_schemas(&conn).unwrap();
    }
    assert_eq!(count(&conn, "events"), events);
    assert_eq!(count(&conn, "org_history_schema_objects"), raw);
    assert_eq!(count(&conn, "agent_org_execution_runs"), 1);
    assert!(require_writable(&conn, "new-root").is_ok());
    conn.execute_batch("DROP TABLE agent_org_execution_member_turn_admissions")
        .unwrap();
    assert!(init_agent_org_schemas(&conn).is_err());
    assert_eq!(count(&conn, "agent_org_execution_runs"), 1);
}

#[test]
fn downgrade_can_add_a_team_and_stale_intents_without_losing_copies_or_reimporting() {
    let conn = database();
    seed_old(&conn);
    init_agent_org_schemas(&conn).unwrap();
    let original_count = count(&conn, "events");
    conn.execute_batch("UPDATE session_turn_intents SET status='stale';
        INSERT INTO agent_sessions(session_id,name,status,created_at,updated_at)
        VALUES ('old-new-root','Created in old app','idle','now','now');
        INSERT INTO agent_org_runtime_runs
        (id,org_id,coordinator_agent_id,root_session_id,entry_mode,status,created_at,updated_at)
        VALUES ('old-new-run','org','coord','old-new-root','standalone_session','idle','now','now');").unwrap();
    event(
        &conn,
        "old-new-root",
        "old-new-event",
        "Downgrade conversation",
        1,
    );
    init_agent_org_schemas(&conn).unwrap();
    assert_eq!(count(&conn, "events"), original_count + 2);
    assert_eq!(count(&conn, "org_history_sessions"), 3);
    assert!(is_history(&conn, "old-new-root").unwrap());
    let sources = count(&conn, "org_history_schema_objects");
    init_agent_org_schemas(&conn).unwrap();
    assert_eq!(count(&conn, "org_history_schema_objects"), sources);
    assert_eq!(count(&conn, "events"), original_count + 2);
    assert_eq!(count(&conn, "agent_org_runtime_runs"), 0);
}

#[test]
fn event_mirror_is_incremental_idempotent_and_strips_execution_identity() {
    let conn = database();
    seed_old(&conn);
    init_agent_org_schemas(&conn).unwrap();
    event(&conn, "member", "incremental", "Newly saved text", 2);
    mirror_events(&conn, "member", &["incremental"]).unwrap();
    mirror_events(&conn, "member", &["incremental"]).unwrap();
    let copy: String = conn
        .query_row(
            "SELECT copy_session_id FROM org_history_copies WHERE source_session_id='member'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let (rows,raw):(i64,String)=conn.query_row("SELECT COUNT(*),result_json FROM events WHERE session_id=?1 AND content='Newly saved text'",[&copy],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert_eq!(rows, 1);
    assert!(!raw.contains("turnIntentId"));
    assert!(!raw.contains("agent_org_execution"));
    assert_eq!(require_writable(&conn, &copy).unwrap_err(), READ_ONLY_ERROR);
    let detached:bool=conn.query_row("SELECT org_id IS NULL AND org_member_id IS NULL AND parent_session_id IS NULL AND work_item_id IS NULL FROM agent_sessions WHERE session_id=?1",[copy],|r|r.get(0)).unwrap();
    assert!(detached);
}

#[test]
fn history_pages_are_bounded_stable_and_bound_to_the_requested_session() {
    let conn = database();
    seed_old(&conn);
    init_agent_org_schemas(&conn).unwrap();
    for id in 0..200 {
        conn.execute("INSERT INTO org_history_items VALUES (?1,'root',NULL,'output','body','2026-09-02','{}')",[format!("item-{id:03}")]).unwrap();
    }
    let first = page(&conn, "root", None, 25).unwrap();
    assert_eq!(first.items.len(), 25);
    let second = page(&conn, "root", first.next_cursor.as_deref(), 25).unwrap();
    assert_eq!(second.items.len(), 25);
    assert!(!second
        .items
        .iter()
        .any(|item| first.items.iter().any(|prior| prior.id == item.id)));
    assert!(page(&conn, "member", first.next_cursor.as_deref(), 25).is_err());
    assert_eq!(
        page(&conn, "root", None, usize::MAX).unwrap().items.len(),
        100
    );
    assert!(page(&conn, "root", Some("garbage"), 25).is_err());
}

#[path = "conformance_tests.rs"]
mod conformance_tests;
