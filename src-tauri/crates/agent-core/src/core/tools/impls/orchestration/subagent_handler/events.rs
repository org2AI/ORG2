//! Pure(ish) `SessionEvent` builders for tool calls, tool results, and
//! streaming text/thinking placeholders, plus the buffer flush that
//! swaps placeholders for the authoritative segment.

use super::UnifiedSubagentHandler;
use crate::bus::event_pipeline_bridge;
use core_types::session_event::{
    ActivityStatus, EventDisplayStatus, EventDisplayVariant, EventSource, SessionEvent,
};
use serde_json::Value;

impl UnifiedSubagentHandler {
    /// Build a `SessionEvent` for a tool_call.
    pub(super) fn build_tool_call_event(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        args: &Value,
    ) -> SessionEvent {
        let now = chrono::Utc::now().to_rfc3339();
        let mut event = SessionEvent {
            id: format!("tc-{}", tool_call_id),
            chunk_id: None,
            session_id: self.config.subagent_session_id.clone(),
            created_at: now,
            function_name: tool_name.to_string(),
            ui_canonical: core_types::cli_alias::get_ui_canonical(tool_name).to_string(),
            action_type: "tool_call".to_string(),
            args: args.clone(),
            result: Value::Null,
            source: EventSource::Assistant,
            display_text: display_name.to_string(),
            display_status: EventDisplayStatus::Running,
            display_variant: EventDisplayVariant::ToolCall,
            activity_status: ActivityStatus::Agent,
            thread_id: None,
            process_id: None,
            call_id: Some(tool_call_id.to_string()),
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
        };
        event.recompute_extracted();
        event
    }

    /// Build a TS-placeholder streaming event so the child UI can render
    /// in-progress text/thinking before the authoritative segment lands.
    /// Uses the same `stream-msg-ts-{sid}` / `stream-think-ts-{sid}` ids
    /// that the parent uses, so the existing replace-and-remove logic in
    /// `EventStore::merge_events` swaps it out at flush time.
    pub(super) fn build_streaming_placeholder_event(
        &self,
        is_thinking: bool,
        accumulated: &str,
    ) -> SessionEvent {
        let sid = &self.config.subagent_session_id;
        let now = chrono::Utc::now().to_rfc3339();
        if is_thinking {
            let mut event = SessionEvent {
                id: format!("stream-think-ts-{}", sid),
                chunk_id: None,
                session_id: sid.clone(),
                created_at: now,
                function_name: "thinking".to_string(),
                ui_canonical: "thinking".to_string(),
                action_type: "llm_thinking".to_string(),
                args: serde_json::json!({}),
                result: serde_json::json!({
                    "thought": accumulated,
                    "content": accumulated,
                    "observation": accumulated,
                    "is_delta": true,
                }),
                source: EventSource::Assistant,
                display_text: accumulated.to_string(),
                display_status: EventDisplayStatus::Running,
                display_variant: EventDisplayVariant::Thinking,
                activity_status: ActivityStatus::Agent,
                thread_id: None,
                process_id: None,
                call_id: None,
                file_path: None,
                command: None,
                is_delta: Some(true),
                repo_id: None,
                repo_path: None,
                extracted: None,
                payload_refs: Vec::new(),
                shell_replay: None,
                shell_replay_bookmarks: None,
                last_extract_at: None,
            };
            event.recompute_extracted();
            event
        } else {
            let mut event = SessionEvent {
                id: format!("stream-msg-ts-{}", sid),
                chunk_id: None,
                session_id: sid.clone(),
                created_at: now,
                function_name: "assistant".to_string(),
                ui_canonical: "agent_message".to_string(),
                action_type: "assistant".to_string(),
                args: serde_json::json!({}),
                result: serde_json::json!({
                    "content": accumulated,
                    "observation": accumulated,
                    "role": "assistant",
                    "is_delta": true,
                }),
                source: EventSource::Assistant,
                display_text: accumulated.to_string(),
                display_status: EventDisplayStatus::Running,
                display_variant: EventDisplayVariant::Message,
                activity_status: ActivityStatus::Agent,
                thread_id: None,
                process_id: None,
                call_id: None,
                file_path: None,
                command: None,
                is_delta: Some(true),
                repo_id: None,
                repo_path: None,
                extracted: None,
                payload_refs: Vec::new(),
                shell_replay: None,
                shell_replay_bookmarks: None,
                last_extract_at: None,
            };
            event.recompute_extracted();
            event
        }
    }

    /// Flush any buffered message/thinking streams for the child session and
    /// push the authoritative segments into the child EventStore. The TS
    /// placeholder event (`stream-msg-ts-{sid}` / `stream-think-ts-{sid}`)
    /// is removed atomically so the final segment doesn't appear alongside
    /// its own live preview.
    pub(super) fn flush_streaming(&self) {
        let sid = &self.config.subagent_session_id;
        if let Some(event) = self.streaming_buffer.complete_message(sid) {
            self.publish_completed_segment("subagent-flush-msg", "stream-msg-ts", event);
        }
        if let Some(event) = self.streaming_buffer.complete_thinking(sid) {
            self.publish_completed_segment("subagent-flush-think", "stream-think-ts", event);
        }
    }

    fn publish_completed_segment(
        &self,
        label: &'static str,
        placeholder_prefix: &str,
        event: SessionEvent,
    ) {
        #[cfg(test)]
        self.completed_events.lock().unwrap().push(event.clone());
        let Some(handle) = self.app_handle.as_ref() else {
            return;
        };
        let sid = &self.config.subagent_session_id;
        let placeholder_id = format!("{placeholder_prefix}-{sid}");
        let event_for_persist = event.clone();
        event_pipeline_bridge::replace_streaming_event(handle, sid, &placeholder_id, event);
        event_pipeline_bridge::persist_events_async(label, sid.clone(), vec![event_for_persist], 3);
    }

    /// Build a `SessionEvent` for a tool_result (merged into tool_call via call_id).
    ///
    /// When the tool provided structured `ui_metadata` (dual-track response
    /// pattern), it is embedded into the result object under `uiMetadata` so
    /// extractors can consume exact structured data instead of re-parsing
    /// the LLM-facing text.
    pub(super) fn build_tool_result_event(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        display_name: &str,
        result: &str,
        ui_metadata: Option<&crate::tools::traits::ToolUIMetadata>,
    ) -> SessionEvent {
        let now = chrono::Utc::now().to_rfc3339();
        let result_value = match ui_metadata.and_then(|meta| serde_json::to_value(meta).ok()) {
            Some(meta_value) => serde_json::json!({
                "content": result,
                "uiMetadata": meta_value,
            }),
            None => Value::String(result.to_string()),
        };
        SessionEvent {
            id: format!("tr-{}", tool_call_id),
            chunk_id: None,
            session_id: self.config.subagent_session_id.clone(),
            created_at: now,
            function_name: tool_name.to_string(),
            ui_canonical: core_types::cli_alias::get_ui_canonical(tool_name).to_string(),
            action_type: "tool_result".to_string(),
            args: Value::Object(serde_json::Map::new()),
            result: result_value,
            source: EventSource::Assistant,
            display_text: display_name.to_string(),
            display_status: EventDisplayStatus::Completed,
            display_variant: EventDisplayVariant::ToolCall,
            activity_status: ActivityStatus::Processed,
            thread_id: None,
            process_id: None,
            call_id: Some(tool_call_id.to_string()),
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
}
