use super::{codex_app, projection::open_cache_conn};

/// Explicit provider-owned PR attachments of this conversation. No text mining.
#[tauri::command]
pub async fn session_pull_requests(session_id: String) -> Result<Vec<String>, String> {
    if session_id.is_empty() || session_id.len() > 512 {
        return Err("Invalid session id".into());
    }
    tokio::task::spawn_blocking(move || {
        if let Some((provider, path)) =
            crate::agent_sessions::cli::commands::native_history_path(&session_id)?
        {
            return if provider == "codex" {
                codex_app::load_codex_pull_requests_from_path(&path)
            } else {
                Ok(Vec::new())
            };
        }
        if let Some(stem) = session_id.strip_prefix(orgtrack_core::sources::codex::SESSION_PREFIX) {
            let conn = open_cache_conn()?;
            let path = codex_app::resolve_codex_session_path(&conn, stem)?;
            return codex_app::load_codex_pull_requests_from_path(&path);
        }
        Ok(Vec::new())
    })
    .await
    .map_err(|err| format!("Read conversation pull requests: {err}"))?
}
