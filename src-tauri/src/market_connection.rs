//! Composition boundary for the removable Market module. Common client
//! configuration and credential crates do not depend on this module.
use serde::Serialize;
#[cfg(feature = "market-connect")]
pub mod auth_helper;
#[cfg(feature = "market-connect")]
mod desktop_client;
#[cfg(feature = "market-connect")]
mod disconnect_steps;
#[cfg(feature = "market-connect")]
mod external_client;
pub mod seller;
#[cfg(feature = "market-connect")]
pub(crate) mod source;

pub(crate) fn register_source() -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    crate::dynamic_credentials::register(source::instance())?;
    Ok(())
}

#[derive(Serialize)]
pub struct ConnectionView {
    identity_user_id: String,
    workspace_id: String,
    target: String,
    // Authorization is not a successful client configuration or model request.
    phase: &'static str,
}
#[derive(Serialize)]
pub struct ModuleStatus {
    enabled: bool,
    buyer_persistent_credentials: bool,
    seller_temporary_authorization: bool,
    connections: Vec<ConnectionView>,
}

#[tauri::command]
pub async fn market_connection_begin(raw: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || enabled::begin(raw))
        .await
        .map_err(|_| "market_connection_unavailable")?
}
#[tauri::command]
pub async fn market_connection_complete(raw: String) -> Result<ConnectionView, String> {
    enabled::complete(raw).await
}
#[tauri::command]
pub async fn market_connection_cancel() -> Result<(), String> {
    tokio::task::spawn_blocking(enabled::cancel)
        .await
        .map_err(|_| "market_connection_unavailable")?
}
#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_apply(
    identity_user_id: String,
    workspace_id: String,
    target: String,
    entitlement_id: String,
    model: String,
    expected_hashes: std::collections::BTreeMap<String, Option<String>>,
) -> Result<agent_cli::managed_config::CliConfigManagedStatus, String> {
    #[cfg(feature = "market-connect")]
    {
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        let agent = target
            .harness_name()
            .ok_or("ORG2 workspace launch requires a session target")?;
        let metadata = market_connect::ConnectionMetadata {
            identity_user_id,
            workspace_id,
            target,
        };
        let key = source::Selection {
            metadata,
            entitlement_id,
        }
        .key()?;
        if agent == "claude_desktop" {
            return desktop_client::configure(key, model, expected_hashes).await;
        }
        crate::cli_managed_proxy::enable_dynamic_managed(agent.into(), key, model, expected_hashes)
            .await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (
            identity_user_id,
            workspace_id,
            target,
            entitlement_id,
            model,
            expected_hashes,
        );
        Err("market_module_disabled".into())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_disconnect(
    identity_user_id: String,
    workspace_id: String,
    target: String,
) -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    {
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        let agent = target.harness_name().map(str::to_string);
        let metadata = market_connect::ConnectionMetadata {
            identity_user_id,
            workspace_id,
            target,
        };
        enabled::disconnect(metadata, agent).await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (identity_user_id, workspace_id, target);
        Err("market_module_disabled".into())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_options(
    identity_user_id: String,
    workspace_id: String,
    target: String,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "market-connect")]
    {
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        let entries = source::options(market_connect::ConnectionMetadata {
            identity_user_id,
            workspace_id,
            target,
        })
        .await?;
        serde_json::to_value(entries).map_err(|_| "Market workspace response unavailable".into())
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (identity_user_id, workspace_id, target);
        Err("market_module_disabled".into())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_prepare_session(
    identity_user_id: String,
    workspace_id: String,
    target: String,
    entitlement_id: String,
    agent: String,
    model: String,
) -> Result<String, String> {
    #[cfg(feature = "market-connect")]
    {
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        source::prepare_session(
            market_connect::ConnectionMetadata {
                identity_user_id,
                workspace_id,
                target,
            },
            entitlement_id,
            agent,
            model,
        )
        .await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (
            identity_user_id,
            workspace_id,
            target,
            entitlement_id,
            agent,
            model,
        );
        Err("market_module_disabled".into())
    }
}

#[tauri::command]
pub async fn market_connection_status() -> Result<ModuleStatus, String> {
    enabled::status().await
}

#[cfg(feature = "market-connect")]
mod enabled {
    use super::*;
    use market_connect::{ConnectionMetadata, Enrollment};
    use std::sync::{Mutex, OnceLock};

    static ENROLLMENT: OnceLock<Mutex<Enrollment>> = OnceLock::new();
    fn owner() -> &'static Mutex<Enrollment> {
        ENROLLMENT.get_or_init(Default::default)
    }
    fn index_path() -> std::path::PathBuf {
        app_paths::orgii_root()
            .join("market")
            .join("connections.json")
    }
    pub(super) fn read_index() -> Result<Vec<ConnectionMetadata>, String> {
        let path = index_path();
        let mut file = match std::fs::File::open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err("market_connection_index_unavailable".into()),
        };
        let mut bytes = Vec::new();
        use std::io::Read;
        (&mut file)
            .take(32769)
            .read_to_end(&mut bytes)
            .map_err(|_| "market_connection_index_unavailable")?;
        if bytes.len() > 32768 {
            return Err("market_connection_index_too_large".into());
        }
        let records: Vec<ConnectionMetadata> =
            serde_json::from_slice(&bytes).map_err(|_| "market_connection_index_invalid")?;
        if records.len() > 32 {
            return Err("market_connection_limit".into());
        }
        Ok(records)
    }
    fn view(record: ConnectionMetadata, phase: &'static str) -> ConnectionView {
        ConnectionView {
            identity_user_id: record.identity_user_id,
            workspace_id: record.workspace_id,
            target: record.target.wire_name().into(),
            phase,
        }
    }
    pub fn begin(raw: String) -> Result<String, String> {
        market_connect::require_buyer_credential_store()?;
        let selection =
            market_connect::parse_selection(&raw).ok_or("invalid_market_connection_link")?;
        owner()
            .lock()
            .map_err(|_| "market_connection_unavailable")?
            .begin(selection)
            .map_err(Into::into)
    }
    pub fn cancel() -> Result<(), String> {
        owner()
            .lock()
            .map_err(|_| "market_connection_unavailable")?
            .cancel();
        Ok(())
    }
    pub async fn complete(raw: String) -> Result<ConnectionView, String> {
        // Also gate cold callbacks before consuming or exchanging a code.
        market_connect::require_buyer_credential_store()?;
        let redemption = owner()
            .lock()
            .map_err(|_| "market_connection_unavailable")?
            .take_redemption(&raw)?;
        let attempt = redemption.attempt_id().to_owned();
        let grant = match redemption.exchange().await {
            Ok(grant) => grant,
            Err(error) => {
                owner()
                    .lock()
                    .map_err(|_| "market_connection_unavailable")?
                    .cancel_attempt(&attempt);
                return Err(error.into());
            }
        };
        // Wait for native renewal commits before replacing an authorization.
        // Retire cached access so the next request reads the new OS-store grant.
        let source_guard = super::source::retire_for_reauthorization().await;
        tokio::task::spawn_blocking(move || {
            let _source_guard = source_guard;
            // Serialize index updates and cancellation with the final secret-store write.
            let mut enrollment = owner()
                .lock()
                .map_err(|_| "market_connection_unavailable")?;
            let mut records = match read_index() {
                Ok(records) => records,
                Err(error) => {
                    enrollment.cancel_attempt(&attempt);
                    return Err(error);
                }
            };
            let metadata = grant.metadata();
            let existing = records.iter().position(|r| *r == metadata);
            if existing.is_none() && records.len() >= 32 {
                enrollment.cancel_attempt(&attempt);
                return Err("market_connection_limit".into());
            }
            let scope = app_paths::orgii_root().to_string_lossy().into_owned();
            if existing.is_none() {
                records.push(metadata.clone());
            }
            let bytes =
                serde_json::to_vec(&records).map_err(|_| "market_connection_index_invalid")?;
            let metadata = enrollment.store_authorized(grant, &scope, || {
                agent_cli::managed_config::write_cli_profile_file_atomic(&index_path(), &bytes)
                    .map_err(|_| "market_connection_index_unavailable")
            })?;
            Ok(view(metadata, "authorization_saved"))
        })
        .await
        .map_err(|_| "market_connection_unavailable")?
    }
    pub async fn disconnect(
        metadata: ConnectionMetadata,
        agent: Option<String>,
    ) -> Result<(), String> {
        let source_guard = super::source::retire_for_reauthorization().await;
        tokio::task::spawn_blocking(move || {
            let _source_guard = source_guard;
            let _enrollment = owner()
                .lock()
                .map_err(|_| "market_connection_unavailable")?;
            let mut records = read_index()?;
            // Prepare the intended index before cleanup; retain unrelated entries.
            records.retain(|record| record != &metadata);
            let bytes =
                serde_json::to_vec(&records).map_err(|_| "market_connection_index_invalid")?;
            let scope = app_paths::orgii_root().to_string_lossy().into_owned();
            super::disconnect_steps::disconnect_steps(
                || {
                    let Some(agent) = agent.as_deref() else {
                        return Ok(());
                    };
                    agent_cli::managed_config::restore_if_selected_matching(agent, |key| {
                        super::source::belongs_to(key, agent, &metadata)
                    })
                    .map(|_| ())
                },
                || market_connect::Grant::remove(&scope, &metadata).map_err(String::from),
                || {
                    agent_cli::managed_config::write_cli_profile_file_atomic(&index_path(), &bytes)
                        .map_err(|_| "market_connection_index_unavailable".into())
                },
            )
        })
        .await
        .map_err(|_| "market_connection_unavailable")?
    }
    pub async fn status() -> Result<ModuleStatus, String> {
        tokio::task::spawn_blocking(|| {
            Ok(ModuleStatus {
                enabled: true,
                buyer_persistent_credentials: market_connect::buyer_credential_store_supported(),
                seller_temporary_authorization: true,
                connections: read_index()?
                    .into_iter()
                    .map(|record| {
                        let scope = app_paths::orgii_root().to_string_lossy().into_owned();
                        let phase = if market_connect::Grant::load(&scope, &record).is_ok() {
                            "authorization_saved"
                        } else {
                            "reauthorization_required"
                        };
                        view(record, phase)
                    })
                    .collect(),
            })
        })
        .await
        .map_err(|_| "market_connection_unavailable")?
    }
}

#[cfg(not(feature = "market-connect"))]
mod enabled {
    use super::*;
    pub fn begin(_: String) -> Result<String, String> {
        Err("market_module_disabled".into())
    }
    pub async fn complete(_: String) -> Result<ConnectionView, String> {
        Err("market_module_disabled".into())
    }
    pub fn cancel() -> Result<(), String> {
        Ok(())
    }
    pub async fn status() -> Result<ModuleStatus, String> {
        Ok(ModuleStatus {
            enabled: false,
            buyer_persistent_credentials: false,
            seller_temporary_authorization: false,
            connections: Vec::new(),
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_open_client(
    agent: String,
    selection: String,
    model: String,
    folder: String,
) -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    {
        external_client::open(agent, selection, model, folder).await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (agent, selection, model, folder);
        Err("market_module_disabled".into())
    }
}
