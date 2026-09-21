//! Composition boundary for the removable Market module. Common client
//! configuration and credential crates do not depend on this module.
use serde::{Deserialize, Serialize};
#[cfg(feature = "market-connect")]
mod app_catalog;
#[cfg(feature = "market-connect")]
mod configure_catalog;
#[cfg(feature = "market-connect")]
mod external_client;
#[cfg(feature = "market-connect")]
mod native_app_launch;
#[cfg(feature = "market-connect")]
mod native_provider;
#[cfg(feature = "market-connect")]
mod owner;
#[cfg(feature = "market-connect")]
mod owner_refresh;
#[cfg(feature = "market-connect")]
pub(crate) mod source;

pub(crate) fn register_source() -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    {
        agent_core::providers::dynamic::register(std::sync::Arc::new(
            native_provider::NativeSource,
        ))?;
        crate::dynamic_credentials::register(source::instance())?;
        crate::dynamic_credentials::register(std::sync::Arc::new(app_catalog::AppSource))?;
    }
    Ok(())
}

/// Invalidate before the frontend's durable Cloud auth transition.
#[tauri::command]
pub async fn market_connection_suspend_owner() -> Result<u64, String> {
    #[cfg(feature = "market-connect")]
    {
        owner::suspend().await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        Ok(0)
    }
}
/// Reads only this instance's canonical persisted Cloud auth; never accepts an identity.
#[tauri::command]
pub async fn market_connection_sync_owner(epoch: Option<u64>) -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    {
        owner::sync(epoch).await
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = epoch;
        Ok(())
    }
}

// Only the main webview in this instance may claim the native-owned request.
// Caller-provided user identities and tokens are intentionally not accepted.
#[tauri::command]
pub fn market_connection_refresh_pending(window: tauri::WebviewWindow) -> Option<String> {
    if window.label() != "main" {
        return None;
    }
    #[cfg(feature = "market-connect")]
    {
        owner_refresh::pending()
    }
    #[cfg(not(feature = "market-connect"))]
    {
        None
    }
}
#[tauri::command]
pub fn market_connection_refresh_claim(
    window: tauri::WebviewWindow,
    ticket: String,
) -> Option<String> {
    if window.label() != "main" {
        return None;
    }
    #[cfg(feature = "market-connect")]
    {
        owner_refresh::claim(&ticket)
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = ticket;
        None
    }
}
#[tauri::command]
pub fn market_connection_refresh_complete(window: tauri::WebviewWindow, ticket: String) {
    if window.label() != "main" {
        return;
    }
    #[cfg(feature = "market-connect")]
    {
        owner_refresh::complete(&ticket);
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = ticket;
    }
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
    app_scheme: String,
    buyer_persistent_credentials: bool,
    connections: Vec<ConnectionView>,
}

#[derive(Serialize)]
pub struct PreparedSession {
    credential_source: String,
}

#[derive(Serialize)]
pub struct ConfiguredProfile {
    status: agent_cli::managed_config::CliConfigManagedStatus,
    selection: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigureProfileRequest {
    identity_user_id: String,
    workspace_id: String,
    target: String,
    entitlement_workspace_id: String,
    entitlement_id: String,
    agent: String,
    model: String,
    expected_hashes: std::collections::BTreeMap<String, Option<String>>,
}

#[cfg(feature = "market-connect")]
fn validate_external_profile_request(
    target: &market_connect::Target,
    agent: &str,
    model: &str,
) -> Result<(), String> {
    if target != &market_connect::Target::Org2 {
        return Err("Market profile requires ORG2 authorization".into());
    }
    if !matches!(agent, "claude_code" | "claude_desktop" | "codex") {
        return Err("Unsupported Market profile app".into());
    }
    if model.trim().is_empty() || model.len() > 256 {
        return Err("Unsupported Market profile model".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn market_connection_begin(raw: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || enabled::begin(raw))
        .await
        .map_err(|_| "market_connection_unavailable")?
}
#[tauri::command]
pub async fn market_connection_complete(
    raw: String,
    expected_identity_user_id: Option<String>,
) -> Result<ConnectionView, String> {
    enabled::complete(raw, expected_identity_user_id).await
}
#[tauri::command]
pub async fn market_connection_cancel() -> Result<(), String> {
    tokio::task::spawn_blocking(enabled::cancel)
        .await
        .map_err(|_| "market_connection_unavailable")?
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
pub async fn market_connection_activate_service(
    identity_user_id: String,
    workspace_id: String,
    target: String,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "market-connect")]
    {
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        let request: market_connect::ActivateService =
            serde_json::from_value(request).map_err(|_| "Invalid usage authorization")?;
        let access = source::activate(
            market_connect::ConnectionMetadata {
                identity_user_id,
                workspace_id,
                target,
            },
            request,
        )
        .await
        .inspect_err(|error| tracing::warn!(error = %error, "[Market] activate_service failed"))?;
        serde_json::to_value(access).map_err(|_| "Invalid usage authorization".into())
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (identity_user_id, workspace_id, target, request);
        Err("market_module_disabled".into())
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_prepare_session(
    identity_user_id: String,
    workspace_id: String,
    target: String,
    entitlement_workspace_id: String,
    entitlement_id: String,
    agent: String,
    model: String,
) -> Result<PreparedSession, String> {
    #[cfg(feature = "market-connect")]
    {
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        let credential_source = source::prepare_session(
            market_connect::ConnectionMetadata {
                identity_user_id,
                workspace_id,
                target,
            },
            entitlement_workspace_id,
            entitlement_id,
            agent,
            model,
        )
        .await?;
        Ok(PreparedSession { credential_source })
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (
            identity_user_id,
            workspace_id,
            target,
            entitlement_workspace_id,
            entitlement_id,
            agent,
            model,
        );
        Err("market_module_disabled".into())
    }
}

/// Configure an external client from the same ORG2-scoped purchase profile
/// used by native sessions. The opaque selection is minted only after the
/// entitlement/model check succeeds and no provider secret is persisted.
#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_configure_profile(
    request: ConfigureProfileRequest,
) -> Result<ConfiguredProfile, String> {
    #[cfg(feature = "market-connect")]
    {
        let ConfigureProfileRequest {
            identity_user_id,
            workspace_id,
            target,
            entitlement_workspace_id,
            entitlement_id,
            agent,
            model,
            expected_hashes,
        } = request;
        let target: market_connect::Target =
            serde_json::from_value(serde_json::Value::String(target))
                .map_err(|_| "Invalid Market target")?;
        validate_external_profile_request(&target, &agent, &model)?;
        let lease = owner::require()?;
        lease.matches(&identity_user_id)?;
        native_app_launch::verify_installed(&agent).await?;
        let selection = source::prepare_session(
            market_connect::ConnectionMetadata {
                identity_user_id,
                workspace_id,
                target,
            },
            entitlement_workspace_id,
            entitlement_id,
            agent.clone(),
            model.clone(),
        )
        .await?;
        let parsed = source::Selection::parse(&selection, &agent)?;
        let entries = source::options(parsed.metadata.clone()).await?;
        let now = chrono::Utc::now().timestamp_millis();
        source::validate_external_purchase(
            &entries,
            &parsed.workspace_id,
            &parsed.entitlement_id,
            &agent,
            &model,
            now,
        )?;
        let native_app = lease.native_app(&agent)?;
        let status = if agent == "claude_desktop" {
            let entry = entries
                .iter()
                .find(|entry| {
                    entry.workspace_id == parsed.workspace_id
                        && entry.entitlement_id == parsed.entitlement_id
                })
                .ok_or("No Claude models available")?;
            let models = entry
                .models_by_agent
                .get("claude")
                .ok_or("No Claude models available")?
                .iter()
                .filter(|candidate| {
                    source::validate_external_purchase(
                        &entries,
                        &parsed.workspace_id,
                        &parsed.entitlement_id,
                        &agent,
                        candidate,
                        now,
                    )
                    .is_ok()
                })
                .map(
                    |model| agent_cli::managed_config::model_catalog::PickerModel {
                        id: model.clone(),
                        label: app_catalog::picker_label(&entry.service_name, model, None),
                        native_metadata: None,
                    },
                )
                .collect();
            crate::cli_managed_proxy::enable_dynamic_desktop(
                selection.clone(),
                model,
                models,
                expected_hashes,
                native_app,
                lease.operation(),
            )
            .await?
        } else {
            crate::cli_managed_proxy::enable_dynamic_managed(
                agent,
                selection.clone(),
                model,
                expected_hashes,
                native_app,
                lease.operation(),
            )
            .await?
        };
        Ok(ConfiguredProfile { status, selection })
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = request;
        Err("market_module_disabled".into())
    }
}

#[cfg(all(test, feature = "market-connect"))]
mod profile_tests {
    use super::*;

    #[test]
    fn configure_profile_request_is_one_strict_camel_case_payload() {
        let value = serde_json::json!({
            "identityUserId": "11111111-1111-4111-8111-111111111111",
            "workspaceId": "ws_identity",
            "target": "org2",
            "entitlementWorkspaceId": "ws_purchase",
            "entitlementId": "ent_purchase",
            "agent": "codex",
            "model": "gpt-example",
            "expectedHashes": { "config": "sha256:example" }
        });
        assert!(serde_json::from_value::<ConfigureProfileRequest>(value.clone()).is_ok());
        let mut unknown = value;
        unknown["legacyField"] = serde_json::Value::Bool(true);
        assert!(serde_json::from_value::<ConfigureProfileRequest>(unknown).is_err());
    }

    #[test]
    fn prepared_session_contains_only_the_opaque_credential_source() {
        let value = serde_json::to_value(PreparedSession {
            credential_source: "market:opaque".into(),
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "credential_source": "market:opaque" })
        );
    }

    #[test]
    fn external_profiles_require_org2_authorization_and_supported_apps() {
        assert!(validate_external_profile_request(
            &market_connect::Target::Org2,
            "claude_code",
            "claude-model"
        )
        .is_ok());
        assert!(validate_external_profile_request(
            &market_connect::Target::Org2,
            "claude_desktop",
            "claude-model"
        )
        .is_ok());
        assert!(validate_external_profile_request(
            &market_connect::Target::Org2,
            "codex",
            "codex-model"
        )
        .is_ok());
        assert!(validate_external_profile_request(
            &market_connect::Target::Codex,
            "codex",
            "codex-model"
        )
        .is_err());
        assert!(validate_external_profile_request(
            &market_connect::Target::Org2,
            "unknown",
            "model"
        )
        .is_err());
        assert!(
            validate_external_profile_request(&market_connect::Target::Org2, "codex", "").is_err()
        );
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

    #[derive(Default)]
    struct EnrollmentOwner {
        enrollment: Enrollment,
        lease: Option<super::owner::Lease>,
    }
    static ENROLLMENT: OnceLock<Mutex<EnrollmentOwner>> = OnceLock::new();
    fn owner() -> &'static Mutex<EnrollmentOwner> {
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
        let lease = super::owner::require()?;
        let mut state = owner()
            .lock()
            .map_err(|_| "market_connection_unavailable")?;
        lease.check()?;
        let url = state.enrollment.begin(selection).map_err(String::from)?;
        state.lease = Some(lease);
        Ok(url)
    }
    pub fn cancel() -> Result<(), String> {
        let mut state = owner()
            .lock()
            .map_err(|_| "market_connection_unavailable")?;
        state.enrollment.cancel();
        state.lease = None;
        Ok(())
    }
    pub async fn complete(
        raw: String,
        expected_identity_user_id: Option<String>,
    ) -> Result<ConnectionView, String> {
        // Also gate cold callbacks before consuming or exchanging a code.
        market_connect::require_buyer_credential_store()?;
        let (redemption, lease) = {
            let mut state = owner()
                .lock()
                .map_err(|_| "market_connection_unavailable")?;
            let lease = state.lease.clone().ok_or("market_cloud_sign_in_required")?;
            lease.check()?;
            (state.enrollment.take_redemption(&raw)?, lease)
        };
        let attempt = redemption.attempt_id().to_owned();
        let grant = match redemption.exchange().await {
            Ok(grant) => grant,
            Err(error) => {
                owner()
                    .lock()
                    .map_err(|_| "market_connection_unavailable")?
                    .enrollment
                    .cancel_attempt(&attempt);
                return Err(error.into());
            }
        };
        lease.check()?;
        if let Some(expected) = expected_identity_user_id.as_deref() {
            lease.matches(expected)?;
        }
        if let Err(error) = grant.require_cloud_identity(Some(lease.user())) {
            owner()
                .lock()
                .map_err(|_| "market_connection_unavailable")?
                .enrollment
                .cancel_attempt(&attempt);
            return Err(error.into());
        }
        // Wait for native renewal commits before replacing an authorization.
        // Retire cached access so the next request reads the new OS-store grant.
        let source_guard = super::source::retire_for_reauthorization().await;
        tokio::task::spawn_blocking(move || {
            let _source_guard = source_guard;
            // Serialize index updates and cancellation with the final secret-store write.
            let mut enrollment = owner()
                .lock()
                .map_err(|_| "market_connection_unavailable")?;
            lease.check()?;
            let enrollment = &mut enrollment.enrollment;
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
            lease.check()?;
            let metadata = enrollment.store_authorized(grant, &scope, || {
                agent_cli::managed_config::write_cli_profile_file_atomic(&index_path(), &bytes)
                    .map_err(|_| "market_connection_index_unavailable")
            })?;
            Ok(view(metadata, "authorization_saved"))
        })
        .await
        .map_err(|_| "market_connection_unavailable")?
    }
    #[cfg(test)]
    #[tokio::test]
    async fn status_without_a_verified_owner_is_not_an_empty_success() {
        assert_eq!(
            status().await.err().as_deref(),
            Some("market_cloud_sign_in_required")
        );
    }

    pub async fn status() -> Result<ModuleStatus, String> {
        let lease = super::owner::require()?;
        tokio::task::spawn_blocking(move || {
            let mut connections = Vec::new();
            for record in read_index()?
                .into_iter()
                .filter(|r| r.identity_user_id == lease.user())
            {
                lease.check()?;
                let scope = app_paths::orgii_root().to_string_lossy().into_owned();
                let phase = if market_connect::Grant::load(&scope, &record).is_ok() {
                    "authorization_saved"
                } else {
                    "reauthorization_required"
                };
                connections.push(view(record, phase));
            }
            lease.check()?;
            Ok(ModuleStatus {
                enabled: true,
                app_scheme: market_connect::app_scheme()?.to_string(),
                buyer_persistent_credentials: market_connect::buyer_credential_store_supported(),
                connections,
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
    pub async fn complete(_: String, _: Option<String>) -> Result<ConnectionView, String> {
        Err("market_module_disabled".into())
    }
    pub fn cancel() -> Result<(), String> {
        Ok(())
    }
    pub async fn status() -> Result<ModuleStatus, String> {
        Ok(ModuleStatus {
            enabled: false,
            app_scheme: "orgii".into(),
            buyer_persistent_credentials: false,
            connections: Vec::new(),
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_open_client(
    agent: String,
    selection: String,
    model: String,
) -> Result<(), String> {
    #[cfg(feature = "market-connect")]
    {
        let agent_name = agent.clone();
        external_client::open(agent, selection, model)
            .await
            .inspect_err(|error| {
                tracing::warn!(agent = %agent_name, error = %error, "[Market] open_client failed")
            })
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = (agent, selection, model);
        Err("market_module_disabled".into())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageChoice {
    identity_user_id: String,
    workspace_id: String,
    target: String,
    entitlement_workspace_id: String,
    entitlement_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigureCatalogRequest {
    packages: Vec<PackageChoice>,
    agent: String,
    default_package: usize,
    default_model: String,
    expected_hashes: std::collections::BTreeMap<String, Option<String>>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn market_connection_configure_catalog(
    request: ConfigureCatalogRequest,
) -> Result<ConfiguredProfile, String> {
    #[cfg(feature = "market-connect")]
    {
        let agent = request.agent.clone();
        configure_catalog::configure(request)
            .await
            .inspect_err(|error| {
                tracing::warn!(agent = %agent, error = %error, "[Market] configure_catalog failed")
            })
    }
    #[cfg(not(feature = "market-connect"))]
    {
        let _ = request;
        Err("market_module_disabled".into())
    }
}
