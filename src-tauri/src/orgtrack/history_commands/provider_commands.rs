use super::*;

use super::projection::{
    imported_transcript_signature, imported_transcript_signature_for_cached, open_cache_conn,
    remember_imported_turn_projection, ProjectionQuality, CODEX_INITIAL_RECENT_TURN_COUNT,
};

use super::scan::imported_recent_paths;

#[tauri::command]
pub async fn codex_app_chunks(
    session_id: String,
) -> Result<Vec<core_types::activity::ActivityChunk>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        let signature_before = imported_transcript_signature(&conn, &session_id)?;
        let chunks = codex_app::load_codex_app_for_session(&conn, &session_id)?;
        let projected = orgtrack_core::projectors::turn_metadata::project_activity_chunks(&chunks);
        let signature_after = imported_transcript_signature(&conn, &session_id)?;
        remember_imported_turn_projection(
            &session_id,
            signature_before,
            signature_after,
            ProjectionQuality::Full,
            projected,
        );
        Ok(chunks)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn codex_app_initial_window(
    session_id: String,
) -> Result<codex_app::CodexAppInitialWindow, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        let signature_before = imported_transcript_signature(&conn, &session_id)?;
        let window = codex_app::load_codex_app_initial_window_for_session(
            &conn,
            &session_id,
            CODEX_INITIAL_RECENT_TURN_COUNT,
        )?;
        let signature_after = imported_transcript_signature(&conn, &session_id)?;
        // Catalog-derived rows (previews + line counts, no body parse):
        // pre-warm only — must not displace a Full projection.
        remember_imported_turn_projection(
            &session_id,
            signature_before,
            signature_after,
            ProjectionQuality::Reduced,
            window.turns.clone(),
        );
        Ok(window)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

pub async fn codex_app_mobile_tail_window(
    session_id: String,
) -> Result<codex_app::CodexAppInitialWindow, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        codex_app::load_codex_app_mobile_tail_window_for_session(&conn, &session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn codex_app_turn_window(
    session_id: String,
    turn_id: String,
) -> Result<codex_app::CodexAppTurnWindow, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        codex_app::load_codex_app_turn_for_session(&conn, &session_id, &turn_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn codex_app_recent_paths(
    limit: Option<usize>,
) -> Result<Vec<codex_app::CodexAppRecentPath>, String> {
    let limit = limit.unwrap_or(20);
    tokio::task::spawn_blocking(move || {
        let mut conn = open_cache_conn()?;
        codex_app::list_codex_app_recent_paths(&mut conn, limit)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn external_cli_sources_detect() -> Result<Vec<ExternalCliSourceProbe>, String> {
    tokio::task::spawn_blocking(external_cli_detection::detect_sources)
        .await
        .map_err(|err| format!("Task join error: {err}"))
}

#[tauri::command]
pub async fn external_cli_source_probe(
    source_id: String,
) -> Result<Option<ExternalCliSourceProbe>, String> {
    tokio::task::spawn_blocking(move || external_cli_detection::probe_source_id(&source_id))
        .await
        .map_err(|err| format!("Task join error: {err}"))
}

#[tauri::command]
pub async fn external_history_auto_import_recent_paths(
    limit: Option<usize>,
) -> Result<Vec<git::repos::repo_db::RepoRecord>, String> {
    let limit = imported_history::effective_limit(limit.unwrap_or(20));
    let paths = tokio::task::spawn_blocking(imported_recent_paths)
        .await
        .map_err(|err| format!("Task join error: {err}"))??;

    let mut imported = Vec::new();
    for recent_path in paths.into_iter().take(limit) {
        if !Path::new(&recent_path.path).is_dir() {
            continue;
        }
        imported.push(git::repos::repo_service::import_auto(recent_path.path, None).await?);
    }

    Ok(imported)
}

#[tauri::command]
pub async fn claude_code_history_chunks(
    session_id: String,
) -> Result<Vec<core_types::activity::ActivityChunk>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        claude_code_history::load_claude_code_history_for_session(&conn, &session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Freshness snapshot of one imported transcript's source file.
///
/// `(mtime_ms, size_bytes)` is the change-detection signature and is compared
/// for equality only. For shared-SQLite session-local sources the second
/// component is a fold/hash, not bytes — `store_size_bytes` carries the real
/// on-disk footprint for size-tiered reload cooldowns there; `None` means
/// `size_bytes` already is a real byte count.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTranscriptStat {
    pub mtime_ms: i64,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_size_bytes: Option<u64>,
}

/// Cheap freshness probe for the replay auto-refresh: returns the transcript
/// file's `(mtime, size)` so the frontend can skip the full
/// read → parse → merge pipeline when nothing changed. `None` when the
/// source file is missing.
#[tauri::command]
pub async fn claude_code_history_stat(
    session_id: String,
) -> Result<Option<ImportedTranscriptStat>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        Ok(
            claude_code_history::stat_claude_code_history_for_session(&conn, &session_id)?.map(
                |(mtime_ms, size_bytes)| ImportedTranscriptStat {
                    mtime_ms,
                    size_bytes,
                    store_size_bytes: None,
                },
            ),
        )
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Source-agnostic freshness probe for replay auto-refresh. Shared SQLite
/// providers use a session-local row signature so writes to another session
/// do not trigger a full parse of the open replay. File-backed providers use
/// the transcript file signature (including SQLite sidecars where applicable).
#[tauri::command]
pub async fn imported_history_stat(
    source_id: String,
    session_id: String,
) -> Result<Option<ImportedTranscriptStat>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        let Some((cached_source, cached)) =
            imported_history::cache::query_cached_session_by_session_id_including_superseded_from_conn(
                &conn,
                &session_id,
            )?
        else {
            return Ok(None);
        };
        if cached_source != source_id {
            return Err(format!(
                "Imported history source mismatch for {session_id}: expected {cached_source}, got {source_id}"
            ));
        }

        let signature = imported_transcript_signature_for_cached(
            &conn,
            &source_id,
            &cached,
            &session_id,
        )?;
        // Session-local signatures use a fold/hash as their second component;
        // give the cooldown tiering the store's real on-disk footprint.
        let store_size_bytes = match source_id.as_str() {
            imported_history::metadata::SOURCE_OPENCODE
            | imported_history::metadata::SOURCE_ZCODE
            | imported_history::metadata::SOURCE_MIMO_CODE
            | imported_history::metadata::SOURCE_WINDSURF
            | imported_history::metadata::SOURCE_CURSOR_IDE => {
                imported_history::paths::sqlite_store_size_bytes(Path::new(&cached.source_path))
            }
            _ => None,
        };
        Ok(signature.map(|(mtime_ms, size_bytes)| ImportedTranscriptStat {
            mtime_ms,
            size_bytes,
            store_size_bytes,
        }))
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn claude_code_recent_paths(
    limit: Option<usize>,
) -> Result<Vec<claude_code_history::ClaudeCodeRecentPath>, String> {
    let limit = limit.unwrap_or(20);
    tokio::task::spawn_blocking(move || {
        let mut conn = open_cache_conn()?;
        claude_code_history::list_claude_code_recent_paths(&mut conn, limit)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn copilot_history_chunks(
    session_id: String,
) -> Result<Vec<core_types::activity::ActivityChunk>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        copilot_history::load_copilot_history_for_session(&conn, &session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn cursor_cli_history_chunks(
    session_id: String,
) -> Result<Vec<core_types::activity::ActivityChunk>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        cursor_cli_history::load_cursor_cli_history_for_session(&conn, &session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Internal terminal-barrier probe used before advertising a managed Cursor
/// CLI turn as replayable to remote clients.
pub async fn cursor_cli_history_is_readable(session_id: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        cursor_cli_history::cursor_cli_history_is_readable_for_session(&conn, &session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn cursor_cli_recent_paths(
    limit: Option<usize>,
) -> Result<Vec<cursor_cli_history::CursorCliRecentPath>, String> {
    let limit = limit.unwrap_or(20);
    tokio::task::spawn_blocking(move || {
        let mut conn = open_cache_conn()?;
        cursor_cli_history::list_cursor_cli_recent_paths(&mut conn, limit)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn codex_app_context_usage(
    session_id: String,
) -> Result<Option<imported_history::context_usage::ImportedContextUsage>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        codex_app::load_codex_context_usage_for_session(&conn, &session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

#[tauri::command]
pub async fn claude_code_context_usage(
    session_id: String,
) -> Result<Option<imported_history::context_usage::ImportedContextUsage>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = open_cache_conn()?;
        claude_code_history::load_claude_context_usage_for_session(&conn, &session_id)
    })
    .await
    .map_err(|err| format!("Task join error: {err}"))?
}

/// Local, demand-driven attachment read. Never accepts an arbitrary source path.
#[tauri::command]
pub async fn session_history_image(
    session_id: String,
    turn_id: String,
    original_ref: String,
) -> Result<Option<String>, String> {
    if session_id.len() > 512 || turn_id.len() > 128 || original_ref.len() > 2048 {
        return Err("Invalid history image reference".into());
    }
    static IMAGE_READS: OnceLock<std::sync::Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let permit = IMAGE_READS
        .get_or_init(|| std::sync::Arc::new(tokio::sync::Semaphore::new(2)))
        .clone()
        .acquire_owned()
        .await
        .map_err(|err| format!("Image reader closed: {err}"))?;
    tokio::task::spawn_blocking(move || {
        // Keep the permit with the actual blocking read even if its caller exits.
        let _permit = permit;
        let (provider, path) = if let Some(native) =
            crate::agent_sessions::cli::commands::native_history_path(&session_id)?
        {
            native
        } else if let Some(native_id) =
            session_id.strip_prefix(orgtrack_core::sources::codex::SESSION_PREFIX)
        {
            let conn = open_cache_conn()?;
            (
                "codex".to_string(),
                codex_app::resolve_codex_session_path(&conn, native_id)?,
            )
        } else if let Some(file_stem) =
            session_id.strip_prefix(orgtrack_core::sources::claude_code::SESSION_PREFIX)
        {
            let conn = open_cache_conn()?;
            (
                "claude_code".to_string(),
                claude_code_history::resolve_claude_session_path(&conn, file_stem)?,
            )
        } else {
            return Err("Unsupported history image session".into());
        };
        match provider.as_str() {
            "codex" => codex_app::load_codex_image_from_path(&path, &turn_id, &original_ref),
            "claude_code" => claude_code_history::load_claude_code_image_from_path(
                &path,
                &turn_id,
                &original_ref,
            ),
            _ => Err("Unsupported history image provider".into()),
        }
    })
    .await
    .map_err(|err| format!("Read history image: {err}"))?
}
