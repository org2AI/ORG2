//! Immutable non-secret execution-source ownership for a managed TUI Session.
//! Provider grants remain in the source's native credential store. This row
//! survives process-local proxy tokens and is removed with its owning Session.
use database::db::{get_connection, with_sessions_writer};
use rusqlite::{params, Connection, OptionalExtension};

pub(super) fn bind_for_runner(
    conn: &Connection,
    session: &str,
    selection: &str,
    agent: &str,
    model: &str,
    runner: &str,
) -> rusqlite::Result<()> {
    // Bind only the exact persisted launch choice, and never silently rebind an
    // existing session to another billing source. Repeating the same bind is safe.
    let changed = conn.execute(
        "INSERT INTO code_session_credential_sources (session_id, selection)
         SELECT session_id, ?2 FROM code_sessions
         WHERE session_id=?1 AND runner=?5 AND cli_agent_type=?3 AND model=?4 AND account_id IS NULL AND COALESCE(key_source,'own_key')='own_key'
         ON CONFLICT(session_id) DO UPDATE SET selection=excluded.selection
         WHERE code_session_credential_sources.selection=excluded.selection",
        params![session, selection, agent, model, runner],
    )?;
    if changed != 1 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

fn bind(
    conn: &Connection,
    session: &str,
    selection: &str,
    agent: &str,
    model: &str,
) -> rusqlite::Result<()> {
    bind_for_runner(conn, session, selection, agent, model, "tui")
}

pub fn bind_credential_source(
    session: &str,
    selection: &str,
    agent: &str,
    model: &str,
) -> Result<(), String> {
    with_sessions_writer(|| {
        let conn = get_connection()?;
        bind(&conn, session, selection, agent, model)
    })
    .map_err(|error| format!("Cannot bind the session credential source: {error}"))
}

fn load(conn: &Connection, session: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT selection FROM code_session_credential_sources WHERE session_id=?1",
        [session],
        |row| row.get(0),
    )
    .optional()
}

pub fn credential_source(session: &str) -> Result<Option<String>, String> {
    let conn = get_connection().map_err(|error| error.to_string())?;
    load(&conn, session)
        .map_err(|error| format!("Cannot read the session credential source: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn open(path: &std::path::Path, foreign_keys: bool) -> Connection {
        let conn = Connection::open(path).unwrap();
        database::db::configure_connection(&conn).unwrap();
        conn.pragma_update(None, "foreign_keys", foreign_keys)
            .unwrap();
        crate::agent_sessions::cli::init_cli_agent_tables(&conn).unwrap();
        conn
    }
    #[test]
    fn binding_survives_reopen_refuses_rebinding_and_deletes_with_owner() {
        for foreign_keys in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("sessions.db");
            let conn = open(&path, foreign_keys);
            conn.execute("INSERT INTO code_sessions (session_id,runner,cli_agent_type,model,created_at,updated_at) VALUES ('session-a','tui','codex','model-a','now','now'), ('session-b','local','codex','model-a','now','now')", []).unwrap();
            bind(&conn, "session-a", "test:workspace-a", "codex", "model-a").unwrap();
            bind(&conn, "session-a", "test:workspace-a", "codex", "model-a").unwrap();
            assert!(bind(&conn, "session-a", "test:workspace-b", "codex", "model-a").is_err());
            assert!(bind(
                &conn,
                "session-a",
                "test:workspace-a",
                "claude_code",
                "model-a"
            )
            .is_err());
            assert!(bind(
                &conn,
                "session-a",
                "test:workspace-a",
                "codex",
                "other-model"
            )
            .is_err());
            assert!(bind(&conn, "session-b", "test:workspace-b", "codex", "model-a").is_err());
            assert!(bind(&conn, "missing", "test:workspace-a", "codex", "model-a").is_err());
            bind_for_runner(
                &conn,
                "session-b",
                "test:workspace-b",
                "codex",
                "model-a",
                "local",
            )
            .unwrap();
            assert!(bind_for_runner(
                &conn,
                "session-a",
                "test:workspace-a",
                "codex",
                "model-a",
                "local"
            )
            .is_err());
            drop(conn);
            let conn = open(&path, foreign_keys);
            assert_eq!(
                load(&conn, "session-a").unwrap().as_deref(),
                Some("test:workspace-a")
            );
            assert_eq!(
                load(&conn, "session-b").unwrap().as_deref(),
                Some("test:workspace-b")
            );
            conn.execute("DELETE FROM code_sessions WHERE session_id='session-a'", [])
                .unwrap();
            assert_eq!(load(&conn, "session-a").unwrap(), None);
        }
    }
}
