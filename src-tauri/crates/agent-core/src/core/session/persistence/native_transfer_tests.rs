use super::*;

fn seed(session_id: &str) {
    let conn = get_connection().unwrap();
    crate::persistence::test_schema::ensure_agent_sessions_schema(&conn);
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, tool_name TEXT, tool_call_id TEXT, tool_input TEXT,
        tool_output TEXT, model TEXT, sequence INTEGER NOT NULL, created_at TEXT NOT NULL,
        images TEXT, compact_from_sequence INTEGER, compact_tokens_before INTEGER,
        compact_tokens_after INTEGER, tool_is_error INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_type TEXT NOT NULL,
        function_name TEXT, result_json TEXT NOT NULL, created_at TEXT NOT NULL
    );",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_sessions
        (session_id,name,status,created_at,updated_at)
        VALUES (?1,'Transfer fixture','completed','now','now')",
        [session_id],
    )
    .unwrap();
}

fn bind(session_id: &str, message_id: &str, intent: &str) {
    let conn = get_connection().unwrap();
    conn.execute(
        "INSERT INTO events
        (id,session_id,event_type,function_name,result_json,created_at)
        VALUES (?1,?2,'user_message','user_message',?3,'now')",
        params![
            format!("user-message-{session_id}-{message_id}"),
            session_id,
            serde_json::json!({"messageId":message_id,"turnIntentId":intent}).to_string()
        ],
    )
    .unwrap();
}

#[tokio::test]
async fn native_ipc_embeds_disk_images_without_cli_refs_and_preserves_display_rows() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "sdeagent-transfer-images";
    seed(sid);
    let url = "data:image/png;base64,QUJD".to_string();
    let id = super::super::save_user_msg(sid, "inspect", Some(&[url.clone()])).unwrap();
    bind(sid, &id, "image-intent");
    let stored = super::super::load_messages(sid).unwrap();
    let paths: Vec<String> = serde_json::from_str(stored[0].images.as_ref().unwrap()).unwrap();
    assert!(!paths[0].starts_with("data:"));
    // No code_session_image_refs or native-transcript-id table is needed by Agent history.
    for _ in 0..2 {
        let native = crate::state::commands::agent_load_messages(sid.into(), Some(true))
            .await
            .unwrap();
        assert_eq!(native[0]["turnIntentId"], "image-intent");
        assert_eq!(
            native[0]["images"],
            serde_json::to_string(&[url.clone()]).unwrap()
        );
    }
    let display = crate::state::commands::agent_load_messages(sid.into(), None)
        .await
        .unwrap();
    assert_eq!(display[0]["images"], stored[0].images.clone().unwrap());
    assert!(display[0].get("turnIntentId").is_none());
    assert_eq!(
        super::super::load_messages(sid).unwrap()[0].images,
        stored[0].images
    );
}

#[test]
fn native_identity_uses_durable_message_ids_for_repeated_expanded_prompts() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "sdeagent-transfer-force-send";
    seed(sid);
    let first = super::super::save_user_msg(sid, "expanded provider prompt", None).unwrap();
    let second = super::super::save_user_msg(sid, "expanded provider prompt", None).unwrap();
    bind(sid, &first, "old-turn");
    bind(sid, &second, "force-send-turn");
    seed("sdeagent-other");
    bind("sdeagent-other", &second, "unrelated-turn");
    let rows = load_messages_for_native_transfer(sid).unwrap();
    assert_eq!(rows[0]["turnIntentId"], "old-turn");
    assert_eq!(rows[1]["turnIntentId"], "force-send-turn");
    assert_eq!(rows[1]["content"], "expanded provider prompt");
}

#[test]
fn exact_transfer_keeps_missing_attachments_as_visible_errors() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "sdeagent-transfer-missing";
    seed(sid);
    let id =
        super::super::save_user_msg(sid, "inspect", Some(&["data:image/png;base64,QUJD".into()]))
            .unwrap();
    let stored = super::super::load_messages(sid).unwrap();
    let paths: Vec<String> = serde_json::from_str(stored[0].images.as_ref().unwrap()).unwrap();
    std::fs::remove_file(&paths[0]).unwrap();
    assert!(load_messages_for_native_transfer(sid)
        .unwrap_err()
        .to_string()
        .contains("historical image is unavailable"));
    assert_eq!(super::super::load_messages(sid).unwrap()[0].id, id);
}

#[test]
fn compacted_away_images_do_not_block_the_effective_native_frame() {
    let _sandbox = test_helpers::test_env::sandbox();
    let sid = "sdeagent-transfer-compacted";
    seed(sid);
    super::super::save_user_msg(sid, "superseded image", None).unwrap();
    let conn = get_connection().unwrap();
    conn.execute(
        "UPDATE agent_messages SET images='[\"missing.png\"]' WHERE session_id=?1",
        [sid],
    )
    .unwrap();
    super::super::save_user_msg(sid, "retained", None).unwrap();
    conn.execute(
        "INSERT INTO agent_messages
        (id,session_id,role,content,sequence,created_at,compact_from_sequence)
        VALUES ('summary',?1,'system','summary',2,'now',1)",
        [sid],
    )
    .unwrap();
    let rows = load_messages_for_native_transfer(sid).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["content"], "summary");
    assert_eq!(rows[1]["content"], "retained");
}
