//! History APIs never reconstruct or admit an operational AgentOrgRun.
use crate::coordination::agent_org_history_store::{self, HistoryDescriptor, HistoryPage};

#[tauri::command]
pub async fn agent_org_history_descriptor(
    session_id: String,
) -> Result<Option<HistoryDescriptor>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        agent_org_history_store::descriptor(&conn, &session_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_org_history_page(
    session_id: String,
    cursor: Option<String>,
    limit: usize,
) -> Result<HistoryPage, String> {
    tokio::task::spawn_blocking(move || {
        let conn = database::db::get_connection().map_err(|e| e.to_string())?;
        agent_org_history_store::page(&conn, &session_id, cursor.as_deref(), limit)
    })
    .await
    .map_err(|e| e.to_string())?
}
