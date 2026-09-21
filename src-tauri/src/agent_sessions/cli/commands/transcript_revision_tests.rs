//! Exercise the actual revision producer against the production SQLite schema.
use super::{load_cli_transcript_revision, load_session_chunks};
use crate::agent_sessions::cli::persistence::{self, CreateCodeSessionParams};
use crate::agent_sessions::cli::types::SessionStatus;
use crate::test_utils::test_env;

fn empty_child(id: &str) {
    let params: CreateCodeSessionParams = serde_json::from_value(serde_json::json!({
        "platform": "claude_code",
        "parentSessionId": "[\"org2-conversation\",1,\"local-session\",[],\"cliagent-root\"]",
        "repoPath": "/tmp",
        "accountId": "account-a"
    }))
    .unwrap();
    persistence::create_session(id, &params).unwrap();
    persistence::update_status(id, SessionStatus::Failed).unwrap();
}

fn revision(id: &str) -> Option<String> {
    let result = load_cli_transcript_revision(id).unwrap();
    assert!(result.native);
    result.revision
}

#[test]
fn unstarted_native_child_revision_is_stable_read_only_and_identity_scoped() {
    let _sandbox = test_env::sandbox();
    empty_child("cliagent-empty");
    empty_child("cliagent-other");
    let conn = database::db::get_connection().unwrap();
    let before: String = conn
        .query_row(
            "SELECT updated_at FROM code_sessions WHERE session_id = 'cliagent-empty'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let token = revision("cliagent-empty").expect("proven empty child");
    assert!(load_session_chunks("cliagent-empty").unwrap().is_empty());
    assert_eq!(Some(token.clone()), revision("cliagent-empty"));
    assert_ne!(Some(token.clone()), revision("cliagent-other"));
    let payload: serde_json::Value = serde_json::from_str(&token).unwrap();
    assert_eq!(payload[0], "unstarted-native-child-v1");
    conn.execute(
        "UPDATE code_sessions SET status = 'cancelled' WHERE session_id = 'cliagent-empty'",
        [],
    )
    .unwrap();
    assert_ne!(Some(token), revision("cliagent-empty"));
    let after: String = conn
        .query_row(
            "SELECT updated_at FROM code_sessions WHERE session_id = 'cliagent-empty'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before, after);
    assert!(
        persistence::get_cli_session_id_for_account("cliagent-empty", Some("account-a"))
            .unwrap()
            .is_none()
    );
}

#[test]
fn unstarted_native_child_revision_rejects_roots_live_and_started_sessions() {
    let _sandbox = test_env::sandbox();
    let conn = database::db::get_connection().unwrap();
    for (index, assignment) in [
        "parent_session_id = NULL",
        "parent_session_id = ''",
        "parent_session_id = ' '",
        "status = 'pending'",
        "status = 'running'",
        "status = 'idle'",
        "status = 'completed'",
        "user_input = ''",
        "user_input = 'dispatched prompt'",
        "pid = 123",
        "cli_session_id = 'missing-provider-file'",
        "token_usage = '{}'",
    ]
    .iter()
    .enumerate()
    {
        let id = format!("cliagent-reject-{index}");
        empty_child(&id);
        conn.execute(
            &format!("UPDATE code_sessions SET {assignment} WHERE session_id = ?1"),
            [&id],
        )
        .unwrap();
        assert!(revision(&id).is_none(), "must reject {assignment}");
    }
    empty_child("cliagent-chunks");
    conn.execute("UPDATE code_sessions SET transcript_source = 'chunks' WHERE session_id = 'cliagent-chunks'", []).unwrap();
    let legacy = load_cli_transcript_revision("cliagent-chunks").unwrap();
    assert!(!legacy.native);
    assert!(legacy.revision.is_none());
    assert!(
        persistence::unstarted_native_child_revision("missing-session")
            .unwrap()
            .is_none()
    );
}

#[test]
fn unstarted_native_child_revision_rejects_each_durable_history_or_dispatch_witness() {
    let _sandbox = test_env::sandbox();
    let conn = database::db::get_connection().unwrap();
    // Even zero-count metadata and failed/stale intents disqualify the proof:
    // missing files after dispatch must retain the existing history-lost error.
    for (index, sql) in [
        "INSERT INTO events (id,session_id,event_type,created_at) VALUES ('event',?1,'user_message','now')",
        "INSERT INTO sessions (session_id,cached_at) VALUES (?1,'now')",
        "INSERT INTO session_turns (session_id,turn_id,start_sequence,started_at,status,updated_at) VALUES (?1,'turn',0,'now','failed','now')",
        "INSERT INTO session_turn_intents (session_id,turn_intent_id,source,status,created_at,updated_at) VALUES (?1,'intent','cli','failed','now','now')",
        "INSERT INTO code_session_chunks (chunk_id,session_id,action_type,function,sequence,created_at) VALUES ('chunk',?1,'raw','user_message',0,'now')",
        "INSERT INTO code_session_cli_resume_state (session_id,profile_key,cli_session_id,updated_at) VALUES (?1,'another-account','unreadable-native','now')",
        "INSERT INTO code_session_native_transcript_ids (session_id,source,source_session_id,bound_at) VALUES (?1,'claude','old-native','now')",
        "INSERT INTO code_session_history_mutations (session_id,reason,mutated_at) VALUES (?1,'rewind','now')",
        "INSERT INTO code_session_image_refs (session_id,image_path,created_at) VALUES (?1,'image.png','now')",
        "INSERT INTO shell_replays (session_id,call_id,relative_path,status,created_at,updated_at) VALUES (?1,'call','replay','failed','now','now')",
        "INSERT INTO session_llm_usage_spans (session_id,turn_id,iteration_index,created_at) VALUES (?1,'turn',0,'now')",
        "INSERT INTO session_token_usage (session_id,session_type,created_at) VALUES (?1,'cli','now')",
    ].iter().enumerate() {
        let id = format!("cliagent-evidence-{index}");
        empty_child(&id);
        assert!(revision(&id).is_some());
        conn.execute(sql, [&id]).unwrap();
        assert!(revision(&id).is_none(), "must reject evidence: {sql}");
    }
    // Evidence on another child cannot poison this child's empty prefix.
    empty_child("cliagent-isolated");
    assert!(revision("cliagent-isolated").is_some());
}

#[test]
fn unstarted_native_child_revision_disappears_when_a_turn_is_accepted() {
    let _sandbox = test_env::sandbox();
    empty_child("cliagent-accept");
    assert!(revision("cliagent-accept").is_some());
    persistence::accept_cli_turn("cliagent-accept", "accepted-intent", "message").unwrap();
    persistence::update_status("cliagent-accept", SessionStatus::Failed).unwrap();
    assert!(revision("cliagent-accept").is_none());
}

#[test]
fn unstarted_native_child_revision_never_recovers_a_bound_missing_file() {
    let _sandbox = test_env::sandbox();
    empty_child("cliagent-bound");
    persistence::stage_cli_session_id_for_account(
        "cliagent-bound",
        Some("account-a"),
        "missing-native-file",
    )
    .unwrap();
    assert!(revision("cliagent-bound").is_none());
}

#[test]
fn unstarted_native_child_revision_propagates_sql_errors() {
    let _sandbox = test_env::sandbox();
    empty_child("cliagent-read-error");
    let conn = database::db::get_connection().unwrap();
    conn.execute("DROP TABLE code_session_history_mutations", [])
        .unwrap();
    assert!(load_cli_transcript_revision("cliagent-read-error").is_err());
}
