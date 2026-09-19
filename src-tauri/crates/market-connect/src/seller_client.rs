//! Short-lived seller enrollment credential. Never persisted or sent over IPC.
use crate::{
    client::{bounded_response, valid_identity},
    console_origin, control_origin, SellerRedemption,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireGrant {
    token: String,
    identity_user_id: String,
    session_version: u64,
    connection_id: String,
    provider: String,
    region: String,
    state: String,
    expires_at: String,
    market_url: String,
}
// No Debug/Serialize implementation: callers see only public enrollment metadata.
pub struct SellerConnection {
    grant: WireGrant,
    expires_at: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderStart {
    session_id: String,
    url: String,
    expires_at: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SellerBinding {
    pub binding_id: String,
    pub auth_id: String,
}
impl SellerBinding {
    fn validate(self) -> Result<Self, &'static str> {
        if [&self.binding_id, &self.auth_id].iter().any(|s| {
            s.is_empty()
                || s.len() > 256
                || !s
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        }) {
            return Err("invalid_seller_binding");
        }
        Ok(self)
    }
}
impl SellerConnection {
    fn operation_timeout(&self, operation: &str, now: i64) -> Result<Duration, &'static str> {
        let remaining = self.expires_at.saturating_sub(now);
        if remaining <= 0 {
            return Err("seller_connection_expired");
        }
        // Cold supply placement includes an adapter readiness wait of up to
        // sixty seconds. Only start needs this allowance; the capability's
        // remaining lifetime still bounds every request.
        let limit = if operation == "start" { 90_000 } else { 15_000 };
        Ok(Duration::from_millis(remaining.min(limit) as u64))
    }
    async fn operation(
        &self,
        operation: &str,
        body: serde_json::Value,
    ) -> Result<Vec<u8>, &'static str> {
        let client = reqwest::Client::builder()
            .timeout(self.operation_timeout(operation, chrono::Utc::now().timestamp_millis())?)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "seller_transport_unavailable")?;
        let response = client
            .post(format!(
                "{}/v1/console/capacity/native/{operation}",
                control_origin()?
            ))
            .bearer_auth(self.bearer()?)
            .json(&body)
            .send()
            .await
            .map_err(|_| "seller_operation_uncertain")?;
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                400 => "seller_operation_http_400",
                401 => "seller_operation_http_401",
                403 => "seller_operation_http_403",
                404 => "seller_operation_http_404",
                409 => "seller_operation_http_409",
                429 => "seller_operation_http_429",
                500 => "seller_operation_http_500",
                502 => "seller_operation_http_502",
                503 => "seller_operation_http_503",
                504 => "seller_operation_http_504",
                _ => "seller_operation_failed",
            });
        }
        bounded_response(response)
            .await
            .map_err(|_| "seller_operation_failed")
    }
    pub async fn start(&self) -> Result<crate::SellerAuthorization, &'static str> {
        let raw = self.operation("start", serde_json::json!({})).await?;
        let start: ProviderStart =
            serde_json::from_slice(&raw).map_err(|_| "invalid_seller_start")?;
        if start.session_id.is_empty() || start.session_id.len() > 256 {
            return Err("invalid_seller_start");
        }
        let provider = match self.provider() {
            "claude" => crate::SellerProvider::Claude,
            "codex" => crate::SellerProvider::Codex,
            _ => return Err("invalid_seller_provider"),
        };
        // The provider attempt cannot outlive its one-shot seller capability.
        let deadline = chrono::DateTime::parse_from_rfc3339(&start.expires_at)
            .map_err(|_| "invalid_seller_start")?
            .timestamp_millis()
            .min(self.expires_at);
        let deadline = chrono::DateTime::from_timestamp_millis(deadline)
            .ok_or("invalid_seller_start")?
            .to_rfc3339();
        crate::SellerAuthorization::parse(provider, &start.url, &deadline)
    }
    pub async fn complete(&self, redirect_url: &str) -> Result<SellerBinding, &'static str> {
        // The validated local receiver supplies this URL; never accept it via frontend IPC.
        let result = self
            .operation("complete", serde_json::json!({"redirect_url":redirect_url}))
            .await;
        match result {
            Ok(raw) => serde_json::from_slice::<SellerBinding>(&raw)
                .map_err(|_| "invalid_seller_binding")?
                .validate(),
            Err(_) => {
                // Read back an ambiguous response; never blindly resubmit completion.
                let raw = self.operation("status", serde_json::json!({})).await?;
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Status {
                    status: String,
                    result: Option<SellerBinding>,
                }
                let status: Status =
                    serde_json::from_slice(&raw).map_err(|_| "invalid_seller_status")?;
                if status.status != "completed" {
                    return Err("seller_operation_uncertain");
                }
                status
                    .result
                    .ok_or("seller_operation_uncertain")?
                    .validate()
            }
        }
    }
    pub async fn cancel(&self) -> Result<(), &'static str> {
        let raw = self.operation("cancel", serde_json::json!({})).await?;
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Cancelled {
            cancelled: bool,
        }
        if !serde_json::from_slice::<Cancelled>(&raw)
            .map_err(|_| "invalid_seller_cancel")?
            .cancelled
        {
            return Err("seller_operation_uncertain");
        }
        Ok(())
    }
    pub fn identity_user_id(&self) -> &str {
        &self.grant.identity_user_id
    }
    pub fn connection_id(&self) -> &str {
        &self.grant.connection_id
    }
    pub fn provider(&self) -> &str {
        &self.grant.provider
    }
    pub fn region(&self) -> &str {
        &self.grant.region
    }
    pub fn attempt_id(&self) -> &str {
        &self.grant.state
    }
    pub fn expired(&self) -> bool {
        chrono::Utc::now().timestamp_millis() >= self.expires_at
    }
    /// Only for native fixed-destination requests, never UI configuration.
    pub fn bearer(&self) -> Result<&str, &'static str> {
        if self.expired() {
            Err("seller_connection_expired")
        } else {
            Ok(&self.grant.token)
        }
    }
    fn parse(raw: &[u8], redemption: &SellerRedemption) -> Result<Self, &'static str> {
        if raw.len() > 16384 {
            return Err("invalid_seller_grant");
        }
        let g: WireGrant = serde_json::from_slice(raw).map_err(|_| "invalid_seller_grant")?;
        let expires_at = chrono::DateTime::parse_from_rfc3339(&g.expires_at)
            .map_err(|_| "invalid_seller_grant")?
            .timestamp_millis();
        let now = chrono::Utc::now().timestamp_millis();
        let token = g
            .token
            .strip_prefix("og2sn_")
            .ok_or("invalid_seller_grant")?;
        let connection = g
            .connection_id
            .strip_prefix("seller_native_")
            .ok_or("invalid_seller_grant")?;
        if !crate::nonce(token)
            || !valid_identity(&g.identity_user_id)
            || g.session_version > 9_007_199_254_740_991
            || connection.len() != 32
            || !connection
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || g.market_url != control_origin()?
            || g.provider != redemption.selection.provider
            || g.region != redemption.selection.region
            || g.state != redemption.attempt_id()
            || expires_at <= now
            || expires_at > now + 301_000
        {
            return Err("invalid_seller_grant");
        }
        Ok(Self {
            grant: g,
            expires_at,
        })
    }
}
impl SellerRedemption {
    pub async fn exchange(self) -> Result<SellerConnection, &'static str> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| "seller_transport_unavailable")?;
        let response = client
            .post(format!(
                "{}/api/auth/native/seller/exchange",
                console_origin()?
            ))
            .json(&self.proof)
            .send()
            .await
            .map_err(|_| "seller_exchange_failed")?;
        let raw = bounded_response(response)
            .await
            .map_err(|_| "seller_exchange_failed")?;
        SellerConnection::parse(&raw, &self)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SellerEnrollment, SellerSelection};
    fn fixture() -> (SellerRedemption, serde_json::Value) {
        let mut flow = SellerEnrollment::default();
        let request = flow
            .begin(SellerSelection {
                provider: "claude".into(),
                region: "sjc".into(),
            })
            .unwrap();
        let state = request.state;
        let proof = flow.take_redemption(&"a".repeat(43), &state).unwrap();
        let value = serde_json::json!({"token":format!("og2sn_{}","b".repeat(43)),"identity_user_id":"11111111-1111-4111-8111-111111111111","session_version":0,"connection_id":format!("seller_native_{}","c".repeat(32)),"provider":"claude","region":"sjc","state":state,"expires_at":(chrono::Utc::now()+chrono::Duration::minutes(5)).to_rfc3339(),"market_url":control_origin().unwrap()});
        (proof, value)
    }
    #[test]
    fn cold_start_timeout_is_bounded_by_the_seller_grant() {
        let (proof, value) = fixture();
        let mut grant =
            SellerConnection::parse(&serde_json::to_vec(&value).unwrap(), &proof).unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        grant.expires_at = now + 300_000;
        assert_eq!(
            grant.operation_timeout("start", now).unwrap(),
            Duration::from_secs(90)
        );
        for operation in ["complete", "status", "cancel"] {
            assert_eq!(
                grant.operation_timeout(operation, now).unwrap(),
                Duration::from_secs(15)
            );
        }
        grant.expires_at = now + 7_000;
        assert_eq!(
            grant.operation_timeout("start", now).unwrap(),
            Duration::from_secs(7)
        );
        assert_eq!(
            grant.operation_timeout("cancel", now).unwrap(),
            Duration::from_secs(7)
        );
        assert_eq!(
            grant.operation_timeout("start", now + 7_000).unwrap_err(),
            "seller_connection_expired"
        );
    }
    #[test]
    fn binding_receipts_never_accept_credentials_or_empty_ids() {
        for raw in [
            r#"{"binding_id":"","auth_id":"auth_test"}"#,
            r#"{"binding_id":"binding_test","auth_id":"auth_test","access_token":"secret"}"#,
            r#"{"binding_id":"binding_test","auth_id":"https://example.test"}"#,
        ] {
            assert!(serde_json::from_str::<SellerBinding>(raw)
                .map_err(|_| "invalid")
                .and_then(SellerBinding::validate)
                .is_err());
        }
        let receipt = serde_json::from_str::<SellerBinding>(
            r#"{"binding_id":"binding_test","auth_id":"auth_test"}"#,
        )
        .unwrap()
        .validate()
        .unwrap();
        assert_eq!(
            serde_json::to_value(receipt)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn accepts_exact_approved_context_and_expires_without_refresh() {
        let (proof, value) = fixture();
        let mut grant =
            SellerConnection::parse(&serde_json::to_vec(&value).unwrap(), &proof).unwrap();
        assert_eq!(grant.provider(), "claude");
        assert_eq!(grant.region(), "sjc");
        assert!(grant.bearer().is_ok());
        grant.expires_at = chrono::Utc::now().timestamp_millis() - 1;
        assert!(grant.bearer().is_err());
    }
    #[test]
    fn rejects_substitution_or_general_login_credentials() {
        for (key, value) in [
            ("provider", "codex"),
            ("region", "fra"),
            ("market_url", "https://attacker.invalid"),
            ("token", "og2r_not_a_seller_grant"),
            ("refresh_token", "not_allowed"),
            ("state", "wrong"),
            ("identity_user_id", "not-a-user"),
        ] {
            let (proof, mut body) = fixture();
            body[key] = value.into();
            assert!(SellerConnection::parse(&serde_json::to_vec(&body).unwrap(), &proof).is_err());
        }
    }
    #[test]
    fn rejects_lifetime_expansion_and_expired_response() {
        for seconds in [-1, 3600] {
            let (proof, mut body) = fixture();
            body["expires_at"] = (chrono::Utc::now() + chrono::Duration::seconds(seconds))
                .to_rfc3339()
                .into();
            assert!(SellerConnection::parse(&serde_json::to_vec(&body).unwrap(), &proof).is_err());
        }
    }
}
