//! Exact recovery of a user request whose Task creation was rejected.
//!
//! The tool receipt proves that this exact Coordinator Turn hit the unresolved
//! work-episode guard. The original user event remains the only content source;
//! no model reply, Task title, or nearby message is used as a fallback.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::state::AgentAppState;
use database::db::get_connection;

use super::context::session_org_read_context;

const NOT_RECOVERABLE: &str = "agent_org_rejected_request_draft_not_recoverable";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOrgRejectedRequestDraft {
    pub session_id: String,
    pub turn_intent_id: String,
    pub display_content: String,
    pub image_data_urls: Vec<String>,
}

#[tauri::command]
pub async fn agent_org_rejected_request_draft(
    state: tauri::State<'_, AgentAppState>,
    session_id: String,
    turn_intent_id: String,
) -> Result<AgentOrgRejectedRequestDraft, String> {
    crate::coordination::agent_org_runs::require_agent_org_enabled()?;
    let read_context = session_org_read_context(&state, &session_id)
        .await?
        .ok_or_else(|| NOT_RECOVERABLE.to_string())?;
    let run_id = read_context
        .context
        .ok_or_else(|| NOT_RECOVERABLE.to_string())?
        .run_id;

    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|error| error.to_string())?;
        load_rejected_request_draft_with_connection(&conn, &run_id, &session_id, &turn_intent_id)
    })
    .await
    .map_err(|error| format!("Rejected request draft worker failed: {error}"))?
}

fn load_rejected_request_draft_with_connection(
    conn: &Connection,
    run_id: &str,
    session_id: &str,
    turn_intent_id: &str,
) -> Result<AgentOrgRejectedRequestDraft, String> {
    let source: Option<(String, String)> = conn
        .query_row(
            "SELECT source_kind,source_id
             FROM agent_org_runtime_turn_contexts
             WHERE org_run_id=?1 AND session_id=?2 AND turn_intent_id=?3
               AND turn_kind='coordinator' AND participant_id='coordinator'
               AND source_kind IN ('root_turn','group_root')",
            params![run_id, session_id, turn_intent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((source_kind, source_id)) = source else {
        return Err(NOT_RECOVERABLE.to_string());
    };

    let mut statement = conn
        .prepare(
            "SELECT result_text
             FROM agent_org_runtime_tool_call_receipts
             WHERE org_run_id=?1 AND session_id=?2 AND turn_intent_id=?3
               AND tool_name IN ('task_create','task_graph_create')
               AND result_text IS NOT NULL
             ORDER BY created_at DESC,call_id DESC LIMIT 32",
        )
        .map_err(|error| error.to_string())?;
    let receipt_results = statement
        .query_map(params![run_id, session_id, turn_intent_id], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    let rejection_proven = receipt_results.iter().any(|result| {
        serde_json::from_str::<serde_json::Value>(result)
            .ok()
            .is_some_and(|value| {
                value
                    .get("requires_episode_resolution")
                    .and_then(serde_json::Value::as_bool)
                    == Some(true)
                    && value
                        .get("rejected_request_turn_intent_id")
                        .and_then(serde_json::Value::as_str)
                        == Some(turn_intent_id)
            })
    });
    if !rejection_proven {
        return Err(NOT_RECOVERABLE.to_string());
    }

    let event_json: Option<(String, Option<String>)> = if source_kind == "group_root" {
        conn.query_row(
            "SELECT result_json,meta_json FROM events
             WHERE id=?1 AND session_id=?2 AND function_name='user_message'
               AND json_valid(result_json)
               AND json_extract(result_json,'$.turnIntentId')=?3",
            params![source_id, session_id, turn_intent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
    } else {
        conn.query_row(
            "SELECT result_json,meta_json FROM events
             WHERE session_id=?1 AND function_name='user_message'
               AND json_valid(result_json)
               AND json_extract(result_json,'$.turnIntentId')=?2
             ORDER BY history_sequence ASC,id ASC LIMIT 1",
            params![session_id, turn_intent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
    };
    let Some((result_json, meta_json)) = event_json else {
        return Err(NOT_RECOVERABLE.to_string());
    };
    let result: serde_json::Value =
        serde_json::from_str(&result_json).map_err(|_| NOT_RECOVERABLE.to_string())?;
    let display_content = meta_json
        .as_deref()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|meta| {
            meta.get("displayText")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
        })
        .filter(|content| !content.is_empty())
        .or_else(|| {
            result
                .pointer("/message/content")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default();
    let image_data_urls = result
        .get("images")
        .and_then(serde_json::Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if display_content.trim().is_empty() && image_data_urls.is_empty() {
        return Err(NOT_RECOVERABLE.to_string());
    }

    Ok(AgentOrgRejectedRequestDraft {
        session_id: session_id.to_string(),
        turn_intent_id: turn_intent_id.to_string(),
        display_content,
        image_data_urls,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(
            "CREATE TABLE agent_org_runtime_turn_contexts(
                 org_run_id TEXT,session_id TEXT,turn_intent_id TEXT,
                 turn_kind TEXT,participant_id TEXT,source_kind TEXT,source_id TEXT
             );
             CREATE TABLE agent_org_runtime_tool_call_receipts(
                 org_run_id TEXT,session_id TEXT,turn_intent_id TEXT,call_id TEXT,
                 tool_name TEXT,result_text TEXT,created_at TEXT
             );
             CREATE TABLE events(
                 id TEXT,session_id TEXT,function_name TEXT,result_json TEXT,
                 meta_json TEXT,history_sequence INTEGER
             );
             INSERT INTO agent_org_runtime_turn_contexts VALUES(
                 'run','session','turn','coordinator','coordinator','root_turn','turn'
             );
             INSERT INTO agent_org_runtime_tool_call_receipts VALUES(
                 'run','session','turn','call','task_create',
                 '{\"created\":false,\"requires_episode_resolution\":true,\"rejected_request_turn_intent_id\":\"turn\"}',
                 'now'
             );
             INSERT INTO events VALUES(
                 'user-message-id','session','user_message',
                 '{\"turnIntentId\":\"turn\",\"message\":{\"content\":\"expanded\"},\"images\":[\"data:image/png;base64,a\"]}',
                 '{\"displayText\":\"original @Member request\"}',1
             );",
        )
        .expect("create rejected request fixture");
        conn
    }

    #[test]
    fn restores_only_the_exact_rejected_turn_source() {
        let conn = fixture();
        let draft = load_rejected_request_draft_with_connection(&conn, "run", "session", "turn")
            .expect("load exact rejected request");

        assert_eq!(draft.display_content, "original @Member request");
        assert_eq!(draft.image_data_urls, ["data:image/png;base64,a"]);
        assert_eq!(draft.turn_intent_id, "turn");

        conn.execute(
            "UPDATE agent_org_runtime_tool_call_receipts
             SET result_text=replace(result_text,'\"turn\"','\"other-turn\"')",
            [],
        )
        .expect("break receipt provenance");
        let error = load_rejected_request_draft_with_connection(&conn, "run", "session", "turn")
            .expect_err("nearby content must not replace missing exact provenance");
        assert_eq!(error, NOT_RECOVERABLE);
    }
}
