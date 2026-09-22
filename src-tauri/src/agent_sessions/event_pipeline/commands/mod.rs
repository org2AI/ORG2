//! Tauri commands for the Rust EventStore
//!
//! Thin wrappers around per-session `EventStore` instances and derived computations.
//! Each command acquires the `Mutex`, resolves the target session (explicit
//! `session_id` argument or the active session), performs the operation, and
//! returns.
//!
//! Notification scheduling (100ms batched `es:changed` events) is handled by
//! a background tokio task spawned at app startup. Each snapshot is tagged with
//! the `sessionId` it describes so the frontend can route to per-session
//! listeners.

mod agent_org_group_visibility;
mod agent_org_plan_history;
mod batch_update;
mod cache_bridge;
pub(crate) mod event_conversion;
mod extractors;
mod history;
mod ingestion;
mod notify;
mod push_events;
mod runtime_artifacts;
mod search;
mod session_manager;
mod snapshot;
mod state;
mod store_commands;
mod turn_window;
mod write_retry;

use crate::agent_sessions::event_pipeline::ingestion::prompt_backfill;
use crate::agent_sessions::event_pipeline::session_providers;
use crate::agent_sessions::event_pipeline::types::SessionEvent;

fn backfill_provider_subagent_prompts(events: &mut [SessionEvent]) {
    prompt_backfill::backfill_subagent_prompts_with_resolver(
        events,
        session_providers::subagent_prompt,
    );
}

pub(crate) fn prepare_loaded_events(
    session_id: &str,
    events: Vec<SessionEvent>,
) -> Vec<SessionEvent> {
    let events = event_conversion::dedup_by_call_id(events);
    let mut events = event_conversion::dedup_stream_transcript_chunk_pairs(events);
    agent_org_plan_history::rehydrate_agent_org_plan_history(session_id, &mut events);
    event_conversion::backfill_tool_inputs_from_messages(session_id, &mut events);
    event_conversion::backfill_subagent_links(session_id, &mut events);
    backfill_provider_subagent_prompts(&mut events);
    // Old terminal `.txt` files have no Snapshot watermarks. Import the body
    // once into the append-only replay artifact and attach only the mutable
    // final shell state; the migration deliberately never seeds historical
    // event bookmarks, so an early playback cursor cannot see future output.
    agent_core::tools::impls::coding::exec::legacy_replay::hydrate_legacy_shell_replays(
        &mut events,
    );
    // Compaction boundaries live only in `agent_messages` (never in the
    // event cache) — merge them in so the chat shows the compacted marker.
    event_conversion::merge_compact_boundary_events(session_id, &mut events);
    events
}

#[cfg(test)]
mod streaming_snapshot_delta_tests {
    use super::notify::{build_settled_snapshot_delta, build_streaming_snapshot_delta};
    use super::*;
    use crate::agent_sessions::event_pipeline::store::EventStore;

    fn test_event(id: &str, created_at: &str) -> SessionEvent {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "chunk_id": null,
            "sessionId": "streaming-delta-test",
            "createdAt": created_at,
            "functionName": "assistant_message",
            "uiCanonical": "message",
            "actionType": "assistant",
            "args": {},
            "result": { "content": id },
            "source": "assistant",
            "displayText": id,
            "displayStatus": "running",
            "displayVariant": "message",
            "activityStatus": "agent"
        }))
        .expect("valid test event")
    }

    #[test]
    fn streaming_delta_compacts_only_changed_events_and_tracks_positions() {
        let mut store = EventStore::new();
        let baseline = (0..100)
            .map(|index| {
                test_event(
                    &format!("event-{index:03}"),
                    &format!("2026-07-22T00:00:{index:02}.000Z"),
                )
            })
            .collect();
        store.set(baseline);
        store.mark_full_snapshot_emitted();
        store.set_streaming(true);

        store.upsert(test_event("event-050", "2026-07-22T00:00:50.000Z"));
        store.append(vec![test_event("event-100", "2026-07-22T00:01:40.000Z")]);

        let delta = build_streaming_snapshot_delta(&mut store);
        assert!(delta.incremental_orders);
        assert!(delta.streaming);
        assert_eq!(delta.upserts.len(), 2);
        assert_eq!(delta.memberships.len(), 2);
        assert_eq!(delta.memberships[0].id, "event-050");
        assert_eq!(delta.memberships[0].event_index, 50);
        assert_eq!(delta.memberships[1].id, "event-100");
        assert_eq!(delta.memberships[1].event_index, 100);
        assert!(delta.event_ids.is_empty());
        assert!(delta.chat_event_ids.is_empty());
        assert!(delta.sorted_simulator_event_ids.is_empty());

        let no_op = build_streaming_snapshot_delta(&mut store);
        assert_eq!(no_op.base_version, delta.version);
        assert!(no_op.upserts.is_empty());
        assert!(no_op.memberships.is_empty());
    }

    fn retry_user(id: &str, intent: &str) -> SessionEvent {
        let mut event = test_event(id, "2026-09-18T16:00:00Z");
        event.function_name = "user".into();
        event.source = core_types::session_event::EventSource::User;
        event.action_type = "raw".into();
        event.result = serde_json::json!({"turnIntentId": intent});
        event
    }

    fn retry_marker() -> SessionEvent {
        let mut event = test_event("queued-retry-lineage:owner:", "2026-09-18T16:00:01Z");
        event.function_name = "system".into();
        event.source = core_types::session_event::EventSource::System;
        event.action_type = "queued_retry_lineage".into();
        event.result = serde_json::json!({"retryLineage": {
            "version": 1, "queueMessageId": "owner", "superseded": [{
                "sessionId": "streaming-delta-test", "turnIntentId": "failed-C",
                "sourceEventIds": []
            }]
        }});
        event
    }

    #[test]
    fn retry_lineage_snapshot_delta_keeps_full_projection_after_new_send() {
        let mut store = EventStore::new();
        let mut error = test_event("original-error", "2026-09-18T16:00:02Z");
        error.function_name = "error".into();
        error.action_type = "error".into();
        error.display_variant = core_types::session_event::EventDisplayVariant::Error;
        store.set(vec![
            retry_user("A", "A"),
            retry_user("B", "B"),
            retry_user("old-C", "failed-C"),
            error,
            retry_user("new-C", "retry-C"),
            retry_marker(),
        ]);
        let full = super::super::derived::compute_derived(store.events(), store.version());
        assert!(
            full.chat_events
                .iter()
                .any(|event| event.id == "old-C"
                    && event.action_type == "queued_retry_audit_boundary")
        );
        store.mark_full_snapshot_emitted();
        store.append(vec![retry_user("D", "D")]);
        let delta = build_settled_snapshot_delta(&mut store);
        assert_eq!(
            delta.chat_event_ids,
            vec!["A", "B", "old-C", "original-error", "new-C", "D"]
        );
        assert!(
            store.get_by_id("old-C").is_some(),
            "raw failed prompt stays auditable"
        );
    }

    #[test]
    fn retry_lineage_streaming_delta_preserves_failed_attempt_audit_boundary() {
        let mut store = EventStore::new();
        store.set(vec![
            retry_user("old-C", "failed-C"),
            retry_user("new-C", "retry-C"),
            retry_marker(),
        ]);
        store.mark_full_snapshot_emitted();
        store.set_streaming(true);
        store.upsert(retry_user("old-C", "failed-C"));
        store.upsert(retry_user("new-C", "retry-C"));
        let streaming = build_streaming_snapshot_delta(&mut store);
        assert!(
            streaming
                .memberships
                .iter()
                .find(|entry| entry.id == "old-C")
                .unwrap()
                .chat
        );
        assert!(
            streaming
                .memberships
                .iter()
                .find(|entry| entry.id == "new-C")
                .unwrap()
                .chat
        );
        let boundary = streaming
            .upserts
            .iter()
            .find(|event| event.id == "old-C")
            .unwrap();
        assert_eq!(
            boundary.source,
            core_types::session_event::EventSource::System
        );
        assert_eq!(boundary.action_type, "queued_retry_audit_boundary");
        assert_eq!(
            store.get_by_id("old-C").unwrap().source,
            core_types::session_event::EventSource::User
        );
        assert_eq!(
            streaming.upserts.len(),
            2,
            "streaming retains journal-only payloads"
        );
    }

    #[test]
    fn retry_lineage_change_refreshes_unchanged_prompt_membership() {
        let mut store = EventStore::new();
        store.set(vec![
            retry_user("old-C", "failed-C"),
            retry_user("new-C", "retry-C"),
        ]);
        store.mark_full_snapshot_emitted();
        store.set_streaming(true);
        store.merge_events(vec![retry_marker()]);
        assert!(
            store.should_emit_full_snapshot(),
            "lineage changes an unchanged old prompt's membership"
        );
        let full = super::super::derived::compute_derived(store.events(), store.version());
        assert!(
            full.chat_events
                .iter()
                .any(|event| event.id == "old-C"
                    && event.action_type == "queued_retry_audit_boundary")
        );
        store.mark_full_snapshot_emitted();
        store.append(vec![test_event("token-chunk", "2026-09-18T16:00:03Z")]);
        assert!(
            !store.should_emit_full_snapshot(),
            "ordinary token chunks stay incremental"
        );
        let delta = build_streaming_snapshot_delta(&mut store);
        assert_eq!(delta.upserts.len(), 1);
        assert_eq!(delta.memberships.len(), 1);

        // Replacing or removing the verdict also changes an unchanged prompt.
        let mut cleared = retry_marker();
        cleared.result["retryLineage"]["superseded"] = serde_json::json!([]);
        store.upsert(cleared);
        assert!(store.should_emit_full_snapshot());
        assert!(
            super::super::derived::compute_derived(store.events(), store.version())
                .chat_events
                .iter()
                .any(|event| event.id == "old-C")
        );
        store.mark_full_snapshot_emitted();
        store.remove_by_id_prefix("queued-retry-lineage:");
        assert!(store.should_emit_full_snapshot());
    }

    #[test]
    fn round_window_reorder_requires_a_new_full_baseline() {
        let mut store = EventStore::new();
        store.set(vec![test_event("event-newer", "2026-07-22T00:01:00.000Z")]);
        store.mark_full_snapshot_emitted();
        store.set_streaming(true);

        store
            .merge_round_window_events(vec![test_event("event-older", "2026-07-22T00:00:00.000Z")]);

        assert!(store.should_emit_full_snapshot());
    }
}

#[cfg(test)]
mod runtime_artifact_tests {
    use super::push_events::collect_post_merge_persistable_events;
    use super::*;
    use core_types::extracted::ExtractedEditData;
    use orgtrack_core::canonical::{AgentMetadata, SOURCE_ORGII_RUST_AGENTS};
    use orgtrack_core::edit_extraction::{artifacts_from_extracted_edit, EditArtifactContext};
    use orgtrack_core::repo_sync::paths::record_id;
    use std::collections::HashSet;

    fn test_event(id: &str, call_id: Option<&str>) -> SessionEvent {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "chunk_id": null,
            "sessionId": "test-session",
            "createdAt": "2026-07-19T00:00:00Z",
            "functionName": "run_shell",
            "uiCanonical": "run_shell",
            "actionType": "tool_call",
            "args": {},
            "result": {},
            "source": "assistant",
            "displayText": id,
            "displayStatus": "running",
            "displayVariant": "tool_call",
            "activityStatus": "agent",
            "callId": call_id
        }))
        .unwrap()
    }

    #[test]
    fn post_merge_persistence_preserves_timeline_order() {
        let events = vec![
            test_event("event-c", Some("call-c")),
            test_event("event-a", Some("call-a")),
            test_event("event-b", Some("call-b")),
        ];
        let incoming_ids = HashSet::from(["event-b".to_string(), "event-c".to_string()]);
        let result_call_ids = HashSet::from(["call-a".to_string()]);

        let selected =
            collect_post_merge_persistable_events(&events, &incoming_ids, &result_call_ids);

        assert_eq!(
            selected
                .into_iter()
                .map(|event| event.id)
                .collect::<Vec<_>>(),
            vec!["event-c", "event-a", "event-b"]
        );
    }

    #[test]
    fn runtime_projection_uses_backfill_record_id_shape() {
        let edit = ExtractedEditData {
            file_path: "src/main.rs".to_string(),
            file_name: "main.rs".to_string(),
            language: "rust".to_string(),
            content: None,
            line_count: None,
            old_content: Some("fn main() {}\n".to_string()),
            new_content: Some("fn main() { println!(\"hi\"); }\n".to_string()),
            diff: None,
            old_start_line: Some(1),
            new_start_line: Some(1),
            lines_added: Some(1),
            lines_removed: Some(1),
            is_deleted: false,
            apply_patch_segments: Vec::new(),
        };
        let context = EditArtifactContext {
            source: SOURCE_ORGII_RUST_AGENTS.to_string(),
            source_session_id: Some("sdeagent-1".to_string()),
            session_id: "sdeagent-1".to_string(),
            source_event_id: Some("tool-call-1".to_string()),
            turn_id: Some("turn-1".to_string()),
            sequence_index: 7,
            timestamp: Some("2026-06-17T00:00:00Z".to_string()),
            workspace_path: Some("/tmp/repo".to_string()),
            metadata: AgentMetadata::default(),
        };

        let artifacts = artifacts_from_extracted_edit(&context, &edit);

        assert_eq!(artifacts.edits.len(), 1);
        assert_eq!(artifacts.chunks.len(), 1);
        assert_eq!(
            artifacts.edits[0].record_id,
            record_id(&[
                "edit",
                SOURCE_ORGII_RUST_AGENTS,
                "sdeagent-1",
                "tool-call-1",
                "7",
                "0",
                "src/main.rs",
            ])
        );
        assert_eq!(
            artifacts.chunks[0].record_id,
            record_id(&[
                "diff_chunk",
                SOURCE_ORGII_RUST_AGENTS,
                "sdeagent-1",
                "tool-call-1",
                "7",
                "0",
                "src/main.rs",
            ])
        );
    }
}

// ============================================================================
// Re-exports
//
// Re-export all Tauri commands from submodules. Using `pub use *` ensures the
// `#[tauri::command]` macro-generated `__cmd__` functions are also exported.
// ============================================================================

// Managed state
pub use state::EventStoreState;

// Notification helpers
pub(crate) use notify::schedule_notify;

// SQLite write-through with retry
pub(crate) use write_retry::save_events_retry;
use write_retry::CRITICAL_WRITE_MAX_RETRIES;
pub(super) use write_retry::{persist_events_with_retry, BULK_WRITE_MAX_RETRIES};

// Runtime orgtrack artifact persistence
use runtime_artifacts::persist_runtime_orgtrack_records_async;
pub(crate) use runtime_artifacts::runtime_artifact_session_record;

// Push-events write path
pub use push_events::{
    push_events_to_session, update_spawning_tool_args_with_persist,
    update_tool_args_by_call_id_with_persist,
};

// Store commands
pub use store_commands::*;

// Session manager commands
pub use session_manager::*;

// Snapshot commands
pub use snapshot::*;

// Cache bridge commands
pub use cache_bridge::*;

// Event conversion helpers (CachedEvent <-> SessionEvent, dedup, backfill, filtering)
pub use event_conversion::*;

// Turn window commands
pub use turn_window::*;

// Analytics commands

// Pagination commands

// Batch update commands
pub use batch_update::*;

// Ingestion commands
pub use ingestion::*;

// Extractor commands
pub use extractors::*;

// Search commands
pub use search::*;

// History commands
pub use history::*;

#[cfg(test)]
pub(crate) use snapshot::{export_markdown_output, export_session_markdown};
