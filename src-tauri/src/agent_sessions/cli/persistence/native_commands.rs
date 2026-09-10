//! One disposable catalog row per managed session. Native rollout readers do
//! not preserve SDK init messages, so this metadata must survive separately
//! from provider-owned transcript content. Session deletion cascades the row.
use core_types::activity::ActivityChunk;
use database::db::get_connection;
use rusqlite::{params, Connection, OptionalExtension};

fn catalog_id(session_id: &str) -> String {
    format!("native-command-catalog:{session_id}")
}

fn save(conn: &Connection, chunk: &ActivityChunk) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO code_session_chunks (chunk_id, session_id, action_type, function, args_json, result_json, sequence, created_at) VALUES (?1, ?2, 'native_command_catalog', 'native_command_catalog', ?3, '{\"success\":true}', -1, ?4) ON CONFLICT(chunk_id) DO UPDATE SET args_json=excluded.args_json, created_at=excluded.created_at",
        params![catalog_id(&chunk.session_id), chunk.session_id, chunk.args.to_string(), chunk.created_at])?;
    Ok(())
}

pub fn record_native_commands(chunk: &ActivityChunk) -> rusqlite::Result<()> {
    if !matches!(
        chunk.action_type.as_str(),
        "session_start" | "native_command_catalog"
    ) || !chunk
        .args
        .get("slash_commands")
        .is_some_and(serde_json::Value::is_array)
    {
        return Ok(());
    }
    let conn = get_connection()?;
    save(&conn, chunk)
}

pub fn load_native_commands(session_id: &str) -> rusqlite::Result<Option<ActivityChunk>> {
    let conn = get_connection()?;
    load(&conn, session_id)
}

pub fn load_native_commands_for_provider(
    session_id: &str,
    provider: &str,
) -> Result<Option<ActivityChunk>, String> {
    let catalog = load_native_commands(session_id)
        .map_err(|error| format!("Native command catalog: {error}"))?;
    Ok(catalog.filter(|chunk| {
        chunk
            .args
            .get("native_provider")
            .and_then(serde_json::Value::as_str)
            == Some(provider)
    }))
}

fn load(conn: &Connection, session_id: &str) -> rusqlite::Result<Option<ActivityChunk>> {
    conn.query_row(
        "SELECT args_json, created_at FROM code_session_chunks WHERE chunk_id=?1 AND session_id=?2",
        params![catalog_id(session_id), session_id],
        |row| {
            let args: String = row.get(0)?;
            let mut chunk = ActivityChunk::new(
                session_id,
                "native_command_catalog",
                "native_command_catalog",
            );
            chunk.chunk_id = catalog_id(session_id);
            chunk.created_at = row.get(1)?;
            chunk.args = serde_json::from_str(&args).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            chunk.result = serde_json::json!({"success":true});
            Ok(chunk)
        },
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_one_catalog_without_touching_other_sessions_or_transcripts() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::agent_sessions::cli::init_cli_agent_tables(&db).unwrap();
        db.execute(
            "INSERT INTO code_sessions (session_id,created_at,updated_at) VALUES ('a','now','now')",
            [],
        )
        .unwrap();
        let mut chunk = ActivityChunk::new("a", "session_start", "session_start");
        for index in 0..20 {
            chunk.args = serde_json::json!({"native_provider":"claude_code", "slash_commands":[format!("skill-{index}")]});
            save(&db, &chunk).unwrap();
        }
        assert_eq!(
            db.query_row("SELECT count(*) FROM code_session_chunks", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let loaded = load(&db, "a").unwrap().unwrap();
        assert_eq!(loaded.args, chunk.args);
        assert_eq!(loaded.action_type, "native_command_catalog");
        assert_eq!(loaded.created_at, chunk.created_at);
        assert!(load(&db, "b").unwrap().is_none());
        db.execute("DELETE FROM code_sessions WHERE session_id='a'", [])
            .unwrap();
        assert!(load(&db, "a").unwrap().is_none());
    }
}
