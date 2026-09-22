use crate::{Connection, Target};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Serialize, Deserialize)]
pub struct WorkspaceEntitlement {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed: Option<crate::ManagedService>,
    #[serde(default)]
    pub workspace_id: String,
    pub entitlement_id: String,
    pub service_id: String,
    pub service_name: String,
    pub models: Vec<String>,
    pub models_by_agent: std::collections::BTreeMap<String, Vec<String>>,
    pub status: String,
    pub expires_at: Option<i64>,
}
#[derive(Deserialize)]
struct WorkspaceResponse {
    workspace: Workspace,
}
#[derive(Deserialize)]
struct WorkspaceCatalogResponse {
    workspaces: Vec<Workspace>,
}
#[derive(Deserialize)]
struct Workspace {
    workspace_id: String,
    owner_id: String,
    entitlements: Vec<WorkspaceEntitlement>,
}
/// Native-only short-lived forwarding credential, not an IPC response.
#[derive(Deserialize)]
pub struct WorkspaceCredential {
    workspace_id: String,
    entitlement_id: String,
    token: String,
    base_url: String,
    token_expires_at: i64,
}
impl WorkspaceCredential {
    pub fn bearer(&self) -> &str {
        &self.token
    }
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
    pub fn expires_at(&self) -> i64 {
        self.token_expires_at
    }
    pub(crate) fn validate(
        &self,
        workspace: &str,
        entitlement: &str,
        now: i64,
    ) -> Result<(), &'static str> {
        if self.workspace_id != workspace
            || self.entitlement_id != entitlement
            || self.base_url
                != if entitlement.starts_with("pa_") {
                    format!("{}/p/{entitlement}", crate::gateway_origin()?)
                } else {
                    format!("{}/w/{workspace}", crate::gateway_origin()?)
                }
            || !self.token.starts_with("og2t.v1.")
            || self.token.len() > 8192
            || self.token_expires_at <= now
            || self.token_expires_at > now + 3600000
        {
            return Err("invalid_workspace_credential");
        }
        Ok(())
    }
}
fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
// Provider wire protocol is independent of the clients the gateway supports.
// Older servers keep their old capabilities; new support is opt-in per model.
fn managed_models_by_agent(
    service: &crate::ManagedService,
) -> std::collections::BTreeMap<String, Vec<String>> {
    [("claude", "claude_code"), ("codex", "codex")]
        .into_iter()
        .map(|(agent, client)| {
            (
                agent.to_string(),
                service
                    .models
                    .iter()
                    .filter(|m| m.clients.iter().any(|c| c == client))
                    .map(|m| m.model.clone())
                    .collect(),
            )
        })
        .collect()
}
impl Connection {
    pub async fn entitlements(self: &Arc<Self>) -> Result<Vec<WorkspaceEntitlement>, &'static str> {
        let metadata = self.metadata();
        if metadata.target == Target::Org2 {
            return Ok(self
                .managed_services()
                .await?
                .into_iter()
                .map(|service| {
                    let by_agent = managed_models_by_agent(&service);
                    WorkspaceEntitlement {
                        workspace_id: service
                            .access
                            .as_ref()
                            .map(|a| a.workspace_id.clone())
                            .unwrap_or_else(|| metadata.workspace_id.clone()),
                        entitlement_id: service
                            .access
                            .as_ref()
                            .map(|a| a.access_id.clone())
                            .unwrap_or_else(|| service.service_id.clone()),
                        service_id: service.service_id.clone(),
                        service_name: service.title.clone(),
                        models: service.models.iter().map(|m| m.model.clone()).collect(),
                        models_by_agent: by_agent,
                        status: "active".into(),
                        expires_at: None,
                        managed: Some(service),
                    }
                })
                .collect());
        }
        let workspaces = if metadata.target == Target::Org2 {
            let raw = self.market_request("/v1/market/workspaces", None).await?;
            let response: WorkspaceCatalogResponse =
                serde_json::from_slice(&raw).map_err(|_| "invalid_workspace_response")?;
            response.workspaces
        } else {
            let raw = self
                .market_request(
                    &format!("/v1/market/workspaces/{}", metadata.workspace_id),
                    None,
                )
                .await?;
            vec![
                serde_json::from_slice::<WorkspaceResponse>(&raw)
                    .map_err(|_| "invalid_workspace_response")?
                    .workspace,
            ]
        };
        if workspaces.len() > 100 {
            return Err("workspace_catalog_limit");
        }
        let mut entries = Vec::new();
        for workspace in workspaces {
            if workspace.owner_id != metadata.identity_user_id
                || !crate::valid_workspace(&workspace.workspace_id)
                || (metadata.target != Target::Org2
                    && workspace.workspace_id != metadata.workspace_id)
                || workspace.entitlements.len() > 100
                || entries.len() + workspace.entitlements.len() > 1000
                || workspace
                    .entitlements
                    .iter()
                    .any(|e| !id(&e.entitlement_id) || !id(&e.service_id))
            {
                return Err("workspace_selection_mismatch");
            }
            entries.extend(workspace.entitlements.into_iter().map(|mut entry| {
                entry.workspace_id = workspace.workspace_id.clone();
                entry
            }));
        }
        Ok(entries)
    }
    pub async fn workspace_credential(
        self: &Arc<Self>,
        workspace: &str,
        entitlement: &str,
        agent: &str,
    ) -> Result<WorkspaceCredential, &'static str> {
        if !crate::valid_workspace(workspace)
            || !id(entitlement)
            || !matches!(agent, "claude" | "codex")
        {
            return Err("invalid_workspace_selection");
        }
        let metadata = self.metadata();
        if metadata.target != Target::Org2 && metadata.workspace_id != workspace {
            return Err("workspace_selection_mismatch");
        }
        let expected = match metadata.target {
            Target::Codex => "codex",
            Target::ClaudeCode | Target::ClaudeDesktop => "claude",
            Target::Org2 => agent,
        };
        if agent != expected {
            return Err("workspace_agent_mismatch");
        }
        let raw = self
            .market_request(
                &format!("/v1/market/entitlements/{entitlement}/token"),
                Some(serde_json::json!({"agent":agent})),
            )
            .await?;
        let credential: WorkspaceCredential =
            serde_json::from_slice(&raw).map_err(|_| "invalid_workspace_credential")?;
        credential.validate(
            workspace,
            entitlement,
            chrono::Utc::now().timestamp_millis(),
        )?;
        Ok(credential)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn managed_clients_are_not_inferred_from_provider_protocol() {
        let mut service: crate::ManagedService = serde_json::from_value(serde_json::json!({
            "service_id": "pkg_test", "title": "Test", "version_id": "pv_test",
            "requires_confirmation": false, "models": [{
                "model": "gpt-test", "protocol": "openai_responses",
                "clients": ["org2", "codex"], "pricing": {}, "availability": "available"
            }], "access": null
        }))
        .unwrap();
        assert!(managed_models_by_agent(&service)["claude"].is_empty());
        assert_eq!(managed_models_by_agent(&service)["codex"], vec!["gpt-test"]);
        service.models[0].clients.push("claude_code".into());
        assert_eq!(
            managed_models_by_agent(&service)["claude"],
            vec!["gpt-test"]
        );
        service.models[0].clients = vec!["org2".into()];
        assert!(managed_models_by_agent(&service)
            .values()
            .all(Vec::is_empty));
    }
    #[test]
    fn forwarding_credentials_cannot_change_workspace_entitlement_or_origin() {
        let mut c = WorkspaceCredential {
            workspace_id: "ws_one".into(),
            entitlement_id: "ent_one".into(),
            token: concat!("og2t.v1.", "fixture").into(),
            base_url: "https://org2-market.fly.dev/w/ws_one".into(),
            token_expires_at: 2000,
        };
        assert!(c.validate("ws_one", "ent_one", 1000).is_ok());
        assert!(c.validate("ws_other", "ent_one", 1000).is_err());
        assert!(c.validate("ws_one", "ent_other", 1000).is_err());
        assert!(c.validate("ws_one", "ent_one", 2000).is_err());
        c.base_url = "https://evil.test/w/ws_one".into();
        assert!(c.validate("ws_one", "ent_one", 1000).is_err());
    }
    #[tokio::test]
    async fn invalid_selection_fails_before_native_http_or_storage() {
        let connection = Arc::new(crate::client::tests::connection_fixture());
        assert!(connection
            .workspace_credential("../../workspace", "ent_one", "codex")
            .await
            .is_err());
        assert!(connection
            .workspace_credential("ws_one", "../../account", "codex")
            .await
            .is_err());
        assert!(connection
            .workspace_credential("ws_one", "ent_one", "shell")
            .await
            .is_err());
    }
}
