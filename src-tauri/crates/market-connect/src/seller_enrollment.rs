//! One App-initiated seller PKCE proof. No website or OS handoff is required.
use crate::{nonce, random_nonce, ExchangeProof};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

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
#[derive(Serialize)]
pub struct SellerProof {
    pub provider: String,
    pub region: String,
    pub state: String,
    pub challenge: String,
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
// No Debug/Serialize: the redemption contains the native-only verifier.
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
    pub fn begin(&mut self, selection: SellerSelection) -> Result<SellerProof, &'static str> {
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
        let request = SellerProof {
            provider: selection.provider.clone(),
            region: selection.region.clone(),
            state: state.clone(),
            challenge: URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
        };
        self.pending = Some(Pending {
            selection,
            state,
            verifier,
            started: Instant::now(),
        });
        Ok(request)
    }
    pub fn take_redemption(
        &mut self,
        code: &str,
        state: &str,
    ) -> Result<SellerRedemption, &'static str> {
        let pending = self
            .pending
            .as_ref()
            .ok_or("no_pending_seller_connection")?;
        if !nonce(code)
            || state != pending.state
            || pending.started.elapsed() >= Duration::from_secs(300)
        {
            return Err("invalid_seller_callback");
        }
        let pending = self.pending.take().ok_or("no_pending_seller_connection")?;
        self.exchanging = Some(state.into());
        Ok(SellerRedemption {
            selection: pending.selection,
            proof: ExchangeProof {
                code: code.into(),
                state: state.into(),
                verifier: pending.verifier,
            },
        })
    }
    pub fn finish(&mut self, attempt: &str) {
        if self.exchanging.as_deref() == Some(attempt) {
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
    #[test]
    fn native_proof_is_single_use_and_never_exposes_verifier() {
        let mut flow = SellerEnrollment::default();
        let request = flow.begin(selection()).unwrap();
        assert!(flow.begin(selection()).is_err());
        assert_eq!(
            serde_json::to_value(&request)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            4
        );
        assert!(flow
            .take_redemption(&"a".repeat(43), &"b".repeat(43))
            .is_err());
        let redemption = flow
            .take_redemption(&"a".repeat(43), &request.state)
            .unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(redemption.proof.verifier.as_bytes())),
            request.challenge
        );
        assert!(flow
            .take_redemption(&"a".repeat(43), &request.state)
            .is_err());
        assert!(flow.begin(selection()).is_err());
        flow.finish(&request.state);
        assert!(flow.begin(selection()).is_ok());
    }
    #[test]
    fn invalid_selection_expiry_and_cancel_cannot_start_supply() {
        let mut flow = SellerEnrollment::default();
        assert!(flow
            .begin(SellerSelection {
                provider: "other".into(),
                region: "sjc".into()
            })
            .is_err());
        assert!(flow
            .begin(SellerSelection {
                provider: "claude".into(),
                region: "../x".into()
            })
            .is_err());
        let request = flow.begin(selection()).unwrap();
        flow.pending.as_mut().unwrap().started = Instant::now() - Duration::from_secs(301);
        assert!(flow
            .take_redemption(&"a".repeat(43), &request.state)
            .is_err());
        let request = flow.begin(selection()).unwrap();
        flow.cancel();
        assert!(flow
            .take_redemption(&"a".repeat(43), &request.state)
            .is_err());
    }
}
