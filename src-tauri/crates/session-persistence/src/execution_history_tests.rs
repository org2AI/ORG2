use super::*;
use crate::{load_initial_turn_window, load_turn_body_window, load_turn_index};

fn event(id: &str, intent: &str, user: bool) -> CachedEvent {
    let mut event = cached_event("org-history", id, "2026-09-23T01:00:00Z");
    event.function_name = Some(
        if user {
            "user_message"
        } else {
            "assistant_message"
        }
        .to_string(),
    );
    event.event_type = if user { "raw" } else { "assistant" }.to_string();
    event.result_json = serde_json::json!({
        "turnIntentId": if user { format!("message-dedup-{id}") } else { intent.to_string() },
        "agentOrgExecution": { "turnIntentId": intent, "sourceKind": if user { "member_messages" } else { "final_summary" },
            "participantId": "coordinator", "participantName": "Lead" }
    }).to_string();
    event
}

#[test]
fn formal_execution_pagination_preserves_batches_summary_and_late_output() {
    with_temp_orgii_home(|| {
        let conn = get_connection().unwrap();
        crate::schema::init_session_tables(&conn).unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, sequence INTEGER, created_at TEXT, images TEXT);").unwrap();
        save_events(
            "org-history",
            &[
                event("mail-a", "first", true),
                event("mail-b", "first", true),
                event("reply-first", "first", false),
                event("summary", "second", false),
                event("late-first", "first", false),
            ],
        )
        .unwrap();
        let turns = load_turn_index("org-history").unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].turn_id, "agent-org-execution-first");
        assert_eq!(turns[0].user_event_ids, ["mail-a", "mail-b"]);
        assert_eq!(turns[0].body_event_count, 2);
        assert!(turns[1].user_event_ids.is_empty());
        assert_eq!(
            turns[1].execution.as_ref().unwrap().turn_intent_id,
            "second"
        );
        let initial = load_initial_turn_window("org-history", 1).unwrap();
        assert_eq!(
            initial
                .events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            ["mail-a", "mail-b", "summary", "late-first"]
        );
        let first = load_turn_body_window("org-history", &turns[0].turn_id).unwrap();
        assert_eq!(
            first
                .events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            ["mail-a", "mail-b", "reply-first", "late-first"]
        );
        assert_eq!(
            load_turn_body_window("org-history", &turns[1].turn_id)
                .unwrap()
                .events
                .len(),
            1
        );
        // Re-reading and rebuilding keep the same ids; metadata never creates a user row.
        crate::rebuild_turn_index("org-history").unwrap();
        assert_eq!(
            load_turn_index("org-history").unwrap()[0].turn_id,
            turns[0].turn_id
        );
        let plan: String = conn.query_row(&format!("EXPLAIN QUERY PLAN SELECT id FROM events WHERE session_id=?1 AND ({})=?2 ORDER BY history_sequence", crate::turn_window::EXECUTION_OWNER_SQL), params!["org-history", "first"], |row| row.get(3)).unwrap();
        assert!(plan.contains("idx_events_execution_owner"), "{plan}");
    });
}

#[test]
fn ordinary_rounds_with_identical_timestamps_use_persisted_order() {
    with_temp_orgii_home(|| {
        let conn = get_connection().unwrap();
        crate::schema::init_session_tables(&conn).unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, sequence INTEGER, created_at TEXT, images TEXT);").unwrap();
        let mut events = vec![
            cached_event("ordinary", "first", "2026-09-23T01:00:00Z"),
            cached_event("ordinary", "answer", "2026-09-23T01:00:00Z"),
            cached_event("ordinary", "second", "2026-09-23T01:00:00Z"),
        ];
        events[1].function_name = Some("assistant_message".to_string());
        save_events("ordinary", &events).unwrap();
        let first = load_turn_body_window("ordinary", "first").unwrap();
        assert_eq!(
            first
                .events
                .iter()
                .map(|event| event.id.as_str())
                .collect::<Vec<_>>(),
            ["first", "answer"]
        );
    });
}

#[test]
fn empty_summary_execution_survives_an_unloaded_history_window() {
    with_temp_orgii_home(|| {
        let conn = get_connection().unwrap();
        crate::schema::init_session_tables(&conn).unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS agent_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, sequence INTEGER, created_at TEXT, images TEXT);").unwrap();
        let mut marker = event("agent-org-execution-summary", "summary", false);
        marker.event_type = "agent_org_execution".to_string();
        marker.function_name = Some("agent_org_execution".to_string());
        save_events("org-history", &[marker]).unwrap();
        let window = load_initial_turn_window("org-history", 0).unwrap();
        assert_eq!(window.turns.len(), 1);
        assert_eq!(window.turns[0].body_event_count, 0);
        assert!(window.turns[0].user_event_ids.is_empty());
        assert_eq!(window.events.len(), 1);
        assert_eq!(window.events[0].id, "agent-org-execution-summary");
    });
}
