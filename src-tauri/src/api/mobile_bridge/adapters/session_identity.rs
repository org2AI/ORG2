//! Resolve a stale imported mirror to its current managed execution owner.
//! Only a persisted, current native binding is eligible. Historical fork ledger
//! entries alone must never redirect a write into a different conversation.
use super::super::rpc::{RpcError, RpcErrorCode};
use key_vault::key_store::ModelType;
use orgtrack_core::sources::imported_history::metadata::SOURCE_CODEX_APP;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

fn resolve_from_conn(conn: &Connection, requested: &str) -> Result<Option<String>, String> {
    let imported: Option<(String, String)> = conn.query_row(
        "SELECT source, source_session_id FROM imported_history_session_cache WHERE session_id = ?1",
        [requested], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(|e| e.to_string())?;
    let Some((source, source_id)) = imported else {
        return Ok(None);
    };
    // Codex cache keys are rollout stems; its native binding is the UUID in
    // the suffix. Validate the exact UUID-shaped boundary, not a title match.
    let native_id = if source == SOURCE_CODEX_APP {
        let Some(start) = source_id.len().checked_sub(36) else {
            return Ok(None);
        };
        let Some(id) = source_id.get(start..) else {
            return Ok(None);
        };
        if uuid::Uuid::parse_str(id).is_err()
            || (start > 0 && source_id.as_bytes()[start - 1] != b'-')
        {
            return Ok(None);
        }
        id.to_string()
    } else {
        return Ok(None); // Other providers are not part of this repair.
    };
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT c.session_id
         FROM code_sessions c
         JOIN code_session_native_transcript_ids n ON n.session_id = c.session_id
         WHERE n.source = ?1 AND n.source_session_id = ?2
           AND c.cli_agent_type = ?3 AND c.cli_session_id = ?2
           AND c.transcript_source = 'native'
         LIMIT 2",
        )
        .map_err(|e| e.to_string())?;
    let owners = stmt
        .query_map(
            rusqlite::params![source, native_id, ModelType::Codex.as_str()],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    match owners.as_slice() {
        [] => Ok(None),
        [owner] => Ok(Some(owner.clone())),
        _ => {
            Err("Multiple managed sessions own this transcript; choose the desktop session".into())
        }
    }
}

fn requested_session_id(params: &Value) -> Result<String, RpcError> {
    let requested = params
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .ok_or_else(|| RpcError::invalid_params("sessionId is required"))?;
    Ok(requested.to_owned())
}

pub async fn resolve(params: &Value) -> Result<Value, RpcError> {
    let requested = requested_session_id(params)?;
    let owner =
        if orgtrack_core::sources::imported_history::is_imported_history_session_id(&requested) {
            let id = requested.clone();
            tokio::task::spawn_blocking(move || {
                let conn = database::db::get_connection().map_err(|e| e.to_string())?;
                resolve_from_conn(&conn, &id)
            })
            .await
            .map_err(|e| RpcError::new(RpcErrorCode::InvalidRequest, e.to_string()))?
            .map_err(|e| RpcError::new(RpcErrorCode::InvalidRequest, e))?
        } else {
            None
        };
    Ok(json!({ "sessionId": owner.as_deref().unwrap_or(&requested), "managed": owner.is_some() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    const NATIVE: &str = "00000000-0000-4000-8000-000000000001";
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE imported_history_session_cache (
            session_id TEXT, source TEXT, source_session_id TEXT);
            CREATE TABLE code_sessions (session_id TEXT, cli_agent_type TEXT,
                cli_session_id TEXT, transcript_source TEXT);
            CREATE TABLE code_session_native_transcript_ids (
                session_id TEXT, source TEXT, source_session_id TEXT);",
        )
        .unwrap();
        // Faithful raw Codex header -> native binding and filename -> cache key.
        let header: Value = serde_json::from_str(
            r#"{"type":"session_meta","payload":{"id":"00000000-0000-4000-8000-000000000001","history_mode":"paginated"}}"#
        ).unwrap();
        let native = header["payload"]["id"].as_str().unwrap();
        conn.execute(
            "INSERT INTO imported_history_session_cache VALUES (?1,?2,?3)",
            rusqlite::params![
                "mirror",
                SOURCE_CODEX_APP,
                format!("rollout-2026-09-10T15-41-10-{native}")
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO code_sessions VALUES ('cliagent-owner',?1,?2,'native')",
            rusqlite::params![ModelType::Codex.as_str(), native],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO code_session_native_transcript_ids VALUES ('cliagent-owner',?1,?2)",
            rusqlite::params![SOURCE_CODEX_APP, native],
        )
        .unwrap();
        conn
    }

    #[test]
    fn requested_identity_is_trimmed_and_bounded() {
        assert_eq!(
            requested_session_id(&json!({ "sessionId": "  mirror  " })).unwrap(),
            "mirror"
        );
        assert!(requested_session_id(&json!({ "sessionId": " " })).is_err());
        assert!(requested_session_id(&json!({ "sessionId": "x".repeat(257) })).is_err());
    }
    #[test]
    fn current_binding_resolves_even_hidden_mirror_without_mutating_history() {
        let conn = db();
        assert_eq!(
            resolve_from_conn(&conn, "mirror").unwrap().as_deref(),
            Some("cliagent-owner")
        );
        assert_eq!(resolve_from_conn(&conn, "cliagent-owner").unwrap(), None);
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM imported_history_session_cache",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
    #[test]
    fn old_fork_deleted_owner_and_unrelated_provider_never_redirect() {
        let conn = db();
        conn.execute("UPDATE code_sessions SET cli_session_id = 'new-fork'", [])
            .unwrap();
        assert_eq!(resolve_from_conn(&conn, "mirror").unwrap(), None);
        conn.execute("UPDATE code_sessions SET cli_session_id = ?1", [NATIVE])
            .unwrap();
        conn.execute(
            "UPDATE imported_history_session_cache SET source = 'claude_code'",
            [],
        )
        .unwrap();
        assert_eq!(resolve_from_conn(&conn, "mirror").unwrap(), None);
        conn.execute("DELETE FROM code_sessions", []).unwrap();
        assert_eq!(resolve_from_conn(&conn, "mirror").unwrap(), None);
    }
    #[test]
    fn ambiguity_is_an_error_not_a_guessed_write_target() {
        let conn = db();
        conn.execute("INSERT INTO code_sessions SELECT 'second',cli_agent_type,cli_session_id,transcript_source FROM code_sessions", []).unwrap();
        conn.execute("INSERT INTO code_session_native_transcript_ids SELECT 'second',source,source_session_id FROM code_session_native_transcript_ids", []).unwrap();
        assert!(resolve_from_conn(&conn, "mirror").is_err());
    }
    #[test]
    fn partial_uuid_and_title_similarity_are_not_identity() {
        let conn = db();
        conn.execute(
            "UPDATE imported_history_session_cache SET source_session_id = ?1",
            [format!("unrelatedX{NATIVE}")],
        )
        .unwrap();
        assert_eq!(resolve_from_conn(&conn, "mirror").unwrap(), None);
        assert_eq!(resolve_from_conn(&conn, "missing").unwrap(), None);
    }
}
