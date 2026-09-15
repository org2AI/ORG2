use crate::{Connection, Target};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Serialize, Deserialize)]
pub struct WorkspaceEntitlement {
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
    fn validate(&self, workspace: &str, entitlement: &str, now: i64) -> Result<(), &'static str> {
        if self.workspace_id != workspace
            || self.entitlement_id != entitlement
            || self.base_url != format!("https://org2-market.fly.dev/w/{workspace}")
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
impl Connection {
    pub async fn entitlements(self: &Arc<Self>) -> Result<Vec<WorkspaceEntitlement>, &'static str> {
        let metadata = self.metadata();
        let raw = self
            .market_request(
                &format!("/v1/market/workspaces/{}", metadata.workspace_id),
                None,
            )
            .await?;
        let response: WorkspaceResponse =
            serde_json::from_slice(&raw).map_err(|_| "invalid_workspace_response")?;
        if response.workspace.workspace_id != metadata.workspace_id
            || response.workspace.owner_id != metadata.identity_user_id
            || response.workspace.entitlements.len() > 100
            || response
                .workspace
                .entitlements
                .iter()
                .any(|e| !id(&e.entitlement_id) || !id(&e.service_id))
        {
            return Err("workspace_selection_mismatch");
        }
        Ok(response.workspace.entitlements)
    }
    pub async fn workspace_credential(
        self: &Arc<Self>,
        entitlement: &str,
        agent: &str,
    ) -> Result<WorkspaceCredential, &'static str> {
        if !id(entitlement) || !matches!(agent, "claude" | "codex") {
            return Err("invalid_workspace_selection");
        }
        let metadata = self.metadata();
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
            &metadata.workspace_id,
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
            .workspace_credential("../../account", "codex")
            .await
            .is_err());
        assert!(connection
            .workspace_credential("ent_one", "shell")
            .await
            .is_err());
        assert!(connection
            .workspace_credential("ent_one", "claude")
            .await
            .is_err());
    }
}
