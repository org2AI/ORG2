//! Session model config and catalog RPC adapters for Mobile Remote.

use serde_json::{json, Value};
use std::collections::HashSet;
use tauri::Manager;

use crate::agent_sessions::cli::persistence as cli_persistence;
use crate::agent_sessions::session_directory::patch::{patch_session, SessionPatch};
use agent_core::session::persistence as session_persistence;
use key_vault::commands::registry::is_cli_provider_compatible;
use key_vault::commands::{key_info_from_entry, KeyInfo};
use key_vault::key_store::KEY_SERVICE;

use super::session::mobile_session_execution;
use super::session::MobileSessionExecution;
use crate::api::mobile_bridge::rpc::{RpcError, RpcErrorCode};

const MAX_MOBILE_MODEL_OPTIONS: usize = 256;

#[derive(Debug, Clone)]
struct MobileSessionModelState {
    model: Option<String>,
    account_id: Option<String>,
    key_source: String,
    cli_agent_type: Option<String>,
    model_editable: bool,
}

#[derive(Debug, Clone)]
struct MobileModelOption {
    id: String,
    account_id: String,
    account_label: String,
}

fn parse_session_id(params: &Value) -> Result<String, RpcError> {
    params
        .get("sessionId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| RpcError::invalid_params("sessionId is required"))
}

fn load_session_model_state(session_id: &str) -> Result<MobileSessionModelState, RpcError> {
    match mobile_session_execution(session_id) {
        MobileSessionExecution::ImportedHistory => Ok(MobileSessionModelState {
            model: None,
            account_id: None,
            key_source: "own_key".to_string(),
            cli_agent_type: None,
            model_editable: false,
        }),
        MobileSessionExecution::ManagedCli => {
            let session = cli_persistence::get_session(session_id)
                .map_err(|err| RpcError::new(RpcErrorCode::InvalidRequest, err.to_string()))?
                .ok_or_else(|| {
                    RpcError::new(
                        RpcErrorCode::SessionNotFound,
                        format!("session not found: {session_id}"),
                    )
                })?;
            Ok(MobileSessionModelState {
                model: session.model,
                account_id: session.account_id,
                key_source: session.key_source.as_ref().to_string(),
                cli_agent_type: session.cli_agent_type,
                model_editable: true,
            })
        }
        MobileSessionExecution::NativeAgent => {
            let session = session_persistence::get_session(session_id)
                .map_err(|err| RpcError::new(RpcErrorCode::InvalidRequest, err.to_string()))?
                .ok_or_else(|| {
                    RpcError::new(
                        RpcErrorCode::SessionNotFound,
                        format!("session not found: {session_id}"),
                    )
                })?;
            Ok(MobileSessionModelState {
                model: session.model,
                account_id: session.account_id,
                key_source: session.key_source.as_ref().to_string(),
                cli_agent_type: session.native_harness_type,
                model_editable: true,
            })
        }
    }
}

fn key_is_usable(entry: &KeyInfo) -> bool {
    entry.enabled
        && matches!(
            entry.health_status.as_str(),
            "valid" | "degraded" | "unknown"
        )
}

fn account_label_for(entry: &KeyInfo) -> String {
    entry
        .name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| entry.agent_type.clone())
}

fn supports_session(
    entry: &KeyInfo,
    execution: MobileSessionExecution,
    state: &MobileSessionModelState,
) -> bool {
    match execution {
        MobileSessionExecution::ManagedCli => {
            state.cli_agent_type.as_deref().is_some_and(|agent| {
                if agent == entry.agent_type {
                    entry.can_launch_cli
                } else {
                    entry.has_api_key && is_cli_provider_compatible(agent, &entry.agent_type)
                }
            })
        }
        MobileSessionExecution::NativeAgent => entry.supports_rust_agents,
        MobileSessionExecution::ImportedHistory => false,
    }
}

/// A bounded projection of the same account inventory/enablement used on desktop.
/// The current value is retained for presentation, even when no longer selectable.
fn collect_model_options(
    keys: &[KeyInfo],
    execution: MobileSessionExecution,
    state: &MobileSessionModelState,
) -> Vec<MobileModelOption> {
    let mut options = Vec::new();
    let mut seen = HashSet::new();

    // Reserve the current selection before filling the bounded catalog so it
    // cannot create a 257th row that the mobile wire validator would reject.
    if let Some(current_model) = state.model.as_deref() {
        let current_account = state.account_id.as_deref().unwrap_or("");
        seen.insert((current_account.to_string(), current_model.to_string()));
        options.push(MobileModelOption {
            id: current_model.to_string(),
            account_id: current_account.to_string(),
            account_label: keys
                .iter()
                .find(|entry| entry.id == current_account)
                .map(account_label_for)
                .unwrap_or_else(|| "Current".to_string()),
        });
    }

    for entry in keys
        .iter()
        .filter(|entry| key_is_usable(entry) && supports_session(entry, execution, state))
    {
        let account_label = account_label_for(entry);
        for model_id in entry.selectable_model_ids() {
            if options.len() >= MAX_MOBILE_MODEL_OPTIONS {
                return options;
            }
            if !seen.insert((entry.id.clone(), model_id.clone())) {
                continue;
            }
            options.push(MobileModelOption {
                id: model_id,
                account_id: entry.id.clone(),
                account_label: account_label.clone(),
            });
        }
    }
    options
}

fn collect_model_options_for_session(
    session_id: &str,
    state: &MobileSessionModelState,
) -> Result<Vec<MobileModelOption>, RpcError> {
    let keys = KEY_SERVICE
        .list_keys_checked()
        .and_then(|keys| {
            keys.into_iter()
                .map(key_info_from_entry)
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|err| RpcError::new(RpcErrorCode::InvalidRequest, err))?;
    Ok(collect_model_options(
        &keys,
        mobile_session_execution(session_id),
        state,
    ))
}

/// Return the session's current model configuration for the mobile picker.
pub async fn session_config(params: &Value) -> Result<Value, RpcError> {
    let session_id = parse_session_id(params)?;
    let state = load_session_model_state_async(session_id.clone()).await?;

    Ok(json!({
        "sessionId": session_id,
        "model": state.model,
        "accountId": state.account_id,
        "keySource": state.key_source,
        "cliAgentType": state.cli_agent_type,
        "modelEditable": state.model_editable,
    }))
}

/// Apply a model patch from mobile (mirrors desktop `session_patch`).
pub async fn session_patch(params: &Value) -> Result<Value, RpcError> {
    let session_id = parse_session_id(params)?;
    let patch_value = params
        .get("patch")
        .ok_or_else(|| RpcError::invalid_params("patch is required"))?;

    let model = patch_value
        .get("model")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| RpcError::invalid_params("patch.model is required"))?;

    let account_id = patch_value
        .get("accountId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let state = load_session_model_state_async(session_id.clone()).await?;
    if !state.model_editable {
        return Err(RpcError::new(
            RpcErrorCode::InvalidRequest,
            "session model cannot be changed from mobile",
        ));
    }

    let handle = crate::api::get_app_handle()
        .ok_or_else(|| RpcError::new(RpcErrorCode::InvalidRequest, "desktop agent not ready"))?;
    let app_state = handle.state::<agent_core::state::AgentAppState>();
    patch_session(
        app_state.inner(),
        session_id.clone(),
        SessionPatch {
            model: Some(model.clone()),
            account_id,
            ..Default::default()
        },
    )
    .await
    .map_err(|err| RpcError::new(RpcErrorCode::InvalidRequest, err))?;

    Ok(json!({
        "sessionId": session_id,
        "model": model,
    }))
}

/// List selectable models for a session, sourced from the desktop KeyVault.
pub async fn models_list(params: &Value) -> Result<Value, RpcError> {
    let session_id = parse_session_id(params)?;
    let options = tokio::task::spawn_blocking(move || {
        let state = load_session_model_state(&session_id)?;
        if !state.model_editable {
            return Ok(Vec::new());
        }
        collect_model_options_for_session(&session_id, &state)
    })
    .await
    .map_err(|err| RpcError::new(RpcErrorCode::InvalidRequest, err.to_string()))??;
    let models = options
        .into_iter()
        .map(|option| {
            json!({
                "id": option.id,
                "accountId": option.account_id,
                "accountLabel": option.account_label,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "models": models }))
}

async fn load_session_model_state_async(
    session_id: String,
) -> Result<MobileSessionModelState, RpcError> {
    tokio::task::spawn_blocking(move || load_session_model_state(&session_id))
        .await
        .map_err(|err| RpcError::new(RpcErrorCode::InvalidRequest, err.to_string()))?
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
