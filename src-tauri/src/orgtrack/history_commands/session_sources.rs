//! `session_source_messages`: every user message of one session, reduced to
//! what the workstation trail's Sources list reads (reference lines and
//! lazily loadable image refs).
//!
//! The frontend event store only keeps previews of turns that are not on
//! screen, so the list is read from each session's own history store:
//! provider transcripts for Codex and Claude Code (ORG2-run or imported), the
//! replayed chunk stream for other imported sources and legacy CLI runs, and
//! the event cache for ORG2's own sessions. Nothing is cached here.

use orgtrack_core::sources::imported_history::user_sources::{
    user_source_messages_from_chunks, UserSourceMessage,
};

use super::projection::open_cache_conn;
use super::*;

/// `CLI_SESSION_PREFIX` in `src/util/session/sessionDispatch.ts`.
const CLI_SESSION_PREFIX: &str = "cliagent-";

#[tauri::command]
pub async fn session_source_messages(session_id: String) -> Result<Vec<UserSourceMessage>, String> {
    if session_id.is_empty() || session_id.len() > 512 {
        return Err("Invalid session id".into());
    }
    tokio::task::spawn_blocking(move || load_session_source_messages(&session_id))
        .await
        .map_err(|err| format!("Read session sources: {err}"))?
}

fn load_session_source_messages(session_id: &str) -> Result<Vec<UserSourceMessage>, String> {
    if let Some((provider, path)) =
        crate::agent_sessions::cli::commands::native_history_path(session_id)?
    {
        return match provider.as_str() {
            "codex" => codex_app::load_codex_user_source_messages_from_path(session_id, &path),
            "claude_code" => claude_code_history::load_claude_code_user_source_messages_from_path(
                session_id, &path,
            ),
            _ => Err(format!("Unsupported native history provider: {provider}")),
        };
    }
    if let Some(file_stem) = session_id.strip_prefix(orgtrack_core::sources::codex::SESSION_PREFIX)
    {
        let conn = open_cache_conn()?;
        let path = codex_app::resolve_codex_session_path(&conn, file_stem)?;
        return codex_app::load_codex_user_source_messages_from_path(session_id, &path);
    }
    if let Some(file_stem) =
        session_id.strip_prefix(orgtrack_core::sources::claude_code::SESSION_PREFIX)
    {
        let conn = open_cache_conn()?;
        let path = claude_code_history::resolve_claude_session_path(&conn, file_stem)?;
        return claude_code_history::load_claude_code_user_source_messages_from_path(
            session_id, &path,
        );
    }
    let conn = open_cache_conn()?;
    if let Some(chunks) = imported_history::load_activity_chunks_for_session(&conn, session_id)? {
        return Ok(user_source_messages_from_chunks(&chunks));
    }
    drop(conn);
    if session_id.starts_with(CLI_SESSION_PREFIX) {
        let chunks = crate::agent_sessions::cli::commands::load_session_chunks(session_id)?;
        return Ok(user_source_messages_from_chunks(&chunks));
    }
    let stored = session_persistence::load_stored_user_messages(session_id)
        .map_err(|err| format!("Read session user messages: {err}"))?;
    Ok(stored
        .into_iter()
        .filter_map(|message| UserSourceMessage::new(message.id, &message.text, message.images))
        .collect())
}
