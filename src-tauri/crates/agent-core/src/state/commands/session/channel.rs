//! Channel agent commands: message processing, workspace files, channel
//! probe, and IDE action bridge.

use tracing::{info, warn};

use crate::persistence::AgentResponse;
use crate::session::persistence as session_persistence;
use crate::state::AgentAppState;
use crate::tools::impls::web::control_orgii::ActionBridgeResult;

#[allow(clippy::too_many_arguments)]
pub async fn channel_process_message(
    state: tauri::State<'_, AgentAppState>,
    content: String,
    session_id: Option<String>,
    model: Option<String>,
    account_id: Option<String>,
    active_repo_path: Option<String>,
    active_branch: Option<String>,
    active_repo_name: Option<String>,
    images: Option<Vec<String>>,
) -> Result<AgentResponse, String> {
    info!(
        "[channel_process_message] session_id={:?}, model={:?}, account_id={:?}, repo={:?}",
        session_id, model, account_id, active_repo_path
    );
    let session_key = session_id.unwrap_or_else(|| "tauri:direct".to_string());
    info!("[channel_process_message] session_key={}", session_key);
    let identity_guard = crate::state::session_identity_lock(&session_key)
        .await
        .lock_owned()
        .await;

    // Explicit command edits still win. Otherwise keep the complete current
    // session pair instead of reconstructing a model from agent defaults.
    let (current_model, current_account) =
        super::identity::resolve_initialization_model_pair(&state, &session_key, None, None)
            .await?;
    let previous_account = account_id
        .as_ref()
        .filter(|account| current_account.as_deref() != Some(account.as_str()))
        .map(|_| current_account.clone());
    if model.is_some() || account_id.is_some() {
        let session = state.get_session(&session_key).await;
        // A prepared Member turn pins its provider. Reject before writing and
        // keep the admission guard through the atomic identity edit.
        let mutation = match session.as_ref() {
            Some(session) => Some(session.begin_identity_mutation().await?),
            None => None,
        };
        match (model.as_deref(), account_id.as_deref()) {
            (Some(model), account) => {
                session_persistence::update_model_and_account(&session_key, model, account)
                    .map_err(|err| format!("[channel] Failed to persist model switch: {err}"))?;
            }
            (None, Some(account)) => {
                session_persistence::update_account_id(&session_key, account)
                    .map_err(|err| format!("[channel] Failed to persist account switch: {err}"))?;
            }
            (None, None) => unreachable!("identity edit requires an override"),
        }
        if let Some(mutation) = mutation {
            // Release the admission guard before init, which validates the
            // same domain while installing the replacement runtime.
            mutation.invalidate_runtime().await;
        }
    }
    let requested_model_override = model.or(current_model);
    let effective_account_id = account_id.or(current_account);

    let ide_context = if active_repo_path.is_some() || active_branch.is_some() {
        Some(crate::session::IdeContext {
            repo_path: active_repo_path,
            git_branch: active_branch,
            repo_name: active_repo_name,
            workspace_folders: Vec::new(),
            ..Default::default()
        })
    } else {
        None
    };

    let launch_spec = crate::init::launch_spec::AgentLaunchSpec::registered_session(
        &state,
        &session_key,
        app_paths::personal_workspace(),
        effective_account_id.clone(),
        requested_model_override.clone(),
        None,
    )
    .await?;
    let runtime = crate::init::init_session(&state, launch_spec).await?;
    let effective_model = runtime.model.clone();
    if let (Some(previous_account), Some(account)) =
        (previous_account, runtime.account_id.as_deref())
    {
        // Account-only edits still publish the resolved model. Consumers must
        // receive this complete pair instead of merging it with optimistic UI.
        crate::lifecycle::emit_session_account_switched(
            state.app_handle.as_ref(),
            &session_key,
            previous_account.as_deref(),
            account,
            Some(&effective_model),
        );
    }

    let session_arc = state
        .get_session(&session_key)
        .await
        .ok_or_else(|| format!("Session {} not found after init", session_key))?;

    let input = crate::session::TurnInput {
        content: content.clone(),
        display_text: None,
        agent_mode: None,
        images,
        ide_context,
        is_resume: false,
        channel: None,
        chat_id: None,
        turn_id: None,
        // Channel/admin synthetic turns (debug tooling) mint their own id.
        turn_intent_id: uuid::Uuid::new_v4().to_string(),
    };

    // The turn captures its provider separately. Never serialize the whole
    // provider request behind the model-picker identity lock.
    drop(identity_guard);

    const CALLER_TIMEOUT_SECS: u64 = 180;
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(CALLER_TIMEOUT_SECS),
        crate::session::turn::entry::process_message_with_runtime(
            session_arc,
            runtime,
            input,
            state.app_handle.clone(),
        ),
    )
    .await
    .map_err(|_| format!("Request timed out after {}s", CALLER_TIMEOUT_SECS))?
    .map(|r| r.content)?;

    Ok(AgentResponse {
        content: response,
        session_id: session_key,
        model: effective_model,
    })
}

#[tauri::command]
pub async fn agent_probe_channel(
    channel_type: String,
    credentials: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let result = crate::channels::probe::probe_channel(&channel_type, &credentials).await;
    serde_json::to_value(&result).map_err(|err| format!("Serialize error: {}", err))
}

#[tauri::command]
pub async fn agent_ade_action_result(
    state: tauri::State<'_, AgentAppState>,
    correlation_id: String,
    success: bool,
    message: String,
    data: Option<serde_json::Value>,
) -> Result<(), String> {
    let resolved = state.action_bridge.resolve(
        &correlation_id,
        ActionBridgeResult {
            success,
            message,
            data,
        },
    );
    if !resolved {
        warn!(
            "[channel_ade_action_result] No pending request for correlation_id: {}",
            correlation_id
        );
    }
    Ok(())
}
