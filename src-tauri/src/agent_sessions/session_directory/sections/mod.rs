//! Durable local sections shared by every sidebar session source.
mod store;
#[cfg(test)]
mod tests;

use super::conversion::{
    cli_session_to_aggregate_record, human_session_to_aggregate_record,
    imported_history_to_aggregate_record, os_session_to_aggregate_record,
    sde_session_to_aggregate_record, AgentMetadataResolver,
};
use super::types::SessionAggregateRecord;
use agent_core::session::persistence::{self, session_type};
use database::db::get_connection;
use orgtrack_core::sources::imported_history::cache;
use serde::Serialize;
use tauri::Emitter;

pub use store::{Mutation, Snapshot};

fn lookup(
    conn: &rusqlite::Connection,
    id: &str,
    pinned: &std::collections::HashSet<String>,
) -> Result<Option<SessionAggregateRecord>, String> {
    if let Some((source, record)) = cache::query_cached_session_by_session_id_from_conn(conn, id)? {
        if !record.listable {
            return Ok(None);
        }
        let mut row = imported_history_to_aggregate_record(record.to_row(), &source);
        if row.parent_session_id.is_some() {
            return Ok(None);
        }
        row.pinned = pinned.contains(&cache::imported_session_pin_identity(id));
        return Ok(Some(row));
    }
    if let Some(record) = persistence::get_session(id).map_err(|e| e.to_string())? {
        if record.parent_session_id.is_some() || record.status == "archived" {
            return Ok(None);
        }
        let mut resolver = AgentMetadataResolver::new();
        let row = match record.session_type.as_str() {
            session_type::CODING => Some(sde_session_to_aggregate_record(record, &mut resolver)),
            session_type::DESKTOP => Some(os_session_to_aggregate_record(record, &mut resolver)),
            session_type::HUMAN => Some(human_session_to_aggregate_record(record)),
            _ => None,
        };
        if let Some(mut row) = row {
            super::aggregation::annotate_agent_org_root_rows(std::slice::from_mut(&mut row))?;
            if row.org_member_id.is_some() && row.agent_org_id.is_none() {
                return Ok(None);
            }
            return Ok(Some(row));
        }
        return Ok(None);
    }
    Ok(crate::agent_sessions::cli::persistence::get_session(id)
        .map_err(|e| e.to_string())?
        .filter(|s| s.parent_session_id.is_none())
        .map(cli_session_to_aggregate_record))
}

#[tauri::command]
pub async fn sidebar_sections_list() -> Result<Snapshot, String> {
    tokio::task::spawn_blocking(|| {
        let conn = get_connection().map_err(|e| e.to_string())?;
        store::init(&conn)?;
        store::snapshot(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sidebar_sections_mutate(
    app: tauri::AppHandle,
    mutation: Mutation,
) -> Result<Snapshot, String> {
    let result = tokio::task::spawn_blocking(move || {
        let session_id = match &mutation {
            Mutation::Create { session_id, .. } => session_id.as_deref(),
            Mutation::Assign {
                session_id,
                section_id: Some(_),
            } => Some(session_id.as_str()),
            _ => None,
        };
        let mut conn = get_connection().map_err(|e| e.to_string())?;
        let pinned = std::collections::HashSet::new();
        if let Some(id) = session_id {
            if id.contains(":subagent:") || lookup(&conn, id, &pinned)?.is_none() {
                return Err("Only existing top-level sessions can belong to a section".into());
            }
        }
        store::init(&conn)?;
        store::mutate(&mut conn, mutation)
    })
    .await
    .map_err(|e| e.to_string())??;
    // Push invalidation across WebViews; no timer or history scan.
    let _ = app.emit("sidebar-sections-changed", ());
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    sessions: Vec<SessionAggregateRecord>,
    next_cursor: Option<String>,
    has_more: bool,
}

#[tauri::command]
pub async fn sidebar_section_page(
    id: String,
    after: Option<String>,
    limit: usize,
) -> Result<Page, String> {
    tokio::task::spawn_blocking(move || {
        let conn = get_connection().map_err(|e| e.to_string())?;
        store::init(&conn)?;
        let mut ids = store::page_ids(&conn, &id, after.as_deref(), limit)?;
        let has_more = ids.len() > limit;
        ids.truncate(limit);
        let next_cursor = ids.last().cloned();
        let mut sessions = Vec::with_capacity(ids.len());
        let pinned = cache::pinned_imported_session_ids_from_conn(&conn)?;
        for id in ids {
            if let Some(session) = lookup(&conn, &id, &pinned)? {
                sessions.push(session);
            }
        }
        Ok(Page {
            sessions,
            next_cursor,
            has_more,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
