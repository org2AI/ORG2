//! Source projection for native sessions. Uses the same canonical user filter
//! as the turn index, plus visible assistant messages and finalized tool activity.
use std::collections::HashMap;

use core_types::activity::ActivityChunk;
use orgtrack_core::sources::imported_history::user_sources::{
    source_message_from_chunk, UserSourceMessage,
};
use rusqlite::{params, Connection, Result};
use serde_json::{json, Value};

use crate::turn_index::{load_stored_user_messages, StoredUserMessage};

pub fn load_stored_source_messages(session_id: &str) -> Result<Vec<UserSourceMessage>> {
    // Retain the turn index's backfill and synthetic/internal user exclusions.
    let users = load_stored_user_messages(session_id)?;
    let conn = crate::connection::get_connection()?;
    stored_source_messages(&conn, session_id, users)
}

fn stored_source_messages(
    conn: &Connection,
    session_id: &str,
    users: Vec<StoredUserMessage>,
) -> Result<Vec<UserSourceMessage>> {
    let mut users: HashMap<_, _> = users
        .into_iter()
        .map(|user| (user.id.clone(), user))
        .collect();
    // Keep structured JSON bounded before crossing SQLite -> Rust; inline blobs
    // and arbitrary huge tool logs have no place in the source registry.
    let mut stmt = conn.prepare_cached(
        "SELECT id, event_type, function_name,
                CASE WHEN length(args_json) <= 262144 THEN args_json ELSE '{}' END,
                CASE WHEN length(result_json) <= 262144 THEN result_json ELSE '{}' END,
                CASE WHEN length(content) <= 262144 THEN content ELSE '' END,
                CASE WHEN length(meta_json) <= 262144 THEN meta_json ELSE '{}' END, created_at
         FROM events WHERE session_id = ?1
         ORDER BY history_sequence ASC, created_at ASC, id ASC",
    )?;
    let mut rows = stmt.query(params![session_id])?;
    let mut sources = Vec::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        if let Some(user) = users.remove(&id) {
            if let Some(source) = UserSourceMessage::new(user.id, &user.text, user.images) {
                sources.push(source);
            }
            continue;
        }
        let event_type: String = row.get(1)?;
        let function: Option<String> = row.get(2)?;
        let args: String = row.get(3)?;
        let result: String = row.get(4)?;
        let content: String = row.get(5)?;
        let meta: Option<String> = row.get(6)?;
        let meta: Value = meta
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(Value::Null);
        if core_types::session_event::is_internal_lifecycle_action_type(&event_type)
            || matches!(
                function.as_deref(),
                Some("thinking" | "reasoning" | "system" | "developer")
            )
            || meta.get("isDelta").and_then(Value::as_bool) == Some(true)
            || matches!(
                meta.get("source").and_then(Value::as_str),
                Some("system" | "developer")
            )
        {
            continue;
        }
        let is_assistant = event_type == "assistant"
            || matches!(
                function.as_deref(),
                Some("assistant" | "assistant_message" | "agent_message" | "message")
            );
        let is_tool = event_type == "tool_call";
        if !is_assistant && !is_tool {
            continue;
        }
        if is_assistant
            && (meta
                .get("displayVariant")
                .and_then(Value::as_str)
                .is_some_and(|s| s != "message")
                || meta
                    .get("displayStatus")
                    .and_then(Value::as_str)
                    .is_some_and(|s| s != "completed"))
        {
            continue;
        }
        if is_tool
            && meta
                .get("displayStatus")
                .and_then(Value::as_str)
                .is_some_and(|status| !matches!(status, "completed" | "failed" | "cancelled"))
        {
            continue;
        }
        let mut chunk = ActivityChunk::new(
            session_id,
            if is_assistant {
                "assistant"
            } else {
                "tool_call"
            },
            function.as_deref().unwrap_or_default(),
        );
        chunk.chunk_id = id;
        chunk.args = serde_json::from_str(&args).unwrap_or(Value::Null);
        chunk.result = serde_json::from_str(&result).unwrap_or_else(|_| json!({}));
        if is_tool {
            if !chunk.result.is_object() {
                chunk.result = json!({});
            }
            if let Some(status) = meta.get("displayStatus").and_then(Value::as_str) {
                if matches!(status, "failed" | "cancelled") {
                    chunk.result["success"] = json!(false);
                } else if status == "completed" && chunk.result.get("success").is_none() {
                    chunk.result["success"] = json!(true);
                }
            }
            if let Some(call_id) = meta.get("callId").and_then(Value::as_str) {
                chunk.result["call_id"] = json!(call_id);
            }
        }
        if is_assistant
            && chunk
                .result
                .get("content")
                .and_then(Value::as_str)
                .is_none()
            && !content.is_empty()
        {
            if !chunk.result.is_object() {
                chunk.result = json!({});
            }
            chunk.result["content"] = json!(content);
        }
        if let Some(source) = source_message_from_chunk(&chunk) {
            sources.push(source);
        }
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    use orgtrack_core::sources::imported_history::user_sources::SourceMessageRole;

    #[test]
    fn native_messages_and_successful_tool_resources_keep_order_and_provenance() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE events(id TEXT,session_id TEXT,event_type TEXT,function_name TEXT,args_json TEXT,result_json TEXT,content TEXT,meta_json TEXT,created_at TEXT,history_sequence INTEGER);").unwrap();
        let records = [
            ("u", "raw", "user_message", "{}", "{}", "", "{}"),
            (
                "a",
                "assistant",
                "assistant_message",
                "{}",
                "{}",
                "[PR](https://github.com/example/repo/pull/1) [plan](/tmp/plan.md)",
                "{}",
            ),
            (
                "t",
                "tool_call",
                "write_file",
                r#"{"path":"/tmp/result.md"}"#,
                r#"{"success":true}"#,
                "",
                "{}",
            ),
            (
                "f",
                "tool_call",
                "write_file",
                r#"{"path":"/tmp/failed.md"}"#,
                r#"{"success":false}"#,
                "",
                "{}",
            ),
            (
                "terminal",
                "tool_call",
                "mcp__codex_app.read_thread_terminal",
                "{}",
                r#"{"isError":true,"content":[{"type":"text","text":"No terminal session attached"}]}"#,
                "",
                r#"{"displayStatus":"failed","callId":"terminal-call"}"#,
            ),
            (
                "pending",
                "tool_call",
                "read_file",
                r#"{"path":"/tmp/pending.md"}"#,
                r#"{"success":false,"status":"pending"}"#,
                "",
                r#"{"displayStatus":"running"}"#,
            ),
            (
                "s",
                "system",
                "system",
                "{}",
                "{}",
                "https://internal.example",
                "{}",
            ),
            (
                "thinking",
                "assistant",
                "assistant_message",
                "{}",
                "{}",
                "https://thought.example",
                r#"{"displayVariant":"thinking"}"#,
            ),
        ];
        for (index, (id, kind, function, args, result, content, meta)) in
            records.into_iter().enumerate()
        {
            conn.execute(
                "INSERT INTO events VALUES(?1,'s',?2,?3,?4,?5,?6,?7,'now',?8)",
                params![id, kind, function, args, result, content, meta, index],
            )
            .unwrap();
        }
        let sources = stored_source_messages(
            &conn,
            "s",
            vec![StoredUserMessage {
                id: "u".into(),
                text: "https://input.example".into(),
                images: vec![],
            }],
        )
        .unwrap();
        assert_eq!(
            sources
                .iter()
                .map(|s| (s.id.as_str(), s.role))
                .collect::<Vec<_>>(),
            vec![
                ("u", SourceMessageRole::User),
                ("a", SourceMessageRole::Assistant),
                ("t", SourceMessageRole::Tool),
                ("f", SourceMessageRole::Tool),
                ("terminal-call", SourceMessageRole::Tool)
            ]
        );
        assert!(sources[1].text.contains("/tmp/plan.md"));
        // Successful edit receipts contribute activity, not a resource row.
        assert!(sources[2].text.is_empty());
        assert!(sources[2].tool_activity.is_some());
        assert!(sources[3].text.is_empty());
        assert_eq!(
            sources[4].tool_activity.as_ref().unwrap().error.as_deref(),
            Some("No terminal session attached")
        );
        assert_eq!(
            sources[4].tool_activity.as_ref().unwrap().call_id,
            "terminal-call"
        );
        assert_eq!(
            sources[3].tool_activity.as_ref().unwrap().status,
            orgtrack_core::sources::imported_history::user_sources::ToolActivityStatus::Error
        );
    }
}
