//! Historical identity and visible facts, deliberately independent of execution.
//! Raw archives are for recovery only; neither reads nor admissions execute them.

mod archive;
mod capture;
mod copies;
mod read;

use rusqlite::{Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub use copies::mirror_events;
pub(crate) use copies::{mirror_task_output, mirror_visible_item};
pub use read::{
    descriptor, page, require_current_run, HistoryDescriptor, HistoryMode, HistoryPage,
};

pub const READ_ONLY_ERROR: &str = "agent_org_history_read_only";

pub(super) fn cutover_complete(conn: &Connection) -> rusqlite::Result<bool> {
    if !table_exists(conn, "org_history_state")? {
        return Ok(false);
    }
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM org_history_state WHERE singleton=1)",
        [],
        |row| row.get(0),
    )
}

pub(super) fn prepare_cutover(conn: &Connection, fresh: bool) -> rusqlite::Result<()> {
    conn.execute_batch(include_str!("schema.sql"))?;
    archive::retire_previous_execution(conn, fresh)
}

pub(super) fn finish_cutover(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("INSERT OR IGNORE INTO org_history_state VALUES (1,1)", [])?;
    Ok(())
}

pub fn is_history(conn: &Connection, session_id: &str) -> rusqlite::Result<bool> {
    if !table_exists(conn, "org_history_sessions")? {
        return Ok(false);
    }
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM org_history_sessions WHERE session_id=?1)
             OR EXISTS(SELECT 1 FROM org_history_copies WHERE copy_session_id=?1)",
        [session_id],
        |row| row.get(0),
    )
}

pub fn require_writable(conn: &Connection, session_id: &str) -> Result<(), String> {
    if is_history(conn, session_id).map_err(|error| error.to_string())? {
        Err(READ_ONLY_ERROR.into())
    } else {
        Ok(())
    }
}

pub(crate) fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table],
        |row| row.get(0),
    )
}

pub(super) fn quoted(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(super) fn stable_id(kind: &str, source: &str) -> String {
    format!("org-history-{kind}-{:x}", Sha256::digest(source.as_bytes()))
}

pub(super) fn optional_text(row: &rusqlite::Row<'_>, column: &str) -> Option<String> {
    row.get::<_, Option<String>>(column).ok().flatten()
}

pub(super) fn root_for_run(conn: &Connection, run_id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT root_session_id FROM org_history_sessions
         WHERE run_id=?1 AND root_session_id IS NOT NULL LIMIT 1",
        [run_id],
        |row| row.get(0),
    )
    .optional()
}

/// Resolve persisted history ownership before runtime loading or provider work.
pub async fn require_writable_session(session_id: &str) -> Result<(), String> {
    let session_id = session_id.to_owned();
    tokio::task::spawn_blocking(move || {
        let conn = database::db::get_connection().map_err(|error| error.to_string())?;
        require_writable(&conn, &session_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
