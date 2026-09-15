//! Browser approval for one seller connection; secrets remain in native memory.
use crate::{envelope, nonce, random_nonce, ExchangeProof, CONSOLE};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use url::Url;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SellerSelection {
    pub provider: String,
    pub region: String,
}
impl SellerSelection {
    fn valid(&self) -> bool {
        matches!(self.provider.as_str(), "claude" | "codex")
            && (1..=32).contains(&self.region.len())
            && self
                .region
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && self.region.as_bytes()[0] != b'-'
    }
}
pub fn parse_seller_selection(raw: &str) -> Option<SellerSelection> {
    let url = envelope(raw, "/seller/connect")?;
    let pairs: Vec<_> = url.query_pairs().collect();
    if pairs.len() != 2 {
        return None;
    }
    let selection = SellerSelection {
        provider: pairs.iter().find(|(k, _)| k == "provider")?.1.to_string(),
        region: pairs.iter().find(|(k, _)| k == "region")?.1.to_string(),
    };
    selection.valid().then_some(selection)
}
struct Pending {
    selection: SellerSelection,
    state: String,
    verifier: String,
    started: Instant,
}
#[derive(Default)]
pub struct SellerEnrollment {
    pending: Option<Pending>,
    exchanging: Option<String>,
}
// Intentionally not Debug: proof contains the single-use code and PKCE verifier.
pub struct SellerRedemption {
    pub selection: SellerSelection,
    pub proof: ExchangeProof,
}
impl SellerRedemption {
    pub fn attempt_id(&self) -> &str {
        &self.proof.state
    }
}
impl SellerEnrollment {
    pub fn begin(&mut self, selection: SellerSelection) -> Result<String, &'static str> {
        if self.exchanging.is_some()
            || self
                .pending
                .as_ref()
                .is_some_and(|p| p.started.elapsed() < Duration::from_secs(300))
        {
            return Err("seller_connection_in_progress");
        }
        if !selection.valid() {
            return Err("invalid_seller_selection");
        }
        let verifier = random_nonce();
        let state = random_nonce();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = Url::parse(CONSOLE).map_err(|_| "invalid_console")?;
        url.set_path("/seller/accounts/authorize");
        url.query_pairs_mut()
            .append_pair("provider", &selection.provider)
            .append_pair("region", &selection.region)
            .append_pair("state", &state)
            .append_pair("challenge", &challenge);
        self.pending = Some(Pending {
            selection,
            state,
            verifier,
            started: Instant::now(),
        });
        Ok(url.to_string())
    }
    pub fn take_redemption(&mut self, raw: &str) -> Result<SellerRedemption, &'static str> {
        let url = envelope(raw, "/seller/authorized").ok_or("invalid_seller_callback")?;
        let pairs: Vec<_> = url.query_pairs().collect();
        if pairs.len() != 2 {
            return Err("invalid_seller_callback");
        }
        let code = pairs
            .iter()
            .find(|(k, _)| k == "code")
            .map(|(_, v)| v.to_string())
            .ok_or("invalid_seller_callback")?;
        let state = pairs
            .iter()
            .find(|(k, _)| k == "state")
            .map(|(_, v)| v.to_string())
            .ok_or("invalid_seller_callback")?;
        let pending = self
            .pending
            .as_ref()
            .ok_or("no_pending_seller_connection")?;
        if !nonce(&code)
            || state != pending.state
            || pending.started.elapsed() >= Duration::from_secs(300)
        {
            return Err("invalid_seller_callback");
        }
        let pending = self.pending.take().ok_or("no_pending_seller_connection")?;
        self.exchanging = Some(state.clone());
        Ok(SellerRedemption {
            selection: pending.selection,
            proof: ExchangeProof {
                code,
                verifier: pending.verifier,
                state,
            },
        })
    }
    pub fn is_current(&self, attempt: &str) -> bool {
        self.exchanging.as_deref() == Some(attempt)
    }
    pub fn finish(&mut self, attempt: &str) {
        if self.is_current(attempt) {
            self.exchanging = None;
        }
    }
    pub fn cancel(&mut self) {
        self.pending = None;
        self.exchanging = None;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn selection() -> SellerSelection {
        SellerSelection {
            provider: "claude".into(),
            region: "sjc".into(),
        }
    }
    fn callback(url: &str) -> String {
        let u = Url::parse(url).unwrap();
        let state = u.query_pairs().find(|(k, _)| k == "state").unwrap().1;
        format!(
            "orgii://market/seller/authorized?code={}&state={state}",
            "a".repeat(43)
        )
    }
    #[test]
    fn selection_link_has_only_provider_and_region() {
        assert_eq!(
            parse_seller_selection("orgii://market/seller/connect?provider=claude&region=sjc"),
            Some(selection())
        );
        for raw in [
            "orgii://market/seller/connect?provider=claude&region=sjc&command=sh",
            "orgii://market/seller/connect?provider=claude&region=../ssh",
            "orgii://market/seller/connect?provider=claude&provider=codex",
            "orgii://market/seller/connect?provider=unknown&region=sjc",
        ] {
            assert!(parse_seller_selection(raw).is_none());
        }
    }
    #[test]
    fn proof_is_native_only_and_callback_is_single_use() {
        let mut flow = SellerEnrollment::default();
        let url = flow.begin(selection()).unwrap();
        assert!(url.starts_with("https://market.org2.dev/seller/accounts/authorize?"));
        assert!(!url.contains("verifier"));
        assert!(flow.begin(selection()).is_err());
        let raw = callback(&url);
        let r = flow.take_redemption(&raw).unwrap();
        assert_eq!(r.selection, selection());
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(r.proof.verifier.as_bytes()));
        assert!(url.contains(&challenge));
        assert!(flow.is_current(r.attempt_id()));
        assert!(flow.take_redemption(&raw).is_err());
        flow.finish(r.attempt_id());
        assert!(!flow.is_current(r.attempt_id()));
    }
    #[test]
    fn bad_state_does_not_consume_and_cancel_retires_late_completion() {
        let mut flow = SellerEnrollment::default();
        let url = flow.begin(selection()).unwrap();
        let raw = callback(&url);
        assert!(flow
            .take_redemption(&format!("{raw}&state=duplicate"))
            .is_err());
        assert!(flow
            .take_redemption(&raw.replace("state=", "unknown="))
            .is_err());
        let proof = flow.take_redemption(&raw).unwrap();
        flow.cancel();
        assert!(!flow.is_current(proof.attempt_id()));
        assert!(flow.begin(selection()).is_ok());
        flow.finish(proof.attempt_id());
        assert!(flow.begin(selection()).is_err());
    }
    #[test]
    fn expired_approval_cannot_redeem() {
        let mut flow = SellerEnrollment::default();
        let url = flow.begin(selection()).unwrap();
        flow.pending.as_mut().unwrap().started = Instant::now() - Duration::from_secs(301);
        assert!(flow.take_redemption(&callback(&url)).is_err());
        assert!(flow.begin(selection()).is_ok());
    }
}
