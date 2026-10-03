use super::*;

#[test]
fn unloaded_execution_preserves_identity_without_exposing_it_as_display_text() {
    let turn: sqlite_cache::CachedTurnSummary = serde_json::from_value(serde_json::json!({
        "sessionId": "coordinator", "turnId": "agent-org-execution-mail",
        "startSequence": 10, "endSequence": 19, "nextTurnId": null,
        "startedAt": "2026-09-23T00:00:00Z", "endedAt": null,
        "durationMs": 25, "userEventIds": [], "userPreview": "",
        "eventCount": 8, "bodyEventCount": 7, "status": "completed",
        "interrupted": false, "turnIntentId": "mail",
        "execution": {"turnIntentId": "mail", "participantId": "coordinator",
            "participantName": "Coordinator", "sourceKind": "member_messages"}
    }))
    .unwrap();
    let event = make_turn_placeholder_event("coordinator", &turn);
    assert!(
        event.display_text.is_empty(),
        "The navigation must use its localized round label"
    );
    assert_eq!(event.args["agentOrgExecution"]["turnIntentId"], "mail");
    assert_eq!(event.result["unloadedTurn"]["turnId"], turn.turn_id);
    assert_eq!(event.args["historySequence"], 10);
}
