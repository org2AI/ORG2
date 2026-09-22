//! ORG2 Market enrollment protocol. No Tauri, UI, KeyVault, billing or config
//! writer dependency. The desktop host owns secure storage and client adapters.
mod services;
pub use services::{ActivateService, ManagedAccess, ManagedModel, ManagedService};
mod client;
mod environment;
mod process_lock;
mod workspace;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
pub use client::{AccessCredential, Connection, ConnectionMetadata, Grant};
pub use environment::{app_scheme, console_origin, control_origin, gateway_origin};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use url::Url;
pub use workspace::{WorkspaceCredential, WorkspaceEntitlement};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Target {
    #[serde(rename = "claude-code")]
    ClaudeCode,
    #[serde(rename = "claude-app")]
    ClaudeDesktop,
    #[serde(rename = "codex")]
    Codex,
    #[serde(rename = "org2")]
    Org2,
}
impl Target {
    pub fn wire_name(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::ClaudeDesktop => "claude-app",
            Self::Codex => "codex",
            Self::Org2 => "org2",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub workspace_id: String,
    pub target: Target,
}
fn nonce(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn valid_workspace(value: &str) -> bool {
    value.starts_with("ws_")
        && (4..=123).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn random_nonce() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
fn envelope(raw: &str, path: &str) -> Option<Url> {
    if raw.len() > 2048 {
        return None;
    }
    let u = Url::parse(raw).ok()?;
    (u.scheme() == app_scheme().ok()?
        && u.host_str() == Some("market")
        && u.path() == path
        && u.username().is_empty()
        && u.password().is_none()
        && u.port().is_none()
        && u.fragment().is_none())
    .then_some(u)
}
pub fn parse_selection(raw: &str) -> Option<Selection> {
    let u = envelope(raw, "/connect")?;
    let values: Vec<_> = u.query_pairs().collect();
    if values.len() != 2 {
        return None;
    }
    let workspace = values
        .iter()
        .find(|(k, _)| k == "workspace_id")?
        .1
        .to_string();
    if !valid_workspace(&workspace) {
        return None;
    }
    let target = match values.iter().find(|(k, _)| k == "target")?.1.as_ref() {
        "claude-code" => Target::ClaudeCode,
        "claude-app" => Target::ClaudeDesktop,
        "codex" => Target::Codex,
        "org2" => Target::Org2,
        _ => return None,
    };
    Some(Selection {
        workspace_id: workspace,
        target,
    })
}
// Secrets intentionally implement neither Debug nor Serialize to the frontend.
struct Pending {
    selection: Selection,
    verifier: String,
    state: String,
    started: Instant,
}
#[derive(Default)]
pub struct Enrollment {
    pending: Option<Pending>,
    exchanging: Option<String>,
}
#[derive(Serialize)]
pub struct ExchangeProof {
    code: String,
    verifier: String,
    state: String,
}
pub struct Redemption {
    pub selection: Selection,
    pub proof: ExchangeProof,
}
impl Redemption {
    pub fn attempt_id(&self) -> &str {
        &self.proof.state
    }
}
impl Enrollment {
    pub fn cancel_attempt(&mut self, attempt: &str) {
        if self.exchanging.as_deref() == Some(attempt) {
            self.exchanging = None;
        }
    }

    pub fn begin(&mut self, mut selection: Selection) -> Result<String, &'static str> {
        if self.exchanging.is_some() {
            return Err("connection_in_progress");
        }
        if !valid_workspace(&selection.workspace_id) {
            return Err("invalid_workspace");
        }
        // External-app targets remain readable for legacy links and stored
        // grants, but every new buyer authorization belongs to ORG2. Native
        // app configuration is a separate, reversible projection of this
        // canonical grant.
        selection.target = Target::Org2;
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.started.elapsed() < Duration::from_secs(300))
        {
            return Err("connection_in_progress");
        }
        let verifier = random_nonce();
        let state = random_nonce();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = Url::parse(console_origin()?).map_err(|_| "invalid_console")?;
        url.set_path("/buyer/connect/authorize");
        url.query_pairs_mut()
            .append_pair("workspace_id", &selection.workspace_id)
            .append_pair("target", selection.target.wire_name())
            .append_pair("challenge", &challenge)
            .append_pair("state", &state);
        self.pending = Some(Pending {
            selection,
            verifier,
            state,
            started: Instant::now(),
        });
        Ok(url.to_string())
    }
    pub fn cancel(&mut self) {
        self.pending = None;
        self.exchanging = None;
    }
    /// Run on the host's serialized enrollment owner, off the async executor.
    /// Cancellation retires the attempt before any late response can persist.
    pub fn store_authorized(
        &mut self,
        grant: Grant,
        instance_scope: &str,
        persist_index: impl FnOnce() -> Result<(), &'static str>,
    ) -> Result<ConnectionMetadata, &'static str> {
        self.commit_authorized(grant, persist_index, |grant| {
            grant.store(instance_scope).map(|_| ())
        })
    }
    fn commit_authorized(
        &mut self,
        grant: Grant,
        persist_index: impl FnOnce() -> Result<(), &'static str>,
        persist_grant: impl FnOnce(&Grant) -> Result<(), &'static str>,
    ) -> Result<ConnectionMetadata, &'static str> {
        if self.exchanging.as_deref() != Some(grant.enrollment_state()) {
            return Err("connection_attempt_retired");
        }
        self.exchanging = None;
        // Publish discoverable, non-secret metadata before the OS-store write.
        // A failed/interrupted grant write leaves an entry that status can show
        // as requiring authorization and disconnect can safely remove.
        persist_index()?;
        persist_grant(&grant)?;
        Ok(grant.metadata())
    }
    /// The host serializes access. Take before HTTP so duplicate callbacks cannot
    /// perform parallel redemption; ambiguous response loss requires new approval.
    pub fn take_redemption(&mut self, raw: &str) -> Result<Redemption, &'static str> {
        let u = envelope(raw, "/authorized").ok_or("invalid_callback")?;
        let pairs: Vec<_> = u.query_pairs().collect();
        if pairs.len() != 2 {
            return Err("invalid_callback");
        }
        let code = pairs
            .iter()
            .find(|(k, _)| k == "code")
            .map(|(_, v)| v.to_string())
            .ok_or("invalid_callback")?;
        let state = pairs
            .iter()
            .find(|(k, _)| k == "state")
            .map(|(_, v)| v.to_string())
            .ok_or("invalid_callback")?;
        let pending = self.pending.as_ref().ok_or("no_pending_connection")?;
        if !nonce(&code)
            || state != pending.state
            || pending.started.elapsed() >= Duration::from_secs(300)
        {
            return Err("invalid_callback");
        }
        let p = self.pending.take().ok_or("no_pending_connection")?;
        self.exchanging = Some(p.state.clone());
        Ok(Redemption {
            selection: p.selection,
            proof: ExchangeProof {
                code,
                verifier: p.verifier,
                state: p.state,
            },
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn legacy_selection() -> Selection {
        Selection {
            workspace_id: "ws_example".into(),
            target: Target::ClaudeCode,
        }
    }
    fn selection() -> Selection {
        Selection {
            workspace_id: "ws_example".into(),
            target: Target::Org2,
        }
    }
    #[test]
    fn links_cannot_select_an_executable_origin_or_directory() {
        assert_eq!(
            parse_selection("orgii://market/connect?workspace_id=ws_example&target=claude-code"),
            Some(legacy_selection())
        );
        for raw in ["orgii://market/connect?workspace_id=ws_example&target=shell","orgii://market/connect?workspace_id=../../secret&target=codex","orgii://market/connect?workspace_id=ws_example&target=codex&endpoint=https://evil.test","orgii://market/connect?workspace_id=ws_example&target=codex&target=org2"] {assert!(parse_selection(raw).is_none());}
    }
    #[test]
    fn legacy_link_target_is_accepted_but_new_enrollment_is_org2_scoped() {
        let mut enrollment = Enrollment::default();
        let url = Url::parse(&enrollment.begin(legacy_selection()).unwrap()).unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(params["target"], "org2");
        let callback = format!(
            "orgii://market/authorized?code={}&state={}",
            "c".repeat(43),
            params["state"]
        );
        assert_eq!(
            enrollment.take_redemption(&callback).unwrap().selection,
            selection()
        );
    }
    #[test]
    fn one_shot_pkce_handoff() {
        let mut e = Enrollment::default();
        let url = Url::parse(&e.begin(selection()).unwrap()).unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert!(!params.contains_key("verifier"));
        let callback = format!(
            "orgii://market/authorized?code={}&state={}",
            "c".repeat(43),
            params["state"]
        );
        assert!(e
            .take_redemption(&(callback.clone() + "&origin=https://evil.test"))
            .is_err());
        let r = e.take_redemption(&callback).unwrap();
        assert_eq!(r.selection, selection());
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(r.proof.verifier.as_bytes())),
            params["challenge"]
        );
        assert!(e.take_redemption(&callback).is_err());
    }
    #[test]
    fn cancellation_and_overlapping_workspaces() {
        let mut e = Enrollment::default();
        e.begin(selection()).unwrap();
        assert!(e.begin(selection()).is_err());
        e.cancel();
        assert!(e.begin(selection()).is_ok());
    }
    #[test]
    fn exchange_keeps_enrollment_exclusive_until_cancelled() {
        let mut e = Enrollment::default();
        let url = Url::parse(&e.begin(selection()).unwrap()).unwrap();
        let state = url
            .query_pairs()
            .find(|(k, _)| k == "state")
            .unwrap()
            .1
            .into_owned();
        let callback = format!(
            "orgii://market/authorized?code={}&state={state}",
            "c".repeat(43)
        );
        e.take_redemption(&callback).unwrap();
        assert!(e.begin(selection()).is_err());
        e.cancel();
        assert!(e.begin(selection()).is_ok());
        assert!(e.take_redemption(&callback).is_err());
    }
}

/// Buyer renewal requires native persistent credentials.
pub const fn buyer_credential_store_supported() -> bool {
    cfg!(any(target_os = "macos", windows))
}
pub fn require_buyer_credential_store() -> Result<(), String> {
    if buyer_credential_store_supported() {
        Ok(())
    } else {
        Err("market_buyer_credential_store_unavailable".into())
    }
}
#[cfg(test)]
mod platform_capability_tests {
    #[test]
    fn storage_gate_matches_compiled_platform_before_enrollment() {
        assert_eq!(
            super::require_buyer_credential_store().is_ok(),
            cfg!(any(target_os = "macos", windows))
        );
        #[cfg(target_os = "linux")]
        assert_eq!(
            super::require_buyer_credential_store().unwrap_err(),
            "market_buyer_credential_store_unavailable"
        );
    }
}
