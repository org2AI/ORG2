//! Turn-window queries over the normalized session event cache.
//!
//! These functions intentionally return `CachedEvent` rows from `events`; the
//! app crate converts them to `SessionEvent` at the existing cache bridge layer.

use rusqlite::{params_from_iter, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};

use super::connection::get_connection;
use super::turn_index;
use super::types::CachedEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedTurnBodyWindow {
    pub turn_id: String,
    pub events: Vec<CachedEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedInitialTurnWindow {
    pub turns: Vec<turn_index::CachedTurnSummary>,
    pub events: Vec<CachedEvent>,
}

fn cached_event_from_row(row: &rusqlite::Row<'_>) -> SqliteResult<CachedEvent> {
    Ok(CachedEvent {
        id: row.get(0)?,
        session_id: row.get(1)?,
        event_type: row.get(2)?,
        function_name: row.get(3)?,
        thread_id: row.get(4)?,
        args_json: row.get(5)?,
        result_json: row.get(6)?,
        content: row.get(7)?,
        created_at: row.get(8)?,
        meta_json: row.get(9)?,
        history_sequence: row.get(10)?,
    })
}

// Shared with the derived lookup index. Inbox message ids never override execution ownership.
pub(crate) const EXECUTION_OWNER_SQL: &str = "COALESCE(
    CASE WHEN json_valid(args_json) THEN json_extract(args_json, '$.agentOrgExecution.turnIntentId') END,
    CASE WHEN json_valid(result_json) THEN json_extract(result_json, '$.agentOrgExecution.turnIntentId') END,
    CASE WHEN json_valid(result_json) THEN json_extract(result_json, '$.turnIntentId') END,
    CASE WHEN json_valid(args_json) THEN COALESCE(json_extract(args_json, '$.turnIntentId'),
         json_extract(args_json, '$.conversationTurnId'), json_extract(args_json, '$.details.turnIntentId')) END)";

fn load_events_for_turn(
    conn: &Connection,
    session_id: &str,
    turn: &turn_index::CachedTurnSummary,
    preview: bool,
) -> SqliteResult<Vec<CachedEvent>> {
    let (predicate, owner) = if let Some(execution) = &turn.execution {
        (
            format!("({EXECUTION_OWNER_SQL}) = ?2"),
            rusqlite::types::Value::Text(execution.turn_intent_id.clone()),
        )
    } else {
        (
            "history_sequence >= ?2 AND (?3 IS NULL OR history_sequence < ?3)".to_string(),
            rusqlite::types::Value::Integer(turn.start_sequence),
        )
    };
    let preview_filter = if preview {
        "AND (event_type = 'assistant' OR function_name IN ('assistant_message', 'agent_message', 'message')
        OR json_extract(meta_json, '$.uiCanonical') IN ('assistant_message', 'agent_message'))
        AND COALESCE(json_extract(meta_json, '$.displayVariant'), 'message') = 'message'
        AND COALESCE(json_extract(meta_json, '$.displayStatus'), 'completed') = 'completed'"
    } else {
        ""
    };
    let ordering = if preview { "DESC" } else { "ASC" };
    let limit = if preview { "LIMIT 1" } else { "" };
    let query = format!(
        "SELECT id, session_id, event_type, function_name, thread_id,
        args_json, result_json, content, created_at, meta_json, history_sequence
        FROM events WHERE session_id = ?1 AND {predicate} {preview_filter}
        ORDER BY history_sequence {ordering}, id {ordering} {limit}"
    );
    let mut stmt = conn.prepare_cached(&query)?;
    let mut values = vec![rusqlite::types::Value::Text(session_id.to_string()), owner];
    if turn.execution.is_none() {
        values.push(turn.end_sequence.into());
    }
    let events = stmt
        .query_map(params_from_iter(values), cached_event_from_row)?
        .collect::<SqliteResult<Vec<_>>>()?;
    Ok(if preview {
        events.into_iter().map(mark_turn_preview).collect()
    } else {
        events
    })
}

fn load_events_by_ids(session_id: &str, ids: &[String]) -> SqliteResult<Vec<CachedEvent>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let conn = get_connection()?;
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT id, session_id, event_type, function_name, thread_id,
                args_json, result_json, content, created_at, meta_json, history_sequence
         FROM events
         WHERE session_id = ? AND id IN ({placeholders})
         ORDER BY created_at ASC, COALESCE(history_sequence, rowid) ASC, id ASC"
    );
    let params = std::iter::once(session_id).chain(ids.iter().map(String::as_str));
    let mut stmt = conn.prepare(&query)?;
    let rows = stmt
        .query_map(params_from_iter(params), cached_event_from_row)?
        .collect::<SqliteResult<Vec<_>>>()?;

    Ok(rows)
}

/// Load the most recent `limit` events whose `function_name` is one of
/// `function_names`, returned in ascending timeline order.
///
/// Used to pin artifact-producing events (inline-Canvas renders/revisions)
/// into the initial turn window: older turns collapse into placeholders,
/// but the canvas projection and `revise_inline_canvas` target validation
/// address those events by id regardless of which turn produced them.
pub fn load_session_pinned_artifact_events(
    session_id: &str,
    function_names: &[&str],
    limit: usize,
) -> SqliteResult<Vec<CachedEvent>> {
    let conn = get_connection()?;
    load_pinned_artifact_events(&conn, session_id, function_names, limit)
}

fn load_pinned_artifact_events(
    conn: &Connection,
    session_id: &str,
    function_names: &[&str],
    limit: usize,
) -> SqliteResult<Vec<CachedEvent>> {
    if function_names.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let placeholders = std::iter::repeat_n("?", function_names.len())
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT id, session_id, event_type, function_name, thread_id,
                args_json, result_json, content, created_at, meta_json, history_sequence
         FROM events
         WHERE session_id = ? AND function_name IN ({placeholders})
         ORDER BY created_at DESC, COALESCE(history_sequence, rowid) DESC, id DESC
         LIMIT {limit}"
    );
    let params = std::iter::once(session_id).chain(function_names.iter().copied());
    let mut stmt = conn.prepare(&query)?;
    let mut events = stmt
        .query_map(params_from_iter(params), cached_event_from_row)?
        .collect::<SqliteResult<Vec<_>>>()?;
    events.reverse();
    Ok(events)
}

const TURN_PREVIEW_ARG_KEY: &str = "turnPreviewOnly";

fn mark_turn_preview(mut event: CachedEvent) -> CachedEvent {
    let mut args = serde_json::from_str::<serde_json::Value>(&event.args_json)
        .unwrap_or_else(|_| serde_json::json!({}));
    if let Some(args_object) = args.as_object_mut() {
        args_object.insert(
            TURN_PREVIEW_ARG_KEY.to_string(),
            serde_json::Value::Bool(true),
        );
        event.args_json = serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string());
    }
    event
}

pub fn load_turn_body_window(
    session_id: &str,
    turn_id: &str,
) -> SqliteResult<CachedTurnBodyWindow> {
    turn_index::ensure_turn_index_fresh(session_id)?;
    let conn = get_connection()?;
    let Some(summary) = turn_index::get_turn_summary(&conn, session_id, turn_id)? else {
        return Ok(CachedTurnBodyWindow {
            turn_id: turn_id.to_string(),
            events: Vec::new(),
        });
    };

    let events = load_events_for_turn(&conn, session_id, &summary, false)?;

    Ok(CachedTurnBodyWindow {
        turn_id: turn_id.to_string(),
        events,
    })
}

pub fn load_initial_turn_window(
    session_id: &str,
    recent_turn_count: usize,
) -> SqliteResult<CachedInitialTurnWindow> {
    let turns = turn_index::load_turn_index(session_id)?;
    let recent_start = turns.len().saturating_sub(recent_turn_count);
    let header_event_ids = turns[..recent_start]
        .iter()
        .flat_map(|turn| {
            turn.user_event_ids
                .iter()
                .cloned()
                .chain(turn.execution.as_ref().map(|_| turn.turn_id.clone()))
        })
        .collect::<Vec<_>>();
    let mut events = load_events_by_ids(session_id, &header_event_ids)?;
    let conn = get_connection()?;
    for (index, turn) in turns.iter().enumerate() {
        events.extend(load_events_for_turn(
            &conn,
            session_id,
            turn,
            index < recent_start,
        )?);
    }
    events.sort_by(|left, right| {
        left.history_sequence
            .cmp(&right.history_sequence)
            .then_with(|| left.id.cmp(&right.id))
    });
    events.dedup_by(|left, right| left.id == right.id);

    Ok(CachedInitialTurnWindow { turns, events })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn events_test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        crate::schema::init_session_tables(&conn).expect("init session schema");
        conn
    }

    fn insert_event(
        conn: &Connection,
        session_id: &str,
        id: &str,
        function_name: &str,
        created_at: &str,
    ) {
        conn.execute(
            "INSERT INTO events (id, session_id, event_type, function_name,
                                 args_json, result_json, content, created_at)
             VALUES (?1, ?2, 'tool_call', ?3, '{}', '{}', '', ?4)",
            params![id, session_id, function_name, created_at],
        )
        .expect("insert event");
    }

    #[test]
    fn pinned_artifact_events_survive_outside_the_recent_turn_window() {
        // A canvas rendered in turn 1 must be loadable even though the
        // initial turn window only materializes the most recent turn's body.
        let conn = events_test_conn();
        insert_event(
            &conn,
            "session-a",
            "tool-call-canvas-1",
            "render_inline_canvas",
            "2026-08-01T00:00:01.000Z",
        );
        insert_event(
            &conn,
            "session-a",
            "tool-call-canvas-2",
            "revise_inline_canvas",
            "2026-08-01T00:10:00.000Z",
        );
        insert_event(
            &conn,
            "session-a",
            "tool-call-read-1",
            "read_file",
            "2026-08-01T00:20:00.000Z",
        );
        insert_event(
            &conn,
            "session-b",
            "tool-call-canvas-other",
            "render_inline_canvas",
            "2026-08-01T00:00:02.000Z",
        );

        let events = load_pinned_artifact_events(
            &conn,
            "session-a",
            &["render_inline_canvas", "revise_inline_canvas"],
            64,
        )
        .expect("load pinned artifact events");

        let ids: Vec<&str> = events.iter().map(|event| event.id.as_str()).collect();
        assert_eq!(ids, vec!["tool-call-canvas-1", "tool-call-canvas-2"]);
    }

    #[test]
    fn pinned_artifact_events_cap_keeps_the_most_recent() {
        let conn = events_test_conn();
        for index in 0..5 {
            insert_event(
                &conn,
                "session-a",
                &format!("tool-call-canvas-{index}"),
                "render_inline_canvas",
                &format!("2026-08-01T00:00:0{index}.000Z"),
            );
        }

        let events = load_pinned_artifact_events(&conn, "session-a", &["render_inline_canvas"], 2)
            .expect("load pinned artifact events");

        let ids: Vec<&str> = events.iter().map(|event| event.id.as_str()).collect();
        assert_eq!(ids, vec!["tool-call-canvas-3", "tool-call-canvas-4"]);
    }

    #[test]
    fn pinned_artifact_events_with_no_names_or_zero_cap_are_empty() {
        let conn = events_test_conn();
        insert_event(
            &conn,
            "session-a",
            "tool-call-canvas-1",
            "render_inline_canvas",
            "2026-08-01T00:00:01.000Z",
        );

        assert!(load_pinned_artifact_events(&conn, "session-a", &[], 64)
            .expect("empty name list")
            .is_empty());
        assert!(
            load_pinned_artifact_events(&conn, "session-a", &["render_inline_canvas"], 0)
                .expect("zero cap")
                .is_empty()
        );
    }
}
