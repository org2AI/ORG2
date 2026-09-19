//! Coordination with the Claude Code CLI's own login (macOS Keychain /
//! Windows Credential Manager / `.credentials.json`) for accounts that were
//! copied from it.
//!
//! Same hazard as `codex_cli_auth`: a scanned account holds a copy of the
//! CLI's single-use rotating refresh token. Before spending a linked key's
//! token, and again when an exchange reports it invalid, the vault re-reads the
//! CLI login and adopts the tokens the CLI already rotated.
//!
//! Two differences from Codex shape this module:
//! - Claude tokens are opaque, so "same account" can only be proven by asking
//!   the profile endpoint who the candidate token belongs to and comparing with
//!   the identity stored on the key.
//! - Reading the login can raise an OS credential-store prompt, so it only
//!   happens for keys that may have come from that store: never for an account
//!   recorded as signed in through the vault.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Duration as ChronoDuration, Utc};

use crate::auto_detect::{
    fetch_claude_code_account_metadata_at, read_local_claude_code_login, LocalClaudeCodeLogin,
    LOCAL_CLAUDE_CODE_PROFILE_URL,
};

use super::super::types::{
    ModelKey, ACCOUNT_SETUP_METHOD_AUTODETECT, ACCOUNT_SETUP_METHOD_METADATA_KEY,
};
use super::claude_oauth::{
    CLAUDE_CODE_EXPIRES_AT_ENV, CLAUDE_CODE_EXPIRES_IN_ENV, CLAUDE_CODE_REFRESH_TOKEN_ENV,
};
use super::{KeyService, OAUTH_REFRESH_EXPIRY_SKEW_SECONDS};

/// A credential-store prompt nobody answers must not stall a session launch.
const LOCAL_LOGIN_READ_TIMEOUT: Duration = Duration::from_secs(20);

/// Identity fields a scan or sign-in stores on the key, strongest first.
const IDENTITY_FIELDS: [&str; 2] = ["organization_uuid", "email"];

type LocalLoginReader = Arc<dyn Fn() -> Option<LocalClaudeCodeLogin> + Send + Sync>;

/// Where the refresh path finds the Claude Code CLI's login and proves whose
/// it is. Tests inject both.
#[derive(Clone)]
pub(crate) struct ClaudeCliLoginSource {
    read_login: LocalLoginReader,
    profile_url: String,
}

impl ClaudeCliLoginSource {
    pub(crate) fn new(
        read_login: impl Fn() -> Option<LocalClaudeCodeLogin> + Send + Sync + 'static,
        profile_url: String,
    ) -> Self {
        Self {
            read_login: Arc::new(read_login),
            profile_url,
        }
    }

    /// The user's real Claude Code login. Unit tests never resolve it.
    pub(super) fn local() -> Option<Self> {
        if cfg!(test) {
            return None;
        }
        Some(Self::new(
            read_local_claude_code_login,
            LOCAL_CLAUDE_CODE_PROFILE_URL.to_string(),
        ))
    }

    async fn read(&self) -> Option<LocalClaudeCodeLogin> {
        let read_login = Arc::clone(&self.read_login);
        let task = tokio::task::spawn_blocking(move || read_login());
        match tokio::time::timeout(LOCAL_LOGIN_READ_TIMEOUT, task).await {
            Ok(Ok(login)) => login,
            Ok(Err(err)) => {
                tracing::warn!("[key-vault] Claude Code local login read task failed: {err}");
                None
            }
            Err(_) => {
                tracing::warn!("[key-vault] Claude Code local login read timed out");
                None
            }
        }
    }
}

fn recorded_setup_method(key: &ModelKey) -> Option<&str> {
    key.account_metadata
        .get(ACCOUNT_SETUP_METHOD_METADATA_KEY)
        .map(String::as_str)
}

/// Recorded as copied from the CLI login: reload it before every exchange.
pub(super) fn is_linked_to_claude_cli(key: &ModelKey) -> bool {
    recorded_setup_method(key) == Some(ACCOUNT_SETUP_METHOD_AUTODETECT)
}

/// Whether a dead refresh token may be recovered from the CLI login: linked
/// accounts, and accounts saved before the setup method was recorded (their
/// origin is unknown). An account recorded with any other method never came
/// from the credential store, so it is never read on that account's behalf.
pub(super) fn may_recover_from_claude_cli(key: &ModelKey) -> bool {
    matches!(
        recorded_setup_method(key),
        None | Some(ACCOUNT_SETUP_METHOD_AUTODETECT)
    )
}

/// Fails closed: every identity field the key stores must match, and the key
/// must store at least one.
fn same_claude_account(key: &ModelKey, candidate: &HashMap<String, String>) -> bool {
    let mut compared = false;
    for field in IDENTITY_FIELDS {
        let Some(expected) = key.account_metadata.get(field) else {
            continue;
        };
        if candidate.get(field) != Some(expected) {
            return false;
        }
        compared = true;
    }
    compared
}

/// The CLI's login, when it is a usable replacement for the key's tokens: a
/// different, unexpired access token proven to belong to the same account.
pub(super) async fn adoptable_claude_cli_login(
    key: &ModelKey,
    rejected_access_token: &str,
    source: &ClaudeCliLoginSource,
) -> Option<LocalClaudeCodeLogin> {
    let login = source.read().await?;
    if login.access_token == rejected_access_token
        || key.session_token.as_deref() == Some(login.access_token.as_str())
    {
        return None;
    }
    let expires_at = chrono::DateTime::<Utc>::from_timestamp_millis(login.expires_at_millis?)?;
    if Utc::now() + ChronoDuration::seconds(OAUTH_REFRESH_EXPIRY_SKEW_SECONDS) >= expires_at {
        return None;
    }
    match fetch_claude_code_account_metadata_at(&source.profile_url, &login.access_token).await {
        Ok(identity) if same_claude_account(key, &identity) => Some(login),
        Ok(_) => {
            tracing::info!(
                "[key-vault] Claude Code local login belongs to another account; key {} not recovered from it",
                key.id
            );
            None
        }
        Err(err) => {
            tracing::warn!(
                "[key-vault] Claude Code local login identity check failed for key {}: {}",
                key.id,
                err
            );
            None
        }
    }
}

impl KeyService {
    /// Replace the key's tokens with the ones the Claude Code CLI already
    /// rotated. From here on the key shares the CLI's login, so it is recorded
    /// as linked.
    pub(super) fn adopt_claude_cli_login(
        &self,
        key_id: &str,
        login: LocalClaudeCodeLogin,
    ) -> Result<Option<ModelKey>, String> {
        self.update_store(|store| {
            let entry = store.keys.get_mut(key_id)?;
            entry.session_token = Some(login.access_token);
            if let Some(refresh_token) = login.refresh_token {
                entry
                    .env_vars
                    .insert(CLAUDE_CODE_REFRESH_TOKEN_ENV.to_string(), refresh_token);
            }
            if let Some(expires_at_millis) = login.expires_at_millis {
                entry.env_vars.insert(
                    CLAUDE_CODE_EXPIRES_AT_ENV.to_string(),
                    expires_at_millis.to_string(),
                );
                let expires_in = ((expires_at_millis - Utc::now().timestamp_millis()) / 1000).max(0);
                entry.env_vars.insert(
                    CLAUDE_CODE_EXPIRES_IN_ENV.to_string(),
                    expires_in.to_string(),
                );
            }
            entry.account_metadata.insert(
                ACCOUNT_SETUP_METHOD_METADATA_KEY.to_string(),
                ACCOUNT_SETUP_METHOD_AUTODETECT.to_string(),
            );
            Self::reset_oauth_refresh_failure_state(entry);
            entry.enabled = true;
            entry.updated_at = Utc::now();
            store.updated_at = Utc::now();
            tracing::info!(
                "[key-vault] Claude Code OAuth key {} adopted tokens rotated by the Claude Code CLI",
                key_id
            );
            Some(entry.clone())
        })
    }
}
