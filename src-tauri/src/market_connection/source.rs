use crate::dynamic_credentials::{Authentication, Credential, Destination, Source};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use market_connect::{Connection, ConnectionMetadata, WorkspaceCredential};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Selection {
    pub metadata: ConnectionMetadata,
    pub workspace_id: String,
    pub entitlement_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_protocol: Option<String>,
}
impl Selection {
    pub(super) fn key(&self) -> Result<String, String> {
        Ok(format!(
            "market:{}",
            URL_SAFE_NO_PAD
                .encode(serde_json::to_vec(self).map_err(|_| "Invalid Market selection")?)
        ))
    }
    pub(super) fn parse(value: &str, agent: &str) -> Result<Self, String> {
        if value.len() > 1024 {
            return Err("Invalid Market selection".into());
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(
                value
                    .strip_prefix("market:")
                    .ok_or("Invalid Market selection")?,
            )
            .map_err(|_| "Invalid Market selection")?;
        // Older manifests used the authorization workspace as the purchase
        // workspace. Preserve that identity; never substitute another purchase.
        let mut wire: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid Market selection")?;
        if wire.get("workspace_id").is_none() {
            let workspace = wire
                .get("metadata")
                .and_then(|metadata| metadata.get("workspace_id"))
                .cloned()
                .ok_or("Invalid Market selection")?;
            wire.as_object_mut()
                .ok_or("Invalid Market selection")?
                .insert("workspace_id".into(), workspace);
        }
        let selection: Self =
            serde_json::from_value(wire).map_err(|_| "Invalid Market selection")?;
        if uuid::Uuid::parse_str(&selection.metadata.identity_user_id).is_err()
            || !selection.metadata.workspace_id.starts_with("ws_")
            || !(4..=123).contains(&selection.metadata.workspace_id.len())
            || !selection
                .metadata
                .workspace_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            || selection.metadata.target != market_connect::Target::Org2
            || !matches!(
                agent,
                "claude_code" | "claude_desktop" | "codex" | "rust_agent"
            )
            || (agent == "rust_agent"
                && (!selection.entitlement_id.starts_with("pa_")
                    || !matches!(
                        selection.native_protocol.as_deref(),
                        Some("anthropic_messages" | "openai_responses")
                    )))
            || !(selection.entitlement_id.starts_with("ent_")
                || selection.entitlement_id.starts_with("pa_"))
            || (selection.entitlement_id.starts_with("pa_")
                && (selection
                    .model
                    .as_ref()
                    .is_none_or(|v| v.is_empty() || v.len() > 256)
                    || selection
                        .session_id
                        .as_ref()
                        .is_none_or(|v| uuid::Uuid::parse_str(v).is_err())))
            || !selection.workspace_id.starts_with("ws_")
            || !(4..=123).contains(&selection.workspace_id.len())
            || !selection
                .workspace_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            || selection.entitlement_id.len() > 64
            || !selection
                .entitlement_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err("Market client selection mismatch".into());
        }
        Ok(selection)
    }
}
#[derive(Default)]
struct ConnectionState {
    connection: Option<Arc<Connection>>,
    credentials: HashMap<String, WorkspaceCredential>,
}
#[derive(Default)]
struct State {
    connections: HashMap<String, Arc<tokio::sync::Mutex<ConnectionState>>>,
}
#[derive(Clone, Default)]
pub(super) struct MarketSource {
    state: Arc<tokio::sync::Mutex<State>>,
    // Requests share this barrier. Authorization mutations take it exclusively,
    // wait for prior requests, and keep it until the persistent commit finishes.
    authorization: Arc<tokio::sync::RwLock<()>>,
}
impl MarketSource {
    async fn acquire(
        &self,
        metadata: &ConnectionMetadata,
    ) -> Result<
        (
            tokio::sync::OwnedRwLockReadGuard<()>,
            Arc<tokio::sync::Mutex<ConnectionState>>,
        ),
        String,
    > {
        let authorization = Arc::clone(&self.authorization).read_owned().await;
        let key = serde_json::to_string(metadata).map_err(|_| "Invalid Market identity")?;
        let mut state = self.state.lock().await;
        if !state.connections.contains_key(&key) && state.connections.len() >= 32 {
            return Err("Market connection limit reached".into());
        }
        let connection = Arc::clone(state.connections.entry(key).or_default());
        Ok((authorization, connection))
    }

    async fn authorized_acquire(
        &self,
        metadata: &ConnectionMetadata,
    ) -> Result<
        (
            super::owner::Lease,
            tokio::sync::OwnedRwLockReadGuard<()>,
            Arc<tokio::sync::Mutex<ConnectionState>>,
        ),
        String,
    > {
        let lease = super::owner::require_fresh(&metadata.identity_user_id).await?;
        let (guard, entry) = self.acquire(metadata).await?;
        lease.check()?;
        Ok((lease, guard, entry))
    }

    async fn retire(&self) -> tokio::sync::OwnedRwLockWriteGuard<()> {
        let guard = Arc::clone(&self.authorization).write_owned().await;
        *self.state.lock().await = State::default();
        guard
    }
}
impl ConnectionState {
    async fn authorized_credential<F, Fut>(
        &mut self,
        lease: &super::owner::Lease,
        cache_key: &str,
        agent: &str,
        now: i64,
        fetch: F,
    ) -> Result<Credential, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<WorkspaceCredential, String>>,
    {
        lease.check()?;
        let credential = self.credential(cache_key, agent, now, fetch).await?;
        lease.check()?;
        Ok(credential)
    }

    async fn credential<F, Fut>(
        &mut self,
        cache_key: &str,
        agent: &str,
        now: i64,
        fetch: F,
    ) -> Result<Credential, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<WorkspaceCredential, String>>,
    {
        if self
            .credentials
            .get(cache_key)
            .is_none_or(|c| c.expires_at() <= now + 60000)
        {
            // A failed refresh must propagate; never use an expired cached token.
            let credential = fetch().await?;
            self.credentials
                .retain(|_, value| value.expires_at() > now + 60000);
            if !self.credentials.contains_key(cache_key) && self.credentials.len() >= 32 {
                let oldest = self
                    .credentials
                    .iter()
                    .min_by_key(|(_, value)| value.expires_at())
                    .map(|(key, _)| key.clone());
                if let Some(oldest) = oldest {
                    self.credentials.remove(&oldest);
                }
            }
            // Eviction drops only a cached short-lived token. A still-live
            // session can mint another; completed sessions never consume a
            // permanent selection slot across the process lifetime.
            self.credentials.insert(cache_key.into(), credential);
        }
        let credential = self
            .credentials
            .get(cache_key)
            .ok_or("Market credential missing")?;
        Ok(Credential {
            destination: Destination {
                provider: "market".into(),
                authentication: Authentication::Bearer,
                base_url: protocol_base_url(credential.base_url(), agent),
            },
            secret: credential.bearer().into(),
        })
    }

    async fn restore(&mut self, metadata: ConnectionMetadata) -> Result<Arc<Connection>, String> {
        if let Some(connection) = &self.connection {
            return Ok(Arc::clone(connection));
        }
        let expected = metadata.clone();
        if !tokio::task::spawn_blocking(move || {
            super::enabled::read_index().map(|r| r.contains(&expected))
        })
        .await
        .map_err(|_| "Market index unavailable")??
        {
            return Err("Market authorization is missing".into());
        }
        let scope = app_paths::orgii_root().to_string_lossy().into_owned();
        let connection = Connection::restore(scope, metadata).await?;
        self.connection = Some(Arc::clone(&connection));
        Ok(connection)
    }
}
impl Source for MarketSource {
    fn namespace(&self) -> &'static str {
        "market"
    }
    fn request_selection(
        &self,
        key: &str,
        agent: &str,
        model: &str,
    ) -> Result<Option<crate::dynamic_credentials::RequestSelection>, String> {
        let mut selection = Selection::parse(key, agent)?;
        if model.is_empty() || model.len() > 256 || model.chars().any(char::is_control) {
            return Err("Invalid Market request model".into());
        }
        selection.model = Some(model.into());
        Ok(Some(crate::dynamic_credentials::RequestSelection {
            selection: selection.key()?,
            model: model.into(),
        }))
    }
    fn destination(&self, key: &str, agent: &str) -> Result<Destination, String> {
        let selection = Selection::parse(key, agent)?;
        Ok(Destination {
            provider: "market".into(),
            authentication: Authentication::Bearer,
            base_url: protocol_base_url(
                &if selection.entitlement_id.starts_with("pa_") {
                    format!(
                        "{}/p/{}",
                        market_connect::gateway_origin()?,
                        selection.entitlement_id
                    )
                } else {
                    format!(
                        "{}/w/{}",
                        market_connect::gateway_origin()?,
                        selection.workspace_id
                    )
                },
                agent,
            ),
        })
    }
    fn credential<'a>(
        &'a self,
        key: &'a str,
        agent: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Credential, String>> + Send + 'a>>
    {
        let owner = self.clone();
        let key = key.to_owned();
        let agent = agent.to_owned();
        Box::pin(async move {
            tokio::spawn(async move {
                let key = key.as_str();
                let agent = agent.as_str();
                let selection = Selection::parse(key, agent)?;
                // Cache by protocol, access, model and session. Each owner
                // retains at most 32 short-lived credentials.
                let cache_key = format!("{agent}:{key}");
                let (lease, _authorization, entry) =
                    owner.authorized_acquire(&selection.metadata).await?;
                let mut state = entry.lock().await;
                let connection = state.restore(selection.metadata.clone()).await?;
                let now = chrono::Utc::now().timestamp_millis();
                lease.check()?;
                let credential = state
                    .authorized_credential(&lease, &cache_key, agent, now, || async {
                        let wire_agent = if agent == "codex" { "codex" } else { "claude" };
                        if selection.entitlement_id.starts_with("pa_") {
                            return connection
                                .service_credential(
                                    &selection.workspace_id,
                                    &selection.entitlement_id,
                                    selection.model.as_deref().ok_or("Missing service model")?,
                                    selection
                                        .session_id
                                        .as_deref()
                                        .ok_or("Missing service session")?,
                                )
                                .await
                                .map_err(String::from);
                        }
                        connection
                            .workspace_credential(
                                &selection.workspace_id,
                                &selection.entitlement_id,
                                wire_agent,
                            )
                            .await
                            .map_err(String::from)
                    })
                    .await?;
                lease.check()?;
                Ok(credential)
            })
            .await
            .map_err(|_| "Market credential task failed".to_string())?
        })
    }
}

static INSTANCE: std::sync::OnceLock<Arc<MarketSource>> = std::sync::OnceLock::new();
pub(super) fn instance() -> Arc<MarketSource> {
    Arc::clone(INSTANCE.get_or_init(|| Arc::new(MarketSource::default())))
}
pub(super) async fn operation_barrier(
    lease: &super::owner::Lease,
) -> Result<tokio::sync::OwnedRwLockReadGuard<()>, String> {
    let guard = Arc::clone(&instance().authorization).read_owned().await;
    lease.check()?;
    Ok(guard)
}
pub(super) async fn retire_for_reauthorization() -> tokio::sync::OwnedRwLockWriteGuard<()> {
    instance().retire().await
}

pub(super) async fn options(
    metadata: ConnectionMetadata,
) -> Result<Vec<market_connect::WorkspaceEntitlement>, String> {
    if metadata.target != market_connect::Target::Org2 {
        return Err("Market workspace requires ORG2 authorization".into());
    }
    let source = instance();
    tokio::spawn(async move {
        let (lease, _authorization, entry) = source.authorized_acquire(&metadata).await?;
        let mut state = entry.lock().await;
        let connection = state.restore(metadata).await?;
        lease.check()?;
        let entries = connection.entitlements().await.map_err(String::from)?;
        lease.check()?;
        Ok(entries)
    })
    .await
    .map_err(|_| "Market workspace request failed")?
}

pub(super) async fn activate(
    metadata: ConnectionMetadata,
    request: market_connect::ActivateService,
) -> Result<market_connect::ManagedAccess, String> {
    if metadata.target != market_connect::Target::Org2 {
        return Err("Service activation requires ORG2 authorization".into());
    }
    let source = instance();
    let (lease, _authorization, entry) = source.authorized_acquire(&metadata).await?;
    let mut state = entry.lock().await;
    let connection = state.restore(metadata).await?;
    lease.check()?;
    let result = connection
        .activate_service(&request)
        .await
        .map_err(String::from)?;
    lease.check()?;
    Ok(result)
}

/// Prepare a public session source from authoritative purchase capabilities.
/// This does not change global client configuration or send a model request.
pub(super) async fn prepare_session(
    metadata: ConnectionMetadata,
    workspace_id: String,
    entitlement_id: String,
    agent: String,
    model: String,
) -> Result<String, String> {
    if metadata.target != market_connect::Target::Org2 {
        return Err("Market session requires ORG2 authorization".into());
    }
    let lease = super::owner::require()?;
    lease.matches(&metadata.identity_user_id)?;
    let mut selection = Selection {
        metadata,
        workspace_id,
        entitlement_id,
        model: Some(model.clone()),
        session_id: Some(uuid::Uuid::new_v4().to_string()),
        native_protocol: None,
    };
    let entries = options(selection.metadata.clone()).await?;
    if agent == "rust_agent" {
        if agent_core::providers::thinking_mode::parse_model_variant(&model).base_model != model {
            return Err("Package catalog must provide a canonical native wire model".into());
        }
        selection.native_protocol = entries
            .iter()
            .find(|e| {
                e.workspace_id == selection.workspace_id
                    && e.entitlement_id == selection.entitlement_id
            })
            .and_then(|e| e.managed.as_ref())
            .and_then(|s| s.models.iter().find(|m| m.model == model))
            .map(|m| m.protocol.clone());
    }
    let key = selection.key()?;
    Selection::parse(&key, &agent)?;
    validate_session_purchase(
        &entries,
        &selection.workspace_id,
        &selection.entitlement_id,
        &agent,
        &model,
        chrono::Utc::now().timestamp_millis(),
    )?;
    lease.check()?;
    Ok(key)
}

pub(super) fn validate_session_purchase(
    entries: &[market_connect::WorkspaceEntitlement],
    workspace: &str,
    entitlement: &str,
    agent: &str,
    model: &str,
    now: i64,
) -> Result<(), String> {
    let wire_agent = match agent {
        "claude_code" | "claude_desktop" => "claude",
        "codex" => "codex",
        "rust_agent" => "org2",
        _ => return Err("Unsupported Market session engine".into()),
    };
    if model.trim().is_empty()
        || model.len() > 256
        || !entries.iter().any(|entry| {
            entry.workspace_id == workspace
                && entry.entitlement_id == entitlement
                && entry.status == "active"
                && (agent != "rust_agent" || entry.managed.is_some())
                && entry.managed.as_ref().is_none_or(|service| {
                    !service.requires_confirmation
                        && service
                            .access
                            .as_ref()
                            .is_some_and(|a| a.status == "active")
                        && service.models.iter().any(|m| {
                            m.model == model
                                && m.availability == "available"
                                && (agent != "rust_agent"
                                    || (m.clients.iter().any(|c| c == "org2")
                                        && matches!(
                                            m.protocol.as_str(),
                                            "anthropic_messages" | "openai_responses"
                                        )))
                        })
                })
                && entry.expires_at.is_none_or(|expiry| expiry > now)
                && (agent == "rust_agent"
                    || entry
                        .models_by_agent
                        .get(wire_agent)
                        .is_some_and(|models| models.iter().any(|m| m == model)))
        })
    {
        return Err("Market purchase or model is unavailable".into());
    }
    Ok(())
}

/// External app support is stricter than ORG2's internal engine support.
/// Older non-managed purchases retain their protocol-based compatibility.
pub(super) fn validate_external_purchase(
    entries: &[market_connect::WorkspaceEntitlement],
    workspace: &str,
    entitlement: &str,
    agent: &str,
    model: &str,
    now: i64,
) -> Result<(), String> {
    validate_session_purchase(entries, workspace, entitlement, agent, model, now)?;
    let entry = entries
        .iter()
        .find(|entry| entry.workspace_id == workspace && entry.entitlement_id == entitlement)
        .ok_or("Market purchase is unavailable")?;
    if entry.managed.as_ref().is_some_and(|service| {
        !service.models.iter().any(|candidate| {
            candidate.model == model && candidate.clients.iter().any(|client| client == agent)
        })
    }) {
        return Err("Market model does not support the selected app".into());
    }
    Ok(())
}

// The generic Codex router strips its local /v1 prefix. Dynamic sources
// therefore supply a protocol base, rather than a workspace root.
pub(crate) fn protocol_base_url(workspace_root: &str, agent: &str) -> String {
    let root = workspace_root.trim_end_matches('/');
    if agent == "codex" {
        format!("{root}/v1")
    } else {
        root.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_selection_keeps_its_original_workspace() {
        let mut wire = serde_json::to_value(selection()).unwrap();
        wire.as_object_mut().unwrap().remove("workspace_id");
        let key = format!(
            "market:{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&wire).unwrap())
        );
        let parsed = Selection::parse(&key, "claude_code").unwrap();
        assert_eq!(parsed.workspace_id, "ws_fixture");
        assert_eq!(parsed.entitlement_id, "ent_fixture");
    }

    fn selection() -> Selection {
        Selection {
            metadata: ConnectionMetadata {
                identity_user_id: "11111111-1111-4111-8111-111111111111".into(),
                workspace_id: "ws_fixture".into(),
                target: market_connect::Target::Org2,
            },
            workspace_id: "ws_fixture".into(),
            entitlement_id: "ent_fixture".into(),
            model: None,
            session_id: None,
            native_protocol: None,
        }
    }
    #[test]
    fn managed_selection_is_metadata_only_and_agent_bound() {
        let key = selection().key().unwrap();
        assert_eq!(
            Selection::parse(&key, "codex")
                .unwrap()
                .metadata
                .workspace_id,
            "ws_fixture"
        );
        assert!(Selection::parse(&key, "claude_code").is_ok());
        let raw = URL_SAFE_NO_PAD
            .decode(key.strip_prefix("market:").unwrap())
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 3);
        assert!(value.get("token").is_none());
    }
    #[test]
    fn legacy_target_grant_cannot_become_a_runtime_selection() {
        let mut selection = selection();
        selection.metadata.target = market_connect::Target::Codex;
        let key = selection.key().unwrap();
        assert!(Selection::parse(&key, "codex").is_err());
        assert!(Selection::parse(&key, "claude_code").is_err());
    }
    #[test]
    fn org2_routes_to_the_selected_purchase_workspace_not_the_authorization_anchor() {
        let source = MarketSource::default();
        let selection = Selection {
            metadata: ConnectionMetadata {
                identity_user_id: "11111111-1111-4111-8111-111111111111".into(),
                workspace_id: "ws_authorization_anchor".into(),
                target: market_connect::Target::Org2,
            },
            workspace_id: "ws_selected_purchase".into(),
            entitlement_id: "ent_selected_purchase".into(),
            model: None,
            session_id: None,
            native_protocol: None,
        };
        let key = selection.key().unwrap();
        let destination = source.destination(&key, "codex").unwrap();
        assert!(destination.base_url.contains("/w/ws_selected_purchase/v1"));
        assert!(!destination.base_url.contains("ws_authorization_anchor"));
    }
    #[test]
    fn session_purchase_requires_active_exact_entitlement_and_engine_model() {
        let mut entry = market_connect::WorkspaceEntitlement {
            managed: None,
            workspace_id: "ws_fixture".into(),
            entitlement_id: "ent_allowed".into(),
            service_id: "svc_fixture".into(),
            service_name: "Fixture".into(),
            models: vec!["unscoped-model".into()],
            models_by_agent: std::collections::BTreeMap::from([
                ("claude".into(), vec!["claude-model".into()]),
                ("codex".into(), vec!["codex-model".into()]),
            ]),
            status: "active".into(),
            expires_at: Some(1000),
        };
        let check = |entry: &market_connect::WorkspaceEntitlement,
                     entitlement: &str,
                     agent: &str,
                     model: &str,
                     now| {
            validate_session_purchase(
                std::slice::from_ref(entry),
                "ws_fixture",
                entitlement,
                agent,
                model,
                now,
            )
        };
        assert!(check(&entry, "ent_allowed", "claude_code", "claude-model", 999).is_ok());
        assert!(check(&entry, "ent_allowed", "codex", "codex-model", 999).is_ok());
        for (entitlement, agent, model, now) in [
            ("ent_other", "codex", "codex-model", 999),
            ("ent_allowed", "claude_code", "codex-model", 999),
            ("ent_allowed", "codex", "unscoped-model", 999),
            ("ent_allowed", "codex", "codex-model", 1000),
            ("ent_allowed", "unknown", "codex-model", 999),
        ] {
            assert!(check(&entry, entitlement, agent, model, now).is_err());
        }
        entry.expires_at = None;
        entry.status = "revoked".into();
        assert!(check(&entry, "ent_allowed", "codex", "codex-model", 999).is_err());
    }

    #[test]
    fn external_purchase_checks_exact_client_without_restricting_internal_engine() {
        let mut entry: market_connect::WorkspaceEntitlement = serde_json::from_value(serde_json::json!({
            "workspace_id": "ws_fixture", "entitlement_id": "pa_fixture",
            "service_id": "pkg_fixture", "service_name": "Fixture",
            "models": ["claude-model"], "models_by_agent": {"claude": ["claude-model"]},
            "status": "active", "expires_at": null,
            "managed": {
                "service_id": "pkg_fixture", "title": "Fixture", "version_id": "pv_fixture",
                "requires_confirmation": false,
                "models": [{"model": "claude-model", "protocol": "anthropic_messages",
                    "clients": ["org2", "claude_code"], "pricing": {}, "availability": "available"}],
                "access": {"access_id": "pa_fixture", "service_id": "pkg_fixture", "workspace_id": "ws_fixture",
                    "status": "active", "budget_usd6": null, "billing_mode": "wallet", "revision": 1}
            }
        })).unwrap();
        let check = |entry: &market_connect::WorkspaceEntitlement, agent| {
            validate_external_purchase(
                std::slice::from_ref(entry),
                "ws_fixture",
                "pa_fixture",
                agent,
                "claude-model",
                1,
            )
        };
        assert!(validate_session_purchase(
            std::slice::from_ref(&entry),
            "ws_fixture",
            "pa_fixture",
            "rust_agent",
            "claude-model",
            1
        )
        .is_ok());
        let mut unsupported = entry.clone();
        unsupported.managed.as_mut().unwrap().models[0].clients = vec!["claude_code".into()];
        assert!(validate_session_purchase(
            &[unsupported],
            "ws_fixture",
            "pa_fixture",
            "rust_agent",
            "claude-model",
            1
        )
        .is_err());
        assert!(check(&entry, "claude_code").is_ok());
        assert!(check(&entry, "claude_desktop").is_err());
        assert!(validate_session_purchase(
            std::slice::from_ref(&entry),
            "ws_fixture",
            "pa_fixture",
            "claude_desktop",
            "claude-model",
            1
        )
        .is_ok());
        entry.managed.as_mut().unwrap().models[0]
            .clients
            .push("claude_desktop".into());
        assert!(check(&entry, "claude_desktop").is_ok());
        entry.managed.as_mut().unwrap().models[0].availability = "unavailable".into();
        assert!(check(&entry, "claude_desktop").is_err());
        entry.managed = None;
        assert!(check(&entry, "claude_desktop").is_ok());
    }

    #[test]
    fn org2_selection_accepts_only_supported_session_engines() {
        let key = selection().key().unwrap();
        for agent in ["claude_code", "claude_desktop", "codex"] {
            assert!(Selection::parse(&key, agent).is_ok());
        }
        for agent in ["org2", "", "unknown"] {
            assert!(Selection::parse(&key, agent).is_err());
        }
    }

    #[tokio::test]
    async fn legacy_target_grant_cannot_load_canonical_entitlements() {
        let mut metadata = selection().metadata;
        metadata.target = market_connect::Target::Codex;
        assert_eq!(
            options(metadata).await.err().as_deref(),
            Some("Market workspace requires ORG2 authorization")
        );
    }

    #[tokio::test]
    async fn protocol_credentials_refresh_independently_and_never_fallback_after_failure() {
        let mut state = ConnectionState::default();
        let fixture = |token: &str, expiry: i64| -> WorkspaceCredential {
            serde_json::from_value(serde_json::json!({
                "workspace_id": "ws_fixture", "entitlement_id": "ent_fixture",
                "token": token, "base_url": "https://org2-market.fly.dev/w/ws_fixture",
                "token_expires_at": expiry
            }))
            .unwrap()
        };
        let mut selection = selection();
        selection.metadata.target = market_connect::Target::Org2;
        let key = selection.key().unwrap();
        let claude = format!("claude_code:{key}");
        let codex = format!("codex:{key}");
        let first = state
            .credential(&claude, "claude_code", 0, || async {
                Ok(fixture("claude-token", 100000))
            })
            .await
            .unwrap();
        let second = state
            .credential(&codex, "codex", 0, || async {
                Ok(fixture("codex-token", 300000))
            })
            .await
            .unwrap();
        assert_eq!(first.secret, "claude-token");
        assert_eq!(second.secret, "codex-token");
        assert_eq!(
            first.destination.base_url,
            "https://org2-market.fly.dev/w/ws_fixture"
        );
        assert_eq!(
            second.destination.base_url,
            "https://org2-market.fly.dev/w/ws_fixture/v1"
        );
        let cached = state
            .credential(&claude, "claude_code", 1, || async {
                panic!("fresh credential must not mint again")
            })
            .await
            .unwrap();
        assert_eq!(cached.secret, "claude-token");
        assert!(state
            .credential(&claude, "claude_code", 50000, || async {
                Err("refresh unavailable".into())
            })
            .await
            .is_err());
        let other = state
            .credential(&codex, "codex", 50000, || async {
                panic!("Claude refresh failure must not invalidate Codex")
            })
            .await
            .unwrap();
        assert_eq!(other.secret, "codex-token");
        let refreshed = state
            .credential(&claude, "claude_code", 50000, || async {
                Ok(fixture("claude-refreshed", 400000))
            })
            .await
            .unwrap();
        assert_eq!(refreshed.secret, "claude-refreshed");
        assert_eq!(state.credentials.len(), 2);
    }

    #[test]
    fn selected_entitlement_cannot_be_an_arbitrary_path() {
        let mut selection = selection();
        selection.entitlement_id = "../../identity/logout".into();
        assert!(Selection::parse(&selection.key().unwrap(), "codex").is_err());
        assert!(Selection::parse(&"market:x".repeat(1025), "codex").is_err());
    }
    #[tokio::test]
    async fn reauthorization_holds_source_until_new_store_commit() {
        let source = MarketSource::default();
        let guard = source.retire().await;
        assert!(source.authorization.try_read().is_err());
        assert!(source.state.lock().await.connections.is_empty());
        drop(guard);
        assert!(source.authorization.try_read().is_ok());
    }
    #[tokio::test]
    async fn slow_connection_does_not_block_another_workspace_and_same_owner_serializes() {
        let source = MarketSource::default();
        let first = selection();
        let (_active, entry) = source.acquire(&first.metadata).await.unwrap();
        let _slow_operation = entry.lock().await;
        let mut other = first.metadata.clone();
        other.workspace_id = "ws_other".into();
        let (_other_active, other_entry) =
            tokio::time::timeout(std::time::Duration::from_secs(1), source.acquire(&other))
                .await
                .unwrap()
                .unwrap();
        assert!(other_entry.try_lock().is_ok());
        let (_same_active, same_entry) = source.acquire(&first.metadata).await.unwrap();
        assert!(Arc::ptr_eq(&entry, &same_entry));
        assert!(same_entry.try_lock().is_err());
        // Registry access stays short even while an owner performs I/O.
        assert!(source.state.try_lock().is_ok());
    }

    #[tokio::test]
    async fn authorization_commit_waits_for_old_requests_and_discards_their_cache() {
        let source = MarketSource::default();
        let metadata = selection().metadata;
        let (active, old_entry) = source.acquire(&metadata).await.unwrap();
        let retirement = source.retire();
        tokio::pin!(retirement);
        tokio::select! {
            biased;
            _ = &mut retirement => panic!("must wait for the old request"),
            _ = std::future::ready(()) => {}
        }
        // A queued writer excludes subsequent requests, avoiding starvation.
        assert!(source.authorization.try_read().is_err());
        drop(active);
        let commit = tokio::time::timeout(std::time::Duration::from_secs(1), &mut retirement)
            .await
            .unwrap();
        assert!(source.authorization.try_read().is_err());
        assert!(source.state.lock().await.connections.is_empty());
        drop(commit);
        let (_new_active, new_entry) = source.acquire(&metadata).await.unwrap();
        assert!(!Arc::ptr_eq(&old_entry, &new_entry));
        assert!(new_entry.lock().await.connection.is_none());
    }

    #[tokio::test]
    async fn connection_registry_stays_bounded_without_a_lifetime_session_limit() {
        let source = MarketSource::default();
        let metadata = selection().metadata;
        for _ in 0..64 {
            source.acquire(&metadata).await.unwrap();
        }
        source.acquire(&metadata).await.unwrap();
        drop(source.retire().await);
        for index in 0..32 {
            let mut owner = metadata.clone();
            owner.workspace_id = format!("ws_{index}");
            source.acquire(&owner).await.unwrap();
        }
        assert!(source.acquire(&metadata).await.is_err());
        drop(source.retire().await);
        source.acquire(&metadata).await.unwrap();
    }
    fn owner_credential() -> WorkspaceCredential {
        serde_json::from_value(serde_json::json!({
            "workspace_id": "ws_fixture", "entitlement_id": "ent_fixture", "token": "fixture-only",
            "base_url": "https://org2-market.fly.dev/w/ws_fixture", "token_expires_at": 999999
        }))
        .unwrap()
    }
    #[tokio::test]
    async fn logout_denies_cached_credentials_without_network_or_store_restore() {
        let (lease, logout) =
            super::super::owner::test_lease("11111111-1111-4111-8111-111111111111");
        let mut state = ConnectionState::default();
        state
            .authorized_credential(&lease, "key", "codex", 0, || async {
                Ok(owner_credential())
            })
            .await
            .unwrap();
        state
            .authorized_credential(&lease, "key", "codex", 1, || async {
                panic!("cache hit may not fetch")
            })
            .await
            .unwrap();
        logout();
        assert!(state
            .authorized_credential(&lease, "key", "codex", 2, || async {
                panic!("signed out may not fetch")
            })
            .await
            .is_err());
        assert!(lease
            .matches("11111111-1111-4111-8111-111111111111")
            .is_err());
    }
    #[tokio::test]
    async fn credential_response_started_before_logout_is_never_delivered_afterward() {
        let (lease, logout) =
            super::super::owner::test_lease("11111111-1111-4111-8111-111111111111");
        let mut state = ConnectionState::default();
        let result = state
            .authorized_credential(&lease, "key", "codex", 0, || async {
                logout();
                Ok(owner_credential())
            })
            .await;
        assert!(result.is_err());
    }
    #[tokio::test]
    async fn uninitialized_secondary_instance_cannot_restore_from_selection_metadata() {
        let source = MarketSource::default();
        let key = selection().key().unwrap();
        assert!(source.credential(&key, "codex").await.is_err());
        assert!(source.state.lock().await.connections.is_empty());
    }
}
