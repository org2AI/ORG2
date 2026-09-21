//! Buyer-facing managed service protocol. Credentials stay in native memory.
use crate::{Connection, Target};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Serialize, Deserialize)]
pub struct ManagedModel {
    pub model: String,
    pub protocol: String,
    pub clients: Vec<String>,
    pub pricing: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pricing_range: Option<ManagedModelPriceRange>,
    pub availability: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct ManagedModelPriceRange {
    pub min: serde_json::Value,
    pub max: serde_json::Value,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct ManagedAccess {
    pub access_id: String,
    pub service_id: String,
    pub workspace_id: String,
    pub status: String,
    pub budget_usd6: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_mode: Option<String>,
    pub revision: u32,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct ManagedPriceRange {
    pub min: u32,
    pub max: u32,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct ManagedService {
    pub service_id: String,
    pub title: String,
    pub version_id: String,
    pub requires_confirmation: bool,
    #[serde(default)]
    pub wallet_billing_supported: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price_range_bps: Option<ManagedPriceRange>,
    pub models: Vec<ManagedModel>,
    pub access: Option<ManagedAccess>,
}
#[derive(Deserialize)]
struct Catalog {
    schema_version: u32,
    #[serde(default)]
    billing_modes: Vec<String>,
    services: Vec<ManagedService>,
    next_cursor: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ActivateService {
    pub service_id: String,
    pub expected_version_id: String,
    pub expected_revision: Option<u32>,
    pub billing_mode: String,
    pub confirm_usage: bool,
}
#[derive(Deserialize)]
struct Activated {
    access: ManagedAccess,
}
pub fn valid_service_id(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value.len() <= 100
        && value.len() > prefix.len()
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
impl ManagedAccess {
    fn valid(&self, service: &str) -> bool {
        self.service_id == service
            && valid_service_id(&self.access_id, "pa_")
            && crate::valid_workspace(&self.workspace_id)
            && match (
                self.billing_mode.as_deref().unwrap_or("package_limit"),
                self.budget_usd6,
            ) {
                ("wallet", None) => true,
                ("package_limit", Some(budget)) => budget > 0 && budget <= 9_007_199_254_740_991,
                _ => false,
            }
            && self.revision > 0
            && matches!(self.status.as_str(), "active" | "revoked")
    }
}
impl Connection {
    pub async fn managed_services(self: &Arc<Self>) -> Result<Vec<ManagedService>, &'static str> {
        if self.metadata().target != Target::Org2 {
            return Err("service_catalog_requires_org2");
        }
        let mut result = Vec::new();
        let mut cursor = String::new();
        let mut seen = std::collections::HashSet::new();
        loop {
            let raw = self
                .market_request(
                    &format!(
                        "/v1/market/packages?limit=50&wallet_billing=1{}",
                        if cursor.is_empty() {
                            String::new()
                        } else {
                            format!("&cursor={cursor}")
                        }
                    ),
                    None,
                )
                .await?;
            let mut page: Catalog =
                serde_json::from_slice(&raw).map_err(|_| "invalid_service_catalog")?;
            if page.schema_version != 1 || result.len() + page.services.len() > 100 {
                return Err("service_catalog_limit");
            }
            for service in &mut page.services {
                service.wallet_billing_supported =
                    page.billing_modes.iter().any(|mode| mode == "wallet");
                if !valid_service_id(&service.service_id, "pkg_")
                    || !seen.insert(service.service_id.clone())
                    || service.title.is_empty()
                    || service.title.len() > 480
                    || !valid_service_id(&service.version_id, "pv_")
                    || service
                        .price_range_bps
                        .as_ref()
                        .is_some_and(|range| range.min > range.max)
                    || service.models.is_empty()
                    || service.models.len() > 64
                    || service
                        .access
                        .as_ref()
                        .is_some_and(|a| !a.valid(&service.service_id))
                    || service.models.iter().any(|m| {
                        m.model.is_empty()
                            || m.model.len() > 256
                            || !matches!(
                                m.protocol.as_str(),
                                "anthropic_messages" | "openai_responses"
                            )
                            || !m.pricing.is_object()
                    })
                {
                    return Err("invalid_service_catalog");
                }
            }
            result.extend(page.services);
            match page.next_cursor {
                None => return Ok(result),
                Some(next) if valid_service_id(&next, "pkg_") && next > cursor => cursor = next,
                _ => return Err("invalid_service_cursor"),
            }
        }
    }
    pub async fn activate_service(
        self: &Arc<Self>,
        request: &ActivateService,
    ) -> Result<ManagedAccess, &'static str> {
        if self.metadata().target != Target::Org2
            || !request.confirm_usage
            || request.billing_mode != "wallet"
            || !valid_service_id(&request.service_id, "pkg_")
            || !valid_service_id(&request.expected_version_id, "pv_")
        {
            return Err("invalid_usage_authorization");
        }
        let raw = self
            .market_request(
                "/v1/market/package-access",
                Some(serde_json::to_value(request).map_err(|_| "invalid_usage_authorization")?),
            )
            .await?;
        let response: Activated =
            serde_json::from_slice(&raw).map_err(|_| "invalid_usage_authorization")?;
        if !response.access.valid(&request.service_id)
            || response.access.status != "active"
            || response.access.billing_mode.as_deref() != Some("wallet")
        {
            return Err("invalid_usage_authorization");
        }
        Ok(response.access)
    }
    pub async fn service_credential(
        self: &Arc<Self>,
        workspace: &str,
        access: &str,
        model: &str,
        session: &str,
    ) -> Result<crate::WorkspaceCredential, &'static str> {
        if !crate::valid_workspace(workspace)
            || !valid_service_id(access, "pa_")
            || model.is_empty()
            || model.len() > 256
            || session.is_empty()
            || session.len() > 128
        {
            return Err("invalid_service_selection");
        }
        let raw = self
            .market_request(
                &format!("/v1/market/package-access/{access}/token"),
                Some(serde_json::json!({"model":model,"session_id":session})),
            )
            .await?;
        let response: serde_json::Value =
            serde_json::from_slice(&raw).map_err(|_| "invalid_service_credential")?;
        if response["schema_version"] != 1
            || response["access"]["access_id"] != access
            || response["access"]["workspace_id"] != workspace
            || response["model"]["model"] != model
            || response["session_id"] != session
        {
            return Err("invalid_service_credential");
        }
        let expiry = chrono::DateTime::parse_from_rfc3339(
            response["expires_at"]
                .as_str()
                .ok_or("invalid_service_credential")?,
        )
        .map_err(|_| "invalid_service_credential")?
        .timestamp_millis();
        let credential: crate::WorkspaceCredential = serde_json::from_value(serde_json::json!({"workspace_id":workspace,"entitlement_id":access,"token":response["token"],"base_url":response["base_url"],"token_expires_at":expiry})).map_err(|_| "invalid_service_credential")?;
        credential.validate(workspace, access, chrono::Utc::now().timestamp_millis())?;
        Ok(credential)
    }
}
