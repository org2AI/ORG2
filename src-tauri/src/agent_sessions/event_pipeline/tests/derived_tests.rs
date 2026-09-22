use crate::agent_sessions::event_pipeline::derived::{
    compute_derived, is_visible_in_chat, is_visible_in_messages, is_visible_in_simulator,
    latest_canvas_preview,
};
use crate::agent_sessions::event_pipeline::types::*;

fn make_event(id: &str, variant: EventDisplayVariant) -> SessionEvent {
    SessionEvent {
        id: id.to_string(),
        chunk_id: Some(id.to_string()),
        session_id: "test-session".to_string(),
        created_at: format!("2026-01-01T00:00:0{}Z", id.len()),
        function_name: "test".to_string(),
        ui_canonical: "test".to_string(),
        action_type: "tool_call".to_string(),
        args: serde_json::json!({}),
        result: serde_json::json!({ "content": "some result" }),
        source: EventSource::Assistant,
        display_text: "test event".to_string(),
        display_status: EventDisplayStatus::Completed,
        display_variant: variant,
        activity_status: ActivityStatus::Agent,
        thread_id: None,
        process_id: None,
        call_id: None,
        file_path: None,
        command: None,
        is_delta: None,
        repo_id: None,
        repo_path: None,
        extracted: None,
        payload_refs: Vec::new(),
        shell_replay: None,
        shell_replay_bookmarks: None,
        last_extract_at: None,
    }
}

fn make_thinking_event(id: &str, thought: &str) -> SessionEvent {
    let mut event = make_event(id, EventDisplayVariant::Thinking);
    event.action_type = "llm_thinking".to_string();
    event.result = serde_json::json!({ "thought": thought });
    event
}

fn make_user_message(id: &str) -> SessionEvent {
    let mut event = make_event(id, EventDisplayVariant::Message);
    event.source = EventSource::User;
    event.action_type = "raw".to_string();
    event
}

// =========================================================================
// is_visible_in_chat
// =========================================================================

#[test]
fn test_chat_shows_thinking_delta_with_content() {
    let mut event = make_thinking_event("t1", "some thought");
    event.is_delta = Some(true);
    assert!(is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_empty_thinking_delta() {
    let mut event = make_thinking_event("t1_empty", "");
    event.is_delta = Some(true);
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_session_events() {
    let event = make_event("s1", EventDisplayVariant::Session);
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_tool_result() {
    let mut event = make_event("tr1", EventDisplayVariant::ToolCall);
    event.action_type = "tool_result".to_string();
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_empty_thinking() {
    let event = make_thinking_event("t2", "");
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_whitespace_only_thinking() {
    let event = make_thinking_event("t3", "   ");
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_shows_thinking_with_content() {
    let event = make_thinking_event("t4", "Let me analyze this...");
    assert!(is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_empty_assistant_message() {
    let mut event = make_event("m1", EventDisplayVariant::Message);
    event.action_type = "assistant".to_string();
    event.display_text = "".to_string();
    event.result = serde_json::json!({});
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_shows_tool_call() {
    let event = make_event("tc1", EventDisplayVariant::ToolCall);
    assert!(is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_task_start() {
    let mut event = make_event("ts1", EventDisplayVariant::ToolCall);
    event.action_type = "task_start".to_string();
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_task_completed() {
    let mut event = make_event("tc2", EventDisplayVariant::ToolCall);
    event.action_type = "task_completed".to_string();
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_task_failed() {
    let mut event = make_event("tf1", EventDisplayVariant::ToolCall);
    event.action_type = "task_failed".to_string();
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_stage_error() {
    let mut event = make_event("se1", EventDisplayVariant::ToolCall);
    event.action_type = "stage_error".to_string();
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_hides_failed_user_message() {
    let mut event = make_user_message("u_failed");
    event.display_status = EventDisplayStatus::Failed;
    assert!(!is_visible_in_chat(&event));
}

#[test]
fn test_chat_shows_failed_user_delivery_for_retry() {
    let mut event = make_user_message("u_delivery_failed");
    event.display_status = EventDisplayStatus::Failed;
    event.result = serde_json::json!({
        "deliveryStatus": "failed",
        "deliveryError": "backend unavailable",
    });
    assert!(is_visible_in_chat(&event));
}

#[test]
fn test_chat_shows_completed_user_message() {
    let event = make_user_message("u_ok");
    assert!(is_visible_in_chat(&event));
}

#[test]
fn test_chat_shows_failed_assistant_message() {
    // Failed assistant/system messages (error cards) must still render.
    let mut event = make_event("err", EventDisplayVariant::Message);
    event.source = EventSource::Assistant;
    event.action_type = "assistant".to_string();
    event.display_status = EventDisplayStatus::Failed;
    event.display_text = "Error: something broke".to_string();
    event.result = serde_json::json!({ "observation": "Error: something broke" });
    assert!(is_visible_in_chat(&event));
}

// =========================================================================
// is_visible_in_simulator
// =========================================================================

#[test]
fn test_simulator_hides_delta() {
    let mut event = make_event("s1", EventDisplayVariant::ToolCall);
    event.is_delta = Some(true);
    assert!(!is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_shows_running_tool_call() {
    // All running tool_calls are visible so apps can render a loading state
    // the moment the tool starts (mirrors the chat shimmer behaviour).
    let mut event = make_event("s2", EventDisplayVariant::ToolCall);
    event.display_status = EventDisplayStatus::Running;
    assert!(is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_hides_running_message() {
    // Running non-tool_call events (e.g. still-streaming assistant messages)
    // have no loading state in the apps and stay hidden until complete.
    let mut event = make_event("s2m", EventDisplayVariant::Message);
    event.action_type = "assistant".to_string();
    event.display_status = EventDisplayStatus::Running;
    assert!(!is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_hides_standalone_tool_result() {
    // Orphan tool_result events that escaped the merger must not show as
    // duplicate entries next to their parent tool_call.
    let mut event = make_event("s2r", EventDisplayVariant::ToolCall);
    event.action_type = "tool_result".to_string();
    assert!(!is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_hides_exited_background_shell_message() {
    // A message-variant event whose shellProcessStatus is terminal is not a
    // live runtime resource — but it's also not running, so it shows.
    let mut event = make_event("s2bg", EventDisplayVariant::Message);
    event.action_type = "assistant".to_string();
    event.args = serde_json::json!({ "shellProcessStatus": "exited" });
    assert!(is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_hides_background_shell_non_tool_call() {
    // shellProcessStatus=background marks the event as a live runtime
    // resource even when display_status is completed; non-tool_call variants
    // with live resources stay hidden.
    let mut event = make_event("s2bg2", EventDisplayVariant::Message);
    event.action_type = "assistant".to_string();
    event.args = serde_json::json!({ "shellProcessStatus": "background" });
    assert!(!is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_shows_background_shell_tool_call() {
    let mut event = make_event("s2bg3", EventDisplayVariant::ToolCall);
    event.display_status = EventDisplayStatus::Running;
    event.args = serde_json::json!({ "shellProcessStatus": "background" });
    assert!(is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_shows_running_spawning_tool_call() {
    let mut event = make_event("s3", EventDisplayVariant::ToolCall);
    event.display_status = EventDisplayStatus::Running;
    event.function_name = "agent".to_string();
    assert!(is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_shows_running_task_tool_call() {
    let mut event = make_event("s4", EventDisplayVariant::ToolCall);
    event.display_status = EventDisplayStatus::Running;
    event.function_name = "task".to_string();
    assert!(is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_shows_user_messages_with_message_variant() {
    let event = make_user_message("u1");
    assert!(is_visible_in_simulator(&event));
}

#[test]
fn test_simulator_shows_completed_tool_call() {
    let event = make_event("tc1", EventDisplayVariant::ToolCall);
    assert!(is_visible_in_simulator(&event));
}

// =========================================================================
// is_visible_in_messages
// =========================================================================

#[test]
fn test_messages_includes_user_messages() {
    let event = make_user_message("u2");
    assert!(is_visible_in_messages(&event));
}

#[test]
fn test_messages_hides_delta() {
    let mut event = make_event("m1", EventDisplayVariant::Message);
    event.is_delta = Some(true);
    assert!(!is_visible_in_messages(&event));
}

// =========================================================================
// Visibility parity fixture (shared with TS visibilityParity.test.ts)
// =========================================================================

/// Shared fixture: each case carries a full serde-serialized SessionEvent and
/// the expected `is_visible_in_chat` verdict. The TS twin
/// (`src/engines/SessionCore/ingestion/__tests__/visibilityParity.test.ts`)
/// loads the same file and asserts `isVisibleInChat` parity.
#[test]
fn test_visibility_parity_fixture() {
    #[derive(serde::Deserialize)]
    struct ParityCase {
        name: String,
        event: SessionEvent,
        #[serde(rename = "expectedChat")]
        expected_chat: bool,
    }

    let raw = include_str!("../fixtures/visibility_parity.json");
    let cases: Vec<ParityCase> =
        serde_json::from_str(raw).expect("visibility_parity.json must parse as Vec<ParityCase>");
    assert!(!cases.is_empty(), "fixture must contain cases");

    for case in &cases {
        assert_eq!(
            is_visible_in_chat(&case.event),
            case.expected_chat,
            "parity mismatch for case: {}",
            case.name
        );
    }
}

// =========================================================================
// compute_derived
// =========================================================================

#[test]
fn test_compute_derived_empty() {
    let snapshot = compute_derived(&[], 1);
    assert_eq!(snapshot.version, 1);
    assert_eq!(snapshot.event_count, 0);
    assert!(snapshot.chat_events.is_empty());
    assert!(snapshot.sorted_simulator_events.is_empty());
    assert!(snapshot.last_event.is_none());
}

#[test]
fn test_compute_derived_mixed_events() {
    let events = vec![
        make_event("tc1", EventDisplayVariant::ToolCall),
        make_thinking_event("th1", "analyzing..."),
        make_user_message("u1"),
        make_event("s1", EventDisplayVariant::Session),
    ];

    let snapshot = compute_derived(&events, 5);
    assert_eq!(snapshot.version, 5);
    assert_eq!(snapshot.event_count, 4);

    // Chat: tool_call + thinking (session hidden, user message shown)
    assert_eq!(snapshot.chat_events.len(), 3);

    // Simulator (sorted): tool_call + thinking + user (session hidden)
    assert_eq!(snapshot.sorted_simulator_events.len(), 3);

    // Messages: tool_call + thinking + user (session hidden)
    assert_eq!(snapshot.messages_events.len(), 3);

    assert_eq!(snapshot.last_event.as_ref().unwrap().id, "s1");
    assert_eq!(snapshot.event_index.len(), 4);
    assert_eq!(snapshot.event_index["tc1"], 0);
    assert_eq!(snapshot.event_index["u1"], 2);
}

#[test]
fn test_compute_derived_chat_events_sorted() {
    let mut event_late = make_event("a", EventDisplayVariant::ToolCall);
    event_late.created_at = "2026-01-01T00:00:02Z".to_string();
    let mut event_early = make_event("b", EventDisplayVariant::ToolCall);
    event_early.created_at = "2026-01-01T00:00:01Z".to_string();

    let events = vec![event_late, event_early];
    let snapshot = compute_derived(&events, 1);

    assert_eq!(snapshot.chat_events[0].id, "b");
    assert_eq!(snapshot.chat_events[1].id, "a");
}

#[test]
fn test_compute_derived_keeps_assistant_answer_and_opencode_subagent_block() {
    let mut answer = make_event("assistant-answer", EventDisplayVariant::Message);
    answer.function_name = "assistant_message".to_string();
    answer.ui_canonical = "assistant_message".to_string();
    answer.action_type = "assistant".to_string();
    answer.source = EventSource::Assistant;
    answer.display_text = "Here is the answer before the subagent result.".to_string();
    answer.created_at = "2026-01-01T00:00:01Z".to_string();

    let mut subagent = make_event("opencode-subagent", EventDisplayVariant::ToolCall);
    subagent.function_name = "subagent".to_string();
    subagent.ui_canonical = "subagent".to_string();
    subagent.action_type = "tool_call".to_string();
    subagent.args = serde_json::json!({
        "action": "delegate",
        "description": "Inspect OpenCode fields",
        "prompt": "Inspect OpenCode fields",
        "subagent_type": "opencode",
        "subagentSessionId": "opencodeapp-child-1"
    });
    subagent.created_at = "2026-01-01T00:00:02Z".to_string();

    let snapshot = compute_derived(&[answer, subagent], 1);
    let ids = snapshot
        .chat_events
        .iter()
        .map(|event| event.id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(ids, vec!["assistant-answer", "opencode-subagent"]);
}

#[test]
fn test_compute_derived_orders_turn_summary_after_same_timestamp_thought() {
    let mut user = make_user_message("user-1");
    user.created_at = "2026-01-01T00:00:00.000Z".to_string();

    let mut summary = make_event("summary-turn-1", EventDisplayVariant::Summary);
    summary.function_name = "turn_summary".to_string();
    summary.ui_canonical = "turn_summary".to_string();
    summary.action_type = "assistant".to_string();
    summary.created_at = "2026-01-01T00:00:02.000Z".to_string();

    let mut thought = make_thinking_event("thought-1", "I checked the files.");
    thought.created_at = "2026-01-01T00:00:02.000Z".to_string();

    let events = vec![user, summary, thought];
    let snapshot = compute_derived(&events, 1);
    let ids = snapshot
        .chat_events
        .iter()
        .map(|event| event.id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(ids, vec!["user-1", "thought-1", "summary-turn-1"]);
}

#[test]
fn test_compute_derived_anchors_late_turn_summary_before_next_user_turn() {
    let mut first_user = make_user_message("user-1");
    first_user.created_at = "2026-01-01T00:00:00.000Z".to_string();

    let mut first_reply = make_event("assistant-1", EventDisplayVariant::Message);
    first_reply.action_type = "assistant".to_string();
    first_reply.created_at = "2026-01-01T00:00:02.000Z".to_string();

    let mut second_user = make_user_message("user-2");
    second_user.created_at = "2026-01-01T00:00:04.000Z".to_string();

    let mut late_summary = make_event("summary-turn-1", EventDisplayVariant::Summary);
    late_summary.function_name = "turn_summary".to_string();
    late_summary.ui_canonical = "turn_summary".to_string();
    late_summary.action_type = "assistant".to_string();
    late_summary.created_at = "2026-01-01T00:00:03.000Z".to_string();

    let events = vec![first_user, first_reply, second_user, late_summary];
    let snapshot = compute_derived(&events, 1);
    let ids = snapshot
        .chat_events
        .iter()
        .map(|event| event.id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        ids,
        vec!["user-1", "assistant-1", "summary-turn-1", "user-2"]
    );
}

// =========================================================================
// latest_canvas_preview
// =========================================================================

#[test]
fn test_latest_canvas_preview_tracks_revise_events() {
    let mut render = make_event("tool-call-render-1", EventDisplayVariant::ToolCall);
    render.function_name = core_types::tool_names::RENDER_INLINE_CANVAS.to_string();
    render.args = serde_json::json!({ "mode": "react", "title": "Sketch" });
    render.created_at = "2026-01-01T00:00:01Z".to_string();

    let mut revise = make_event("tool-call-revise-1", EventDisplayVariant::ToolCall);
    revise.function_name = core_types::tool_names::REVISE_INLINE_CANVAS.to_string();
    revise.args = serde_json::json!({
        "mode": "react",
        "title": "Sketch v2",
        "target_event_id": "tool-call-render-1"
    });
    revise.created_at = "2026-01-01T00:00:02Z".to_string();

    let preview = latest_canvas_preview(&[render, revise]).expect("canvas preview");
    assert_eq!(preview.event_id, "tool-call-revise-1");
    assert_eq!(preview.mode, "react");
    assert_eq!(preview.title.as_deref(), Some("Sketch v2"));
}

#[test]
fn test_latest_canvas_preview_ignores_non_canvas_events() {
    let event = make_event("tc1", EventDisplayVariant::ToolCall);
    assert!(latest_canvas_preview(&[event]).is_none());
}

// =========================================================================
// chat ordering: created_at ties
// =========================================================================

#[test]
fn test_unloaded_placeholder_sorts_before_same_instant_next_header() {
    // An unloaded-turn placeholder spans up to the NEXT round's start, so its
    // created_at ties with that round's user header. It must stay BEFORE the
    // header (tail of the previous group) or the previous round loses its
    // expand affordance and the next group inherits a foreign placeholder.
    let mut placeholder = make_event(
        "codex-unloaded-turn-codex-user-1",
        EventDisplayVariant::Message,
    );
    placeholder.action_type = "assistant".to_string();
    placeholder.function_name = "assistant".to_string();
    placeholder.created_at = "2026-07-31T00:07:15.017+00:00".to_string();
    let mut next_header = make_user_message("codex-user-2");
    next_header.function_name = "user".to_string();
    next_header.created_at = "2026-07-31T00:07:15.017+00:00".to_string();

    let derived = compute_derived(&[next_header, placeholder], 1);
    let chat_ids: Vec<&str> = derived
        .chat_events
        .iter()
        .map(|event| event.id.as_str())
        .collect();
    assert_eq!(
        chat_ids,
        vec!["codex-unloaded-turn-codex-user-1", "codex-user-2"]
    );
}

#[test]
fn retry_lineage_hides_only_proven_prompt_echoes_across_native_restart_shapes() {
    let mut marker = make_event("queued-retry-lineage:queue:", EventDisplayVariant::Session);
    marker.action_type = "queued_retry_lineage".into();
    marker.source = EventSource::System;
    marker.result = serde_json::json!({"retryLineage": {"version":1,"queueMessageId":"queue","superseded":[{
        "turnIntentId":"failed", "sessionId":"runner", "sourceEventIds":["orgii_evt_original"]
    }]}});
    let mut root = make_event("root-user", EventDisplayVariant::Message);
    root.source = EventSource::User;
    root.result = serde_json::json!({"turnIntentId":"failed"});
    let mut imported = root.clone();
    imported.id = "native-copy".into();
    imported.session_id = "new-child".into();
    imported.result = serde_json::json!({});
    imported.args = serde_json::json!({"__orgiiSourceEventId":"orgii_evt_original"});
    let mut independent = root.clone();
    independent.id = "independent".into();
    independent.session_id = "other-root".into();
    let mut fallback = root.clone();
    fallback.id = "fallback".into();
    fallback.result = serde_json::json!({"turnIntentId":""});
    fallback.args = serde_json::json!({"conversationTurnId":"failed"});
    let snapshot = compute_derived(&[marker, root, imported, independent, fallback], 1);
    assert_eq!(
        snapshot
            .chat_events
            .iter()
            .filter(|event| event.source == EventSource::User)
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>(),
        vec!["independent"]
    );
}

#[test]
fn native_retry_reload_event_store_keeps_three_logical_turns_and_error_audit() {
    use crate::agent_sessions::event_pipeline::store::EventStore;
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../crates/orgtrack-core/src/sources/fixtures/codex_native_failed_user.json"
    ))
    .unwrap();
    let native_user = &fixture["normalizedUser"];
    let mut events = Vec::new();
    for (index, intent) in ["A", "B", "failed-C", "retry-C"].iter().enumerate() {
        let mut event = make_user_message(&format!("native-{intent}"));
        event.function_name = native_user["functionName"].as_str().unwrap().into();
        event.ui_canonical = native_user["uiCanonical"].as_str().unwrap().into();
        event.result = native_user["result"].clone();
        event.result["turnIntentId"] = serde_json::json!(intent);
        event.created_at = format!("2026-09-18T16:00:0{index}Z");
        events.push(event);
    }
    let mut error = make_event("original-error", EventDisplayVariant::Error);
    error.action_type = "error".into();
    error.function_name = "error".into();
    error.display_status = EventDisplayStatus::Failed;
    error.result = serde_json::json!({"success": false, "error": "upstream unavailable"});
    events.push(error);
    let mut store = EventStore::new();
    store.set(events.clone());
    assert_eq!(
        compute_derived(store.events(), store.version())
            .chat_events
            .iter()
            .filter(|event| event.source == EventSource::User)
            .count(),
        4,
        "a native replacement without its sidecar reproduces the stale fourth turn"
    );
    let mut lineage = make_event("queued-retry-lineage:owner:", EventDisplayVariant::Session);
    lineage.action_type = "queued_retry_lineage".into();
    lineage.source = EventSource::System;
    lineage.result = serde_json::json!({"retryLineage": {
        "version": 1, "queueMessageId": "owner", "superseded": [{
            "sessionId": "test-session", "turnIntentId": "failed-C", "sourceEventIds": []
        }]
    }});
    events.push(lineage);
    for _ in 0..2 {
        // es_set uses this same real store replacement and derived consumer.
        store.set(events.clone());
        let snapshot = compute_derived(store.events(), store.version());
        assert_eq!(
            snapshot
                .chat_events
                .iter()
                .filter(|event| event.source == EventSource::User)
                .map(|event| event.result["turnIntentId"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["A", "B", "retry-C"]
        );
        assert!(snapshot
            .chat_events
            .iter()
            .any(|event| event.id == "original-error"));
        assert_eq!(
            store
                .events()
                .iter()
                .filter(|event| event.source == EventSource::User)
                .count(),
            4
        );
    }
}

#[test]
fn retry_audit_boundary_preserves_lazy_prior_turn_and_raw_attempt() {
    use crate::agent_sessions::event_pipeline::store::EventStore;
    let events: Vec<SessionEvent> =
        serde_json::from_str(include_str!("../fixtures/retry_audit_boundary.json")).unwrap();
    let mut store = EventStore::new();
    store.set(events);
    let snapshot = compute_derived(store.events(), store.version());
    let ids = snapshot
        .chat_events
        .iter()
        .map(|event| event.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        ids,
        vec![
            "A",
            "lazy-A",
            "old-B",
            "old-B-error",
            "new-B",
            "new-B-answer"
        ]
    );
    let boundary = snapshot
        .events
        .iter()
        .find(|event| event.id == "old-B")
        .unwrap();
    assert_eq!(boundary.source, EventSource::System);
    assert_eq!(boundary.action_type, "queued_retry_audit_boundary");
    assert_eq!(
        boundary.result["retryAuditBoundary"]["sourceEventId"],
        "old-B"
    );
    assert!(core_types::session_event::is_internal_lifecycle_action_type(&boundary.action_type));
    assert!(boundary.display_text.is_empty());
    assert_eq!(
        snapshot
            .chat_events
            .iter()
            .filter(|event| event.source == EventSource::User)
            .count(),
        2
    );
    assert_eq!(store.get_by_id("old-B").unwrap().source, EventSource::User);
    assert_eq!(
        store.get_by_id("old-B").unwrap().display_text,
        "Return marker."
    );
    for event in snapshot
        .messages_events
        .iter()
        .chain(snapshot.sorted_simulator_events.iter())
    {
        assert_ne!(
            event.id, "old-B",
            "structural audit boundary is not a message or simulator action"
        );
    }
}
