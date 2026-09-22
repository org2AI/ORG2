//! Interaction RPC adapters — permission/question/plan responses.

use agent_core::interaction::permission::PermissionResponse;
use serde_json::{json, Value};
use tauri::Manager;

use crate::api::mobile_bridge::rpc::{RpcError, RpcErrorCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RespondPermissionParams {
    pub session_id: String,
    pub request_id: String,
    pub response: PermissionResponse,
    pub origin: String,
    pub tool_name: Option<String>,
    pub tool_args: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MobilePermissionExecution {
    NativeAgent,
    ManagedCli,
}

fn permission_execution(origin: &str) -> Option<MobilePermissionExecution> {
    match origin {
        "rust_agent" => Some(MobilePermissionExecution::NativeAgent),
        "cli_hook" | "acp" => Some(MobilePermissionExecution::ManagedCli),
        _ => None,
    }
}

fn cli_permission_decision(response: PermissionResponse) -> (bool, bool) {
    match response {
        PermissionResponse::Allow => (true, false),
        PermissionResponse::Deny => (false, false),
        PermissionResponse::AlwaysAllow => (true, true),
    }
}

/// Validate `interaction/respond_permission` params without touching desktop state.
pub fn parse_respond_permission_params(
    params: &Value,
) -> Result<RespondPermissionParams, RpcError> {
    let session_id = params
        .get("sessionId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RpcError::invalid_params("sessionId is required"))?
        .to_string();

    let request_id = params
        .get("requestId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RpcError::invalid_params("requestId is required"))?
        .to_string();

    let response_raw = params
        .get("response")
        .and_then(|value| value.as_str())
        .ok_or_else(|| RpcError::invalid_params("response is required"))?;
    let response = PermissionResponse::from_wire(response_raw).ok_or_else(|| {
        RpcError::invalid_params(format!(
            "response must be one of: {}, {}, {}",
            PermissionResponse::ALLOW_STR,
            PermissionResponse::DENY_STR,
            PermissionResponse::ALWAYS_ALLOW_STR
        ))
    })?;

    let origin = params
        .get("origin")
        .and_then(|value| value.as_str())
        .unwrap_or("rust_agent")
        .to_string();

    let tool_name = params
        .get("toolName")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let tool_args = params.get("toolArgs").cloned();

    Ok(RespondPermissionParams {
        session_id,
        request_id,
        response,
        origin,
        tool_name,
        tool_args,
    })
}

/// Route a permission decision back to the runtime that created the prompt.
pub async fn respond_permission(params: &Value) -> Result<Value, RpcError> {
    let parsed = parse_respond_permission_params(params)?;

    let execution = permission_execution(&parsed.origin).ok_or_else(|| {
        RpcError::new(
            RpcErrorCode::InvalidParams,
            format!("unknown permission origin: {:?}", parsed.origin),
        )
    })?;

    match execution {
        MobilePermissionExecution::NativeAgent => {
            let handle = crate::api::get_app_handle().ok_or_else(|| {
                RpcError::new(RpcErrorCode::InvalidRequest, "desktop agent not ready")
            })?;
            let state = handle.state::<agent_core::state::AgentAppState>();

            let session = state.get_session(&parsed.session_id).await.ok_or_else(|| {
                RpcError::new(
                    RpcErrorCode::SessionNotFound,
                    format!("session not found: {}", parsed.session_id),
                )
            })?;

            let accepted = session
                .permission_manager
                .respond_for_session(&parsed.session_id, &parsed.request_id, parsed.response)
                .await;
            if !accepted {
                return Err(RpcError::new(
                    RpcErrorCode::InvalidRequest,
                    "permission request is no longer pending",
                ));
            }
        }
        MobilePermissionExecution::ManagedCli => {
            let (approved, always_allow) = cli_permission_decision(parsed.response);
            crate::agent_sessions::cli::commands::cli_agent_approval_response(
                parsed.session_id.clone(),
                approved,
                Some(always_allow),
                Some(parsed.request_id.clone()),
            )
            .await
            .map_err(|err| RpcError::new(RpcErrorCode::InvalidRequest, err))?;
        }
    }

    Ok(json!({
        "accepted": true,
        "sessionId": parsed.session_id,
        "requestId": parsed.request_id,
    }))
}

pub fn respond_question(_params: &Value) -> Result<Value, RpcError> {
    Err(RpcError::method_not_found("interaction/respond_question"))
}

pub fn respond_plan_approval(_params: &Value) -> Result<Value, RpcError> {
    Err(RpcError::method_not_found(
        "interaction/respond_plan_approval",
    ))
}

pub async fn pending(params: &Value) -> Result<Value, RpcError> {
    let session_id = params
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| RpcError::invalid_params("sessionId is required"))?;
    let handle = crate::api::get_app_handle()
        .ok_or_else(|| RpcError::new(RpcErrorCode::InvalidRequest, "desktop agent not ready"))?;
    let state = handle.state::<agent_core::state::AgentAppState>();
    let mut interactions = match state.get_session(session_id).await {
        Some(session) => {
            session
                .permission_manager
                .pending_snapshot(PENDING_LIMIT + 1)
                .await
        }
        None => Vec::new(), // CLI sessions are owned by their own registries.
    };
    append_cli_pending(&mut interactions, Some(session_id))?;
    Ok(enriched_snapshot_result(interactions).await)
}

const PENDING_LIMIT: usize = 2000;

fn append_cli_pending(rows: &mut Vec<Value>, session_id: Option<&str>) -> Result<(), RpcError> {
    // Each owner bounds its projection; scoped snapshots filter at the owner,
    // rather than losing a selected session behind an unrelated global cap.
    for snapshot in [
        crate::agent_sessions::cli::hook_approvals::pending_snapshot_for_session(
            session_id,
            PENDING_LIMIT + 1,
        ),
        crate::agent_sessions::cli::parsers::acp_common::pending_snapshot_for_session(
            session_id,
            PENDING_LIMIT + 1,
        ),
    ] {
        rows.extend(snapshot.map_err(|err| RpcError::new(RpcErrorCode::InvalidRequest, err))?);
    }
    Ok(())
}

fn snapshot_result(mut interactions: Vec<Value>) -> Value {
    let mut complete = interactions.len() <= PENDING_LIMIT;
    interactions.sort_by_key(|row| {
        (
            row["createdAtMs"].as_i64().unwrap_or(0),
            row["requestId"].as_str().unwrap_or("").to_string(),
        )
    });
    interactions.truncate(PENDING_LIMIT);
    // Reserve the response wrapper and JSON-RPC envelope as well as row commas.
    let mut bytes = 128;
    let mut bounded = Vec::new();
    for mut row in interactions {
        let (args, truncated) = super::session::mobile_tool_data(&row["toolArgs"]);
        // The mobile permission card consumes a field map. Preserve other
        // valid JSON inputs under `input` rather than emitting an invalid map.
        row["toolArgs"] = if args.is_object() {
            args
        } else {
            json!({"input": args})
        };
        row["toolArgsTruncated"] = json!(truncated || row["toolArgsTruncated"] == true);
        bytes += row.to_string().len() + 1;
        if bytes > 512 * 1024 {
            complete = false;
            break;
        }
        bounded.push(row);
    }
    json!({"interactions": bounded, "complete": complete})
}

fn read_session_names(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<std::collections::HashMap<String, String>, String> {
    use rusqlite::OptionalExtension;
    let mut statement = conn
        .prepare_cached(
            "SELECT substr(title, 1, 512) FROM orgtrack_core_sessions WHERE session_id = ?1",
        )
        .map_err(|err| err.to_string())?;
    let mut names = std::collections::HashMap::new();
    for id in ids.iter().take(PENDING_LIMIT) {
        let title: Option<String> = statement
            .query_row([id], |row| row.get(0))
            .optional()
            .map_err(|err| err.to_string())?;
        if let Some(title) = title.filter(|title| !title.trim().is_empty()) {
            names.insert(id.clone(), title);
        }
    }
    Ok(names)
}

async fn enriched_snapshot_result(interactions: Vec<Value>) -> Value {
    let mut result = snapshot_result(interactions);
    let complete = result["complete"] == true;
    let rows = result["interactions"]
        .as_array_mut()
        .expect("snapshot row array");
    let ids = rows
        .iter()
        .filter_map(|row| row["sessionId"].as_str().map(str::to_string))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if !ids.is_empty() {
        // Optional labels never gate the authoritative pending decisions. One
        // bounded indexed lookup batch; no history scan or render-thread I/O.
        let names = tokio::task::spawn_blocking(move || {
            let conn = database::db::get_connection().map_err(|err| err.to_string())?;
            read_session_names(&conn, &ids)
        })
        .await;
        if let Ok(Ok(names)) = names {
            for row in rows.iter_mut() {
                if let Some(name) = row["sessionId"].as_str().and_then(|id| names.get(id)) {
                    row["sessionName"] = json!(name);
                }
            }
        }
    }
    let mut enriched = snapshot_result(std::mem::take(rows));
    enriched["complete"] = json!(complete && enriched["complete"] == true);
    enriched
}

pub async fn pending_all(_params: &Value) -> Result<Value, RpcError> {
    let handle = crate::api::get_app_handle()
        .ok_or_else(|| RpcError::new(RpcErrorCode::InvalidRequest, "desktop agent not ready"))?;
    let state = handle.state::<agent_core::state::AgentAppState>();
    let sessions = state
        .sessions
        .lock()
        .await
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let mut interactions = Vec::new();
    for session in sessions {
        let remaining = (PENDING_LIMIT + 1).saturating_sub(interactions.len());
        if remaining == 0 {
            break;
        }
        interactions.extend(session.permission_manager.pending_snapshot(remaining).await);
    }
    append_cli_pending(&mut interactions, None)?;
    Ok(enriched_snapshot_result(interactions).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_session_labels_use_canonical_titles_without_loading_roster() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE orgtrack_core_sessions (session_id TEXT PRIMARY KEY, title TEXT); INSERT INTO orgtrack_core_sessions VALUES ('old-session', 'History beyond the first page')").unwrap();
        let names =
            read_session_names(&conn, &["old-session".into(), "missing-session".into()]).unwrap();
        assert_eq!(
            names.get("old-session").unwrap(),
            "History beyond the first page"
        );
        assert!(!names.contains_key("missing-session"));
        let row = snapshot_result(vec![
            json!({"toolArgs": ["one", "two"], "toolArgsTruncated": true}),
        ]);
        assert!(row["interactions"][0]["toolArgs"].is_object());
        assert_eq!(row["interactions"][0]["toolArgsTruncated"], true);
    }

    #[test]
    fn inbox_projection_is_bounded_and_never_claims_truncated_count_is_complete() {
        let rows = (0..PENDING_LIMIT + 1)
            .map(|index| {
                json!({
                    "requestId": format!("p-{index}"), "createdAtMs": index,
                    "toolArgs": {"description": "x".repeat(10000)},
                })
            })
            .collect();
        let result = snapshot_result(rows);
        assert_eq!(result["complete"], false);
        assert!(result.to_string().len() < 513 * 1024);
        assert!(result["interactions"].as_array().unwrap().len() < PENDING_LIMIT);
        assert_eq!(result["interactions"][0]["toolArgsTruncated"], true);
        assert_eq!(
            snapshot_result(vec![]),
            json!({"interactions": [], "complete": true})
        );
        let at_limit = (0..PENDING_LIMIT)
            .map(|index| json!({"requestId": index.to_string()}))
            .collect::<Vec<_>>();
        assert_eq!(snapshot_result(at_limit.clone())["complete"], true);
        let mut over_limit = at_limit;
        over_limit.push(json!({"requestId": "sentinel"}));
        assert_eq!(snapshot_result(over_limit)["complete"], false);
    }

    #[test]
    fn parse_respond_permission_params_requires_session_and_request_ids() {
        let err = parse_respond_permission_params(&json!({
            "response": "allow"
        }))
        .unwrap_err();
        assert_eq!(err.code, RpcErrorCode::InvalidParams);
    }

    #[test]
    fn parse_respond_permission_params_rejects_invalid_response() {
        let err = parse_respond_permission_params(&json!({
            "sessionId": "sde-1",
            "requestId": "perm-1",
            "response": "maybe"
        }))
        .unwrap_err();
        assert!(err.message.contains("response must be one of"));
    }

    #[test]
    fn parse_respond_permission_params_accepts_allow_deny_always_allow() {
        for response in ["allow", "deny", "always_allow"] {
            let parsed = parse_respond_permission_params(&json!({
                "sessionId": "sde-1",
                "requestId": "perm-1",
                "response": response,
                "toolName": "run_shell",
                "toolArgs": { "command": "pnpm test" }
            }))
            .expect(response);
            assert_eq!(parsed.session_id, "sde-1");
            assert_eq!(parsed.request_id, "perm-1");
            assert_eq!(parsed.origin, "rust_agent");
            assert_eq!(parsed.tool_name.as_deref(), Some("run_shell"));
        }
    }

    #[test]
    fn parse_respond_permission_params_honors_explicit_origin() {
        let parsed = parse_respond_permission_params(&json!({
            "sessionId": "sde-1",
            "requestId": "perm-1",
            "response": "allow",
            "origin": "cli_hook"
        }))
        .expect("params");
        assert_eq!(parsed.origin, "cli_hook");
    }

    #[test]
    fn permission_origin_routes_to_the_owning_runtime() {
        assert_eq!(
            permission_execution("rust_agent"),
            Some(MobilePermissionExecution::NativeAgent)
        );
        assert_eq!(
            permission_execution("cli_hook"),
            Some(MobilePermissionExecution::ManagedCli)
        );
        assert_eq!(
            permission_execution("acp"),
            Some(MobilePermissionExecution::ManagedCli)
        );
        assert_eq!(permission_execution("unknown"), None);
    }

    #[test]
    fn cli_permission_decision_preserves_allow_semantics() {
        assert_eq!(
            cli_permission_decision(PermissionResponse::Allow),
            (true, false)
        );
        assert_eq!(
            cli_permission_decision(PermissionResponse::Deny),
            (false, false)
        );
        assert_eq!(
            cli_permission_decision(PermissionResponse::AlwaysAllow),
            (true, true)
        );
    }
}
