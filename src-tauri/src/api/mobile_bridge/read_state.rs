//! Request/ack bridge to Desktop's existing visited-session owner. No second
//! persistent store, roster scan, or polling task lives in the transport.
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

use super::rpc::{RpcError, RpcErrorCode};

const MAX_IDS: usize = 200;
const MAX_PENDING: usize = 32;
const TIMEOUT: Duration = Duration::from_secs(5);

struct Pending {
    ids: Vec<String>,
    sender: oneshot::Sender<Vec<String>>,
}
fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
    PENDING.get_or_init(Mutex::default)
}
struct RequestGuard(String);
impl Drop for RequestGuard {
    fn drop(&mut self) {
        pending().lock().unwrap().remove(&self.0);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadRequest {
    request_id: String,
    session_ids: Vec<String>,
    mark_visited: bool,
    expires_at_ms: i64,
}

fn parse_ids(params: &Value) -> Result<Vec<String>, RpcError> {
    let ids: Vec<String> =
        serde_json::from_value(params.get("sessionIds").cloned().unwrap_or(Value::Null))
            .map_err(|_| RpcError::invalid_params("sessionIds must be an array"))?;
    if ids.is_empty()
        || ids.len() > MAX_IDS
        || ids.iter().any(|id| id.trim().is_empty() || id.len() > 1024)
    {
        return Err(RpcError::invalid_params(
            "sessionIds must contain 1–200 nonempty IDs, at most 1024 bytes each",
        ));
    }
    let mut unique = Vec::with_capacity(ids.len());
    for id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    Ok(unique)
}

pub async fn request(params: &Value, mark_visited: bool) -> Result<Value, RpcError> {
    let ids = parse_ids(params)?;
    let handle = crate::api::get_app_handle().ok_or_else(unavailable)?;
    let window = handle.get_webview_window("main").ok_or_else(unavailable)?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    {
        let mut requests = pending().lock().unwrap();
        if requests.len() >= MAX_PENDING {
            return Err(unavailable());
        }
        requests.insert(
            request_id.clone(),
            Pending {
                ids: ids.clone(),
                sender,
            },
        );
    }
    // Drop removes the waiter on timeout, emission failure AND task cancellation.
    let _guard = RequestGuard(request_id.clone());
    window
        .emit(
            "mobile-session-read-request",
            ReadRequest {
                request_id,
                session_ids: ids,
                mark_visited,
                expires_at_ms: chrono::Utc::now().timestamp_millis() + TIMEOUT.as_millis() as i64,
            },
        )
        .map_err(|_| unavailable())?;
    let visited_ids = tokio::time::timeout(TIMEOUT, receiver)
        .await
        .map_err(|_| unavailable())?
        .map_err(|_| unavailable())?;
    Ok(json!({ "visitedIds": visited_ids }))
}

fn unavailable() -> RpcError {
    RpcError::new(
        RpcErrorCode::InvalidRequest,
        "desktop read-state owner is unavailable; retry after reconnecting",
    )
}

fn complete(request_id: &str, visited_ids: Vec<String>) -> Result<(), String> {
    let mut requests = pending().lock().unwrap();
    let request = requests
        .get(request_id)
        .ok_or("read-state request expired")?;
    if visited_ids.len() > request.ids.len()
        || visited_ids.iter().any(|id| !request.ids.contains(id))
    {
        return Err("read-state reply contains unrequested IDs".into());
    }
    let request = requests
        .remove(request_id)
        .ok_or("read-state request expired")?;
    let _ = request.sender.send(visited_ids);
    Ok(())
}

#[tauri::command]
pub fn mobile_remote_reply_read_state(
    window: tauri::WebviewWindow,
    request_id: String,
    visited_ids: Vec<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only the desktop owner can reply".into());
    }
    complete(&request_id, visited_ids)
}

#[tauri::command]
pub fn mobile_remote_read_state_changed(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only the desktop owner can publish".into());
    }
    super::fanout::fanout_all(
        &json!({
            "jsonrpc": "2.0", "method": "session/read_state_changed", "params": {}
        })
        .to_string(),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_and_deduplicates_at_rpc_ingestion() {
        assert_eq!(
            parse_ids(&json!({"sessionIds":["a","a","b"]})).unwrap(),
            vec!["a", "b"]
        );
        for ids in [
            json!([]),
            json!([""]),
            json!([1]),
            json!(["x".repeat(1025)]),
            json!(vec!["a"; 201]),
        ] {
            assert!(parse_ids(&json!({"sessionIds":ids})).is_err());
        }
    }
    #[tokio::test]
    async fn ack_is_scoped_and_waiter_is_released() {
        let key = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        pending().lock().unwrap().insert(
            key.clone(),
            Pending {
                ids: vec!["a".into()],
                sender,
            },
        );
        assert!(complete(&key, vec!["other".into()]).is_err());
        complete(&key, vec!["a".into()]).unwrap();
        assert_eq!(receiver.await.unwrap(), vec!["a"]);
        assert!(complete(&key, vec![]).is_err());
        let (sender, _receiver) = oneshot::channel();
        pending().lock().unwrap().insert(
            key.clone(),
            Pending {
                ids: vec![],
                sender,
            },
        );
        drop(RequestGuard(key.clone()));
        assert!(!pending().lock().unwrap().contains_key(&key));
    }
}
