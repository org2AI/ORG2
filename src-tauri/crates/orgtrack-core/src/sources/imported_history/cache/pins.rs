use std::collections::HashSet;

use rusqlite::{params, Connection};

/// Set or clear ORGII pin state for one imported session.
///
/// Pins live in their own table rather than on the cache row: the cache is a
/// rebuildable projection whose rows a prune can legitimately delete, and a
/// pin is user intent that must outlive any rescan.
pub fn set_imported_session_pinned_from_conn(
    conn: &Connection,
    session_id: &str,
    pinned: bool,
    pinned_at: &str,
) -> Result<(), String> {
    // A Codex rollout filename is a generation, not the identity of the user's
    // pin. Match that intent by native thread, even if the cache is pruned.
    // Retain physical IDs on disk for compatibility with older builds.
    let identity = imported_session_pin_identity(session_id);
    let transaction = conn
        .unchecked_transaction()
        .map_err(|err| format!("Failed to begin imported pin update: {err}"))?;
    if session_id.starts_with("codexapp-") {
        for old_id in stored_pin_ids(conn)? {
            if old_id != session_id && imported_session_pin_identity(&old_id) == identity {
                transaction
                    .execute(
                        "DELETE FROM imported_history_session_pin WHERE session_id = ?1",
                        [&old_id],
                    )
                    .map_err(|err| format!("Failed to normalize imported pin: {err}"))?;
            }
        }
    }
    let result = if pinned {
        conn.execute(
            "INSERT INTO imported_history_session_pin (session_id, pinned_at)
             VALUES (?1, ?2)
             ON CONFLICT(session_id) DO UPDATE SET pinned_at = excluded.pinned_at",
            params![session_id, pinned_at],
        )
    } else {
        conn.execute(
            "DELETE FROM imported_history_session_pin WHERE session_id = ?1",
            params![session_id],
        )
    };
    result.map_err(|err| format!("Failed to persist imported session pin: {err}"))?;
    transaction
        .commit()
        .map_err(|err| format!("Failed to commit imported session pin: {err}"))
}

pub fn imported_session_pin_identity(session_id: &str) -> String {
    session_id
        .strip_prefix("codexapp-")
        .and_then(crate::sources::cli_resume::codex_thread_uuid_from_stem)
        .map(|thread| format!("codexapp-{thread}"))
        .unwrap_or_else(|| session_id.to_string())
}

/// Pin identities, with legacy Codex rollout keys normalized on read.
/// Compare rows using `imported_session_pin_identity`; no cache scan is needed.
pub fn pinned_imported_session_ids_from_conn(conn: &Connection) -> Result<HashSet<String>, String> {
    Ok(stored_pin_ids(conn)?
        .into_iter()
        .map(|id| imported_session_pin_identity(&id))
        .collect())
}

fn stored_pin_ids(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = conn
        .prepare("SELECT session_id FROM imported_history_session_pin")
        .map_err(|err| format!("Failed to read imported session pins: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("Failed to read imported session pins: {err}"))?;
    let mut ids = HashSet::new();
    for row in rows {
        ids.insert(row.map_err(|err| format!("Failed to read imported session pins: {err}"))?);
    }
    Ok(ids)
}
