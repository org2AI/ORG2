//! Snapshot Commands
//!
//! Get full derived snapshot or raw events from a per-session store.

use core_types::session_event::EventSource;
use tauri::State;

use crate::agent_sessions::event_pipeline::derived::compute_derived;
use crate::agent_sessions::event_pipeline::types::{DerivedSnapshot, SessionEvent};

use super::EventStoreState;

/// Get the full derived snapshot for a session.
#[tauri::command]
pub async fn es_get_snapshot(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
) -> Result<DerivedSnapshot, String> {
    let sid = state.resolve_session_id(session_id)?;
    Ok(state
        .with_store_opt(&sid, |store| {
            compute_derived(store.events(), store.version())
        })
        .unwrap_or_else(|| compute_derived(&[], 0)))
}

/// Get raw events for a session.
#[tauri::command]
pub async fn es_get_events(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
) -> Result<Vec<SessionEvent>, String> {
    let sid = state.resolve_session_id(session_id)?;
    Ok(state
        .with_store_opt(&sid, |store| store.events().to_vec())
        .unwrap_or_default())
}

/// Serialize conversation messages. Managed CLI history is read from its
/// authoritative source, never from the partial mounted Chat window.
/// An output path avoids transferring the complete Markdown through the WebView;
/// callers omitting it retain the original string-returning IPC contract.
#[tauri::command]
pub async fn es_export_markdown(
    state: State<'_, EventStoreState>,
    session_id: Option<String>,
    output_path: Option<String>,
) -> Result<String, String> {
    let sid = state.resolve_session_id(session_id)?;
    let cached = if sid.starts_with("cliagent-") {
        Vec::new()
    } else {
        state
            .with_store_opt(&sid, |store| store.events().to_vec())
            .unwrap_or_default()
    };
    tokio::task::spawn_blocking(move || export_markdown_output(&sid, cached, output_path))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn export_markdown_output(
    sid: &str,
    cached: Vec<SessionEvent>,
    output_path: Option<String>,
) -> Result<String, String> {
    if let Some(path) = output_path {
        let path = std::path::Path::new(&path);
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .ok_or_else(|| "Export requires an absolute destination path".to_string())?;
        if !path.is_absolute() {
            return Err("Export requires an absolute destination path".to_string());
        }
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        {
            use std::io::Write;
            let mut writer = std::io::BufWriter::new(temporary.as_file_mut());
            export_session_markdown(sid, cached, &mut writer)?;
            writer.flush().map_err(|e| e.to_string())?;
        }
        temporary.persist(path).map_err(|e| e.to_string())?;
        Ok(String::new())
    } else {
        let mut bytes = Vec::new();
        export_session_markdown(sid, cached, &mut bytes)?;
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }
}

pub(crate) fn export_session_markdown(
    session_id: &str,
    cached: Vec<SessionEvent>,
    writer: &mut impl std::io::Write,
) -> Result<(), String> {
    if session_id.starts_with("cliagent-") {
        crate::agent_sessions::cli::commands::visit_cli_history(session_id, &mut |events| {
            write_markdown_events(&events, writer)
        })
    } else {
        write_markdown_events(&cached, writer)
    }
}

fn write_markdown_events(
    events: &[SessionEvent],
    writer: &mut impl std::io::Write,
) -> Result<(), String> {
    for event in events {
        let text = event.display_text.trim();
        if text.is_empty() {
            continue;
        }
        let role = match event.source {
            EventSource::User => "User",
            EventSource::Assistant if event.ui_canonical == "agent_message" => "Assistant",
            _ => continue,
        };
        write!(writer, "**{role}**\n\n{text}\n\n---\n\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Activity-only ranking probe. Never creates an EventStore or a derived snapshot.
#[tauri::command]
pub async fn es_get_chat_activity(
    state: State<'_, EventStoreState>,
    session_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, bool>, String> {
    use crate::agent_sessions::event_pipeline::derived::is_visible_in_chat;
    if session_ids.len() > 64 {
        return Err("At most 64 activity probes per request".into());
    }
    let mut activity = std::collections::HashMap::new();
    let mut unloaded = Vec::new();
    for sid in session_ids {
        if activity.contains_key(&sid) {
            continue;
        }
        let has_activity = state
            .with_store_opt(&sid, |store| store.events().iter().any(is_visible_in_chat))
            .unwrap_or(false);
        activity.insert(sid.clone(), has_activity);
        if !has_activity {
            unloaded.push(sid);
        }
    }
    tokio::task::spawn_blocking(move || {
        for sid in unloaded {
            let found = session_persistence::any_event_matching(&sid, |cached| {
                is_visible_in_chat(&super::event_conversion::cached_event_to_session_event(
                    cached,
                ))
            })
            .map_err(|error| error.to_string())?;
            activity.insert(sid, found);
        }
        Ok(activity)
    })
    .await
    .map_err(|error| error.to_string())?
}
