//! Read-only compatibility for workers whose launch input was appended after
//! their streamed output. The parent's exact launch fact establishes ownership;
//! timestamps alone are not enough to reassign pre-input activity.
use rusqlite::{params, Connection, OptionalExtension, Result};

pub(crate) struct LegacySubagentInput {
    pub event_id: String,
    pub started_at: String,
}

pub(crate) fn load(conn: &Connection, session_id: &str) -> Result<Option<LegacySubagentInput>> {
    let has_sessions: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'agent_sessions')",
        [],
        |row| row.get(0),
    )?;
    if !has_sessions {
        return Ok(None);
    }
    // Only native workers with an exact, non-resume parent launch are eligible.
    // A real user follow-up, imported transcript, or unmatched orphan stays as-is.
    conn.query_row(
        "SELECT input.id, child.created_at
         FROM agent_sessions child
         JOIN events input ON input.session_id = child.session_id
         WHERE child.session_id = ?1 AND child.session_type = 'subagent'
           AND input.function_name = 'user_message'
           AND input.id = (SELECT id FROM events WHERE session_id = ?1
               AND function_name IN ('user_message', 'user', 'user_input')
               ORDER BY created_at, history_sequence, id LIMIT 1)
           AND EXISTS (SELECT 1 FROM events body WHERE body.session_id = ?1
               AND body.created_at < input.created_at
               AND body.created_at >= child.created_at
               AND body.event_type IN ('tool_call', 'assistant'))
           AND EXISTS (SELECT 1 FROM events launch
               WHERE launch.session_id = child.parent_session_id
                 AND launch.function_name = 'agent'
                 AND json_valid(launch.args_json)
                 AND json_extract(launch.args_json, '$.subagentSessionId') = ?1
                 AND json_extract(launch.args_json, '$.resume_session_id') IS NULL
                 AND json_extract(launch.args_json, '$.fork') IS NOT 1
                 AND json_extract(launch.args_json, '$.prompt') =
                     json_extract(input.result_json, '$.message.content'))",
        params![session_id],
        |row| {
            Ok(LegacySubagentInput {
                event_id: row.get(0)?,
                started_at: row.get(1)?,
            })
        },
    )
    .optional()
}

pub(crate) fn project_events(
    conn: &Connection,
    session_id: &str,
    events: &mut [crate::types::CachedEvent],
) -> Result<()> {
    if let Some(input) = load(conn, session_id)? {
        if let Some(index) = events.iter().position(|event| event.id == input.event_id) {
            events[index].created_at = input.started_at;
            events[index].history_sequence = Some(-1);
            // The rest of the bounded window is already ordered by the loader.
            events[..=index].rotate_right(1);
        }
    }
    Ok(())
}
