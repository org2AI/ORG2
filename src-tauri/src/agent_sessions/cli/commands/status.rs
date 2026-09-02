//! Read-only status/history queries plus cancellation — `cli_agent_status`,
//! `cli_agent_history_mutation`, `cli_agent_cancel`.

use super::super::persistence::{self, CliHistoryMutation, CodeSession};
use super::super::session_runner;
use super::super::types::SessionStatus;
use agent_core::state::control_flow::CancelReason;
use serde::Serialize;
use std::collections::HashSet;

const MAX_CLI_STATUS_BATCH_SESSIONS: usize = 256;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAgentStatusBatchItem {
    pub session_id: String,
    pub status: super::super::types::SessionStatus,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_intent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAgentStatusItem {
    #[serde(flatten)]
    pub session: CodeSession,
    /// True only for a failed provider turn whose durable error is classified
    /// by the shared runtime classifier as context exhaustion. The frontend
    /// must not infer this recovery signal from provider prose independently.
    pub context_exhausted: bool,
}

fn status_item(session: CodeSession) -> CliAgentStatusItem {
    let context_exhausted = context_exhausted(session.status, session.error_message.as_deref());
    CliAgentStatusItem {
        session,
        context_exhausted,
    }
}

fn context_exhausted(status: SessionStatus, error_message: Option<&str>) -> bool {
    matches!(status, SessionStatus::Failed)
        && error_message.is_some_and(app_utils::runtime_errors::is_context_exhausted_message)
}


/// Get session status.
#[tauri::command]
pub async fn cli_agent_status(session_id: String) -> Result<Option<CliAgentStatusItem>, String> {
    tokio::task::spawn_blocking(move || {
        persistence::get_session(&session_id)
            .map(|session| session.map(status_item))
            .map_err(|e| format!("DB error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Minimal reconnect/focus recovery snapshot. Healthy sessions use pushed
/// lifecycle events; this bounded batch is only the repair path.
#[tauri::command]
pub async fn cli_agent_status_batch(
    session_ids: Vec<String>,
) -> Result<Vec<CliAgentStatusBatchItem>, String> {
    tokio::task::spawn_blocking(move || {
        let mut seen = HashSet::new();
        let session_ids: Vec<String> = session_ids
            .into_iter()
            .filter(|session_id| !session_id.is_empty() && seen.insert(session_id.clone()))
            .take(MAX_CLI_STATUS_BATCH_SESSIONS)
            .collect();
        let intents = session_persistence::turn_intents::latest_for_sessions(&session_ids)
            .map_err(|err| format!("DB error loading turn intents: {err}"))?;
        let rows = persistence::status_snapshots(&session_ids)
            .map_err(|err| format!("DB error: {err}"))?;
        Ok(rows
            .into_iter()
            .map(|session| CliAgentStatusBatchItem {
                turn_intent_id: intents
                    .get(&session.session_id)
                    .map(|intent| intent.turn_intent_id.clone()),
                session_id: session.session_id,
                status: session.status,
                updated_at: session.updated_at,
            })
            .collect())
    })
    .await
    .map_err(|err| format!("Task error: {err}"))?
}

/// Get the last ORGII-side history mutation that invalidated native CLI resume state.
#[tauri::command]
pub async fn cli_agent_history_mutation(
    session_id: String,
) -> Result<Option<CliHistoryMutation>, String> {
    tokio::task::spawn_blocking(move || {
        persistence::get_history_mutation(&session_id).map_err(|e| format!("DB error: {}", e))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
}

/// Cancel a running session.
#[tauri::command]
pub async fn cli_agent_cancel(
    session_id: String,
    reason: Option<CancelReason>,
) -> Result<bool, String> {
    session_runner::cancel_session(&session_id, reason.unwrap_or_default()).await
}

#[cfg(test)]
mod tests {
    use super::context_exhausted;
    use crate::agent_sessions::cli::types::SessionStatus;

    #[test]
    fn context_recovery_signal_requires_failed_status_and_shared_classification() {
        let exhausted = Some("Codex ran out of room in the model's context window.");
        assert!(context_exhausted(SessionStatus::Failed, exhausted));
        assert!(!context_exhausted(SessionStatus::Completed, exhausted));
        assert!(!context_exhausted(
            SessionStatus::Failed,
            Some("connection refused")
        ));
    }

}
