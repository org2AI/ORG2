//! SQLite persistence for tool calls/results, child status updates, and
//! cache hydration of the child session's in-memory event store.

use super::UnifiedSubagentHandler;
use crate::bus::event_pipeline_bridge;
use tracing::warn;

impl UnifiedSubagentHandler {
    /// Commit the launch input before the executor can emit any output. Runtime
    /// callbacks own subsequent assistant/tool rows; never append a full replay
    /// transcript after completion (that duplicates output and puts input last).
    pub(crate) fn persist_launch_input(
        &self,
        messages: &[serde_json::Value],
        is_resume: bool,
    ) -> Result<(), String> {
        let (input, context) = messages.split_last().ok_or("Missing worker input")?;
        if input["role"].as_str() != Some("user") {
            return Err("Worker launch must end with a user input".to_string());
        }
        let content = input["content"]
            .as_str()
            .ok_or("Worker input must be text")?;
        let sid = &self.config.subagent_session_id;
        if !is_resume {
            // Fork context is provider history, not another live child turn.
            let inherited: Vec<_> = context
                .iter()
                .filter(|message| message["role"].as_str() != Some("system"))
                .cloned()
                .collect();
            crate::session::persistence::seed_session_with_messages(sid, &inherited)
                .map_err(|error| error.to_string())?;
        }
        let message_id = crate::session::persistence::save_user_msg(sid, content, None)
            .map_err(|error| error.to_string())?;
        if let Some(handle) = self.app_handle.as_ref() {
            event_pipeline_bridge::persist_user_message_event(
                handle,
                sid,
                &message_id,
                content,
                None,
                None,
                event_pipeline_bridge::PersistedUserMessageSource::User,
                // Worker launches do not own a session TurnIntent record.
                "",
            )?;
        }
        Ok(())
    }

    /// Persist a tool call to the database.
    pub(super) fn persist_tool_call(&self, tool_call_id: &str, tool_name: &str, args: &str) {
        if let Err(err) = crate::session::persistence::save_tool_call_msg(
            &self.config.subagent_session_id,
            tool_call_id,
            tool_name,
            args,
        ) {
            warn!(
                "[subagent:{}] Failed to persist tool call: {}",
                self.config.subagent_type, err
            );
        }
    }

    /// Persist a tool result to the database.
    pub(super) fn persist_tool_result(&self, tool_call_id: &str, tool_name: &str, result: &str) {
        if let Err(err) = crate::session::persistence::save_tool_result_msg(
            &self.config.subagent_session_id,
            tool_call_id,
            tool_name,
            result,
        ) {
            warn!(
                "[subagent:{}] Failed to persist tool result: {}",
                self.config.subagent_type, err
            );
        }
    }

    /// Update the child session's status in `agent_sessions`.
    pub(super) fn update_child_session_status(&self, status: crate::session::SessionStatus) {
        if let Err(err) =
            crate::session::persistence::update_status(&self.config.subagent_session_id, status)
        {
            warn!(
                "[subagent:{}] Failed to update child session status to '{}': {}",
                self.config.subagent_type,
                status.as_str(),
                err
            );
        }
    }

    /// Persist the child session's in-memory events to SQLite so they survive
    /// LRU eviction and can be loaded when the user expands the SubagentBlock.
    pub(super) fn persist_child_session_to_cache(&self) {
        let Some(ref handle) = self.app_handle else {
            return;
        };
        let events =
            event_pipeline_bridge::read_session_events(handle, &self.config.subagent_session_id);

        if events.is_empty() {
            return;
        }

        let sid = self.config.subagent_session_id.clone();
        let persistable: Vec<_> = events
            .into_iter()
            .filter(|e| {
                !e.id.starts_with("stream-msg-ts-") && !e.id.starts_with("stream-think-ts-")
            })
            .collect();

        let count = persistable.len();
        if let Err(err) =
            event_pipeline_bridge::persist_events("subagent-child-persist", &sid, &persistable, 5)
        {
            warn!(
                "[subagent:{}] Failed to persist {} child events for session {}: {}",
                self.config.subagent_type, count, sid, err
            );
            return;
        }
        tracing::info!(
            "[subagent:{}] Persisted {} child events for session {}",
            self.config.subagent_type,
            count,
            sid
        );
    }
}
