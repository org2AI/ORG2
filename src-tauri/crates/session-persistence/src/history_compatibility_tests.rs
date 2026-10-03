//! Exercise the real shared transcript writer/reader, not only archive helpers.
use super::*;
use agent_core::coordination::{agent_org_history_store, init_agent_org_schemas};

fn seed_old_team(conn: &Connection) {
    crate::schema::init_session_tables(conn).unwrap();
    agent_core::persistence::session_snapshots::ensure_tables_with(conn).unwrap();
    agent_core::session::persistence::init(conn).unwrap();
    conn.execute_batch(include_str!(
        "../../agent-core/src/core/coordination/fixtures/official_v2_0_8_agent_org.sql"
    ))
    .unwrap();
    conn.execute_batch("INSERT INTO agent_sessions
        (session_id,name,status,session_type,created_at,updated_at,org_member_id)
        VALUES ('sde-history-root','Preserved team','running','sde','2026-09-24','2026-09-24','coordinator');
        INSERT INTO agent_org_runtime_runs
        (id,org_id,coordinator_agent_id,root_session_id,entry_mode,status,created_at,updated_at)
        VALUES ('old-run','old-org','coordinator','sde-history-root','standalone_session','running','2026-09-24','2026-09-24');").unwrap();
}

fn user_event(id: &str) -> CachedEvent {
    let mut event = cached_event("sde-history-root", id, "2026-09-24T00:00:00Z");
    event.content = "Saved user request".into();
    event.result_json = serde_json::json!({
        "type":"user", "backendPersisted":true,"turnIntentId":"pending",
        "syntheticUserInput":true,"agentOrgDirectSource":true,
        "message":{"role":"user","content":"Saved user request"}
    })
    .to_string();
    event
}

fn copy_id(conn: &Connection) -> String {
    conn.query_row(
        "SELECT copy_session_id FROM org_history_copies WHERE source_session_id='sde-history-root'",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn ordinary_copy_opens_through_session_loader_and_survives_old_stale_intents() {
    with_temp_orgii_home(|| {
        let conn = get_connection().unwrap();
        seed_old_team(&conn);
        save_events("sde-history-root", &[user_event("user-original")]).unwrap();
        conn.execute_batch(
            "INSERT INTO session_turn_intents
            (session_id,turn_intent_id,org_run_id,source,status,created_at,updated_at)
            VALUES ('sde-history-root','pending','old-run','agent_org','queued','now','now');",
        )
        .unwrap();
        init_agent_org_schemas(&conn).unwrap();
        let copy = copy_id(&conn);
        assert!(copy.starts_with(agent_core::definitions::prefix_lookup::SDE_SESSION_PREFIX));
        let loaded = load_session(&copy)
            .unwrap()
            .expect("official ordinary loader requires metadata");
        assert_eq!(loaded.events.len(), 1);
        assert_ne!(loaded.events[0].id, "user-original");
        let value: serde_json::Value = serde_json::from_str(&loaded.events[0].result_json).unwrap();
        assert!(value.get("turnIntentId").is_none());
        assert!(value.get("syntheticUserInput").is_none());
        assert_eq!(
            value.pointer("/message/content").unwrap(),
            "Saved user request"
        );
        // v2.0.8 startup can stale shared queue entries. Stored body stays visible.
        conn.execute("UPDATE session_turn_intents SET status='stale'", [])
            .unwrap();
        init_agent_org_schemas(&conn).unwrap();
        let turns = crate::rebuild_turn_index("sde-history-root").unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_preview, "Saved user request");
        assert_eq!(crate::rebuild_turn_index(&copy).unwrap().len(), 1);
        assert_eq!(load_session(&copy).unwrap().unwrap().events.len(), 1);
        assert_eq!(copy_id(&conn), copy);
    });
}

#[test]
fn current_source_writer_updates_copy_once_and_rolls_back_on_projection_failure() {
    with_temp_orgii_home(|| {
        let conn = get_connection().unwrap();
        crate::schema::init_session_tables(&conn).unwrap();
        agent_core::persistence::session_snapshots::ensure_tables_with(&conn).unwrap();
        agent_core::session::persistence::init(&conn).unwrap();
        init_agent_org_schemas(&conn).unwrap();
        conn.execute_batch("INSERT INTO agent_sessions
            (session_id,name,status,session_type,created_at,updated_at,org_member_id)
            VALUES ('sde-history-root','Current team','running','sde','now','now','coordinator');
            INSERT INTO agent_org_execution_runs
            (id,org_id,coordinator_agent_id,root_session_id,entry_mode,status,created_at,updated_at)
            VALUES ('new-run','org','coordinator','sde-history-root','standalone_session','running','now','now');").unwrap();
        let event = user_event("current-user");
        save_events("sde-history-root", std::slice::from_ref(&event)).unwrap();
        let copy = copy_id(&conn);
        let initial = get_session_metadata(&copy).unwrap().unwrap();
        save_events("sde-history-root", std::slice::from_ref(&event)).unwrap();
        assert_eq!(
            get_session_metadata(&copy)
                .unwrap()
                .unwrap()
                .content_revision,
            initial.content_revision
        );
        let mut changed = event;
        changed.content = "Edited saved text".into();
        save_events("sde-history-root", &[changed]).unwrap();
        assert_eq!(
            load_session(&copy).unwrap().unwrap().events[0].content,
            "Edited saved text"
        );
        let updated = get_session_metadata(&copy).unwrap().unwrap();
        assert_eq!(updated.event_count, 1);
        assert_eq!(updated.content_revision, initial.content_revision + 1);
        assert!(agent_org_history_store::require_writable(&conn, "sde-history-root").is_ok());
        assert!(agent_org_history_store::require_writable(&conn, &copy).is_err());
        conn.execute_batch(
            "CREATE TRIGGER reject_history_event BEFORE INSERT ON events
            WHEN EXISTS(SELECT 1 FROM org_history_copies WHERE copy_session_id=NEW.session_id)
            BEGIN SELECT RAISE(ABORT,'copy write failure'); END;",
        )
        .unwrap();
        assert!(save_events("sde-history-root", &[user_event("must-rollback")]).is_err());
        assert!(get_event("sde-history-root", "must-rollback")
            .unwrap()
            .is_none());
        assert_eq!(load_session(&copy).unwrap().unwrap().events.len(), 1);
    });
}
