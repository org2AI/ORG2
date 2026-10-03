use super::*;

fn owned(id: &str, intent: &str, source: EventSource) -> SessionEvent {
    let mut event = make_event(id, "tool_call");
    event.source = source;
    event.args = serde_json::json!({"agentOrgExecution": {"turnIntentId": intent}});
    event
}

#[test]
fn unload_execution_without_user_header_removes_noncontiguous_owned_body_only() {
    let mut store = EventStore::new();
    store.set_round_window(vec![
        owned("summary-tool", "summary", EventSource::Assistant),
        owned("new-input", "next", EventSource::User),
        owned("new-tool", "next", EventSource::Assistant),
        owned("late-summary-tool", "summary", EventSource::Assistant),
    ]);
    let mut placeholder = make_turn_placeholder(
        "agent-org-execution-summary",
        Some("agent-org-execution-next"),
    );
    placeholder.args = serde_json::json!({"agentOrgExecution": {"turnIntentId": "summary"}});
    assert_eq!(
        store.unload_turn_body("agent-org-execution-summary", placeholder.clone()),
        2
    );
    assert!(store.get_by_id("summary-tool").is_none());
    assert!(store.get_by_id("late-summary-tool").is_none());
    assert!(store.get_by_id("new-tool").is_some());
    assert!(store.get_by_id("new-input").is_some());
    assert!(store.get_by_id(&placeholder.id).is_some());
    assert_eq!(
        store.unload_turn_body("agent-org-execution-summary", placeholder),
        0
    );
}
