use super::*;

#[test]
fn backfill_cannot_publish_inbox_transcripts_before_the_formal_source_writer() {
    let conn = Connection::open_in_memory().unwrap();
    crate::schema::init_session_tables(&conn).unwrap();
    conn.execute_batch(
        "CREATE TABLE agent_messages (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
            content TEXT NOT NULL, sequence INTEGER NOT NULL, created_at TEXT NOT NULL, images TEXT
         );
         CREATE TABLE agent_org_runtime_inbox_materializations (
            inbox_id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
            transcript_message_id TEXT NOT NULL, transcript_intent_id TEXT NOT NULL,
            materialized_at TEXT NOT NULL
         );
         CREATE INDEX idx_agent_org_runtime_inbox_materializations_session
            ON agent_org_runtime_inbox_materializations(session_id,inbox_id);
         INSERT INTO agent_messages VALUES
            ('ordinary','session','user','[Agent Org inbox message] quoted by the user',0,'2026-09-24T00:00:00Z',NULL),
            ('mail','session','user','A member delivered work',1,'2026-09-24T00:00:01Z',NULL);
         INSERT INTO agent_org_runtime_inbox_materializations VALUES
            (1,'session','mail','stable-batch-id','2026-09-24T00:00:01Z'),
            (2,'session','mail','stable-batch-id','2026-09-24T00:00:01Z');",
    ).unwrap();

    // A history read lands after the atomic message/receipt write, before the
    // formal event writer has attached the real execution and sender metadata.
    assert_eq!(backfill_missing_user_events(&conn, "session").unwrap(), 1);
    assert!(
        !conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE id='user-message-mail')",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap(),
        "a reader must not manufacture a provenance-free user event for model mail"
    );
    assert_eq!(backfill_missing_user_events(&conn, "session").unwrap(), 0);

    let source = serde_json::json!({
        "type": "user", "messageId": "mail", "turnIntentId": "stable-batch-id",
        "message": {"role":"user", "content":"A member delivered work"},
        "agentOrgInboxTranscript": true,
        "agentOrgExecution": {
            "turnIntentId":"actual-execution", "participantId":"coordinator",
            "participantName":"Coordinator", "sourceKind":"member_messages", "inboxCount":2
        }
    })
    .to_string();
    conn.execute(
        "INSERT INTO events (id,session_id,event_type,function_name,args_json,result_json,content,created_at,history_sequence)
         VALUES ('user-message-mail','session','raw','user_message','{}',?1,'user_message A member delivered work','2026-09-24T00:00:01Z',1)",
        [&source],
    ).unwrap();
    // The live delivery receipts can be retired after read acknowledgment.
    // The durable event still owns both message and execution identities.
    conn.execute("DELETE FROM agent_org_runtime_inbox_materializations", [])
        .unwrap();
    assert_eq!(backfill_missing_user_events(&conn, "session").unwrap(), 0);
    let stored: String = conn
        .query_row(
            "SELECT result_json FROM events WHERE id='user-message-mail'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, source);
    assert_eq!(
        load_user_messages(&conn, "session").unwrap().len(),
        2,
        "provider history remains intact; only the generic backfill writer is restricted"
    );
}
