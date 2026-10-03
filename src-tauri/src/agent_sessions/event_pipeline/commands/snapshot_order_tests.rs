use super::notify::build_settled_snapshot_delta;
use crate::agent_sessions::event_pipeline::{
    derived::compute_derived, store::EventStore, types::SessionEvent,
};

fn execution(id: &str, at: &str, sequence: i64) -> SessionEvent {
    serde_json::from_value(serde_json::json!({
        "id": id, "chunk_id": null, "sessionId": "history-order",
        "createdAt": at, "functionName": "agent_org_execution",
        "uiCanonical": "agent_org_execution", "actionType": "agent_org_execution",
        "args": {"historySequence": sequence, "agentOrgExecution": {
            "turnIntentId": id, "participantId": "worker", "sourceKind": "task_dispatch"
        }}, "result": {}, "source": "system", "displayText": "Execution",
        "displayStatus": "completed", "displayVariant": "message", "activityStatus": "agent"
    }))
    .unwrap()
}

#[test]
fn late_history_hydration_keeps_full_and_settled_chat_order_identical() {
    let mut store = EventStore::new();
    store.set(vec![execution("new", "2026-09-23T21:00:00Z", 49)]);
    store.mark_full_snapshot_emitted();
    store.merge_events(vec![
        execution("old", "2026-09-23T20:00:00Z", 1),
        execution("middle", "2026-09-23T20:30:00Z", 18),
    ]);
    let full = compute_derived(store.events(), store.version());
    let delta = build_settled_snapshot_delta(&mut store);
    let expected = vec!["old", "middle", "new"];
    assert_eq!(
        full.chat_events
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(delta.chat_event_ids, expected);
    assert_eq!(
        delta.event_ids,
        vec!["new", "old", "middle"],
        "raw order is independent"
    );
    assert_eq!(
        build_settled_snapshot_delta(&mut store).chat_event_ids,
        expected
    );
}

#[test]
fn equal_timestamp_execution_order_uses_persisted_sequence_in_every_snapshot() {
    let mut store = EventStore::new();
    store.set(vec![
        execution("a-later", "2026-09-23T20:00:00Z", 18),
        execution("z-earlier", "2026-09-23T20:00:00Z", 1),
    ]);
    let full = compute_derived(store.events(), store.version());
    assert_eq!(
        full.chat_events
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        vec!["z-earlier", "a-later"]
    );
    store.mark_full_snapshot_emitted();
    assert_eq!(
        build_settled_snapshot_delta(&mut store).chat_event_ids,
        vec!["z-earlier", "a-later"]
    );
}
