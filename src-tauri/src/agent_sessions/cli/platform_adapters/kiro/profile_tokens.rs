//! Kiro auth ownership within a credential-generation-scoped HOME.
//!
//! ORG2 seeds each generation once under a profile initialization lock. After
//! the initialization marker exists, the CLI owns the profile token record;
//! delayed launch snapshots never overwrite it. Explicit credential changes
//! select a different HOME so old running processes cannot affect new logins.
//! Post-run sync verifies the saved key's generation before merging tokens.

use std::path::{Path, PathBuf};

use key_vault::key_store::{CliOAuthTokenSync, CliOAuthTokenSyncOutcome, KeyService, ModelType};
use rusqlite::{params, OpenFlags, OptionalExtension};
use sha2::{Digest, Sha256};

use super::proxy_auth::{
    kiro_sqlite_relative_path, KIRO_TOKEN_KEY, OWN_KEY_EXPIRES_AT_PLACEHOLDER,
    OWN_KEY_REFRESH_TOKEN_PLACEHOLDER,
};

const VAULT_AGREEMENT_MARKER_FILE: &str = ".orgii-kiro-vault-sync";

/// Tokens currently held by a profile's `auth_kv` store. Deliberately not
/// `Debug`: nothing here may reach a log line.
#[derive(Clone, PartialEq, Eq)]
pub(super) struct KiroProfileTokens {
    pub(super) access_token: String,
    pub(super) refresh_token: Option<String>,
    pub(super) expires_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OwnKeySeedDecision {
    /// Write the vault's tokens into the profile.
    SeedFromVault,
    /// Leave initialized auth records under CLI ownership.
    KeepProfile,
}

fn non_blank(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn token_fingerprint(access_token: &str, refresh_token: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(access_token.trim().as_bytes());
    hasher.update([0u8]);
    hasher.update(non_blank(refresh_token).unwrap_or_default().as_bytes());
    format!("{:x}", hasher.finalize())
}

fn marker_path(profile_home: &Path) -> PathBuf {
    profile_home.join(VAULT_AGREEMENT_MARKER_FILE)
}

/// Finish initialization before any CLI may start. The marker holds only a
/// digest; failure is fatal so an unmarked profile cannot begin rotating.
pub(super) fn record_vault_agreement(
    profile_home: &Path,
    vault_access_token: &str,
    vault_refresh_token: Option<&str>,
) -> Result<(), String> {
    let fingerprint = token_fingerprint(vault_access_token, vault_refresh_token);
    std::fs::write(marker_path(profile_home), fingerprint)
        .map_err(|err| format!("Record Kiro profile initialization: {err}"))
}

/// Read the tokens `kiro-cli` currently holds in this profile.
///
/// Missing database or missing row is a silent `None` (nothing was ever
/// seeded); anything malformed warns and is also `None`. The placeholders the
/// seeder writes for absent vault fields are mapped back to `None` so they can
/// never be mistaken for real tokens.
pub(super) fn read_profile_tokens(profile_home: &Path) -> Option<KiroProfileTokens> {
    let db_path = profile_home.join(kiro_sqlite_relative_path());
    if !db_path.exists() {
        return None;
    }
    let conn = match rusqlite::Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(conn) => conn,
        Err(err) => {
            tracing::warn!(error = %err, "[KiroProfile] Failed to open the profile auth DB read-only");
            return None;
        }
    };
    let token_json: Option<String> = match conn
        .query_row(
            "SELECT value FROM auth_kv WHERE key = ?1",
            params![KIRO_TOKEN_KEY],
            |row| row.get(0),
        )
        .optional()
    {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(error = %err, "[KiroProfile] Failed to read the profile token record");
            return None;
        }
    };
    let token_json = token_json?;
    let token: serde_json::Value = match serde_json::from_str(&token_json) {
        Ok(token) => token,
        Err(err) => {
            tracing::warn!(
                error = %err,
                len = token_json.len(),
                "[KiroProfile] Profile token record is not valid JSON; ignoring it"
            );
            return None;
        }
    };
    let field = |name: &str| non_blank(token.get(name).and_then(serde_json::Value::as_str));
    let Some(access_token) = field("access_token") else {
        tracing::warn!("[KiroProfile] Profile token record has no access_token; ignoring it");
        return None;
    };
    Some(KiroProfileTokens {
        access_token: access_token.to_string(),
        refresh_token: field("refresh_token")
            .filter(|token| *token != OWN_KEY_REFRESH_TOKEN_PLACEHOLDER)
            .map(str::to_string),
        expires_at: field("expires_at")
            .filter(|value| *value != OWN_KEY_EXPIRES_AT_PLACEHOLDER)
            .map(str::to_string),
    })
}

/// Decide whether a launch may overwrite the profile's auth records with the
/// vault's tokens. See the module docs for the marker semantics.
pub(super) fn decide_own_key_seed(profile_home: &Path) -> OwnKeySeedDecision {
    // The caller selects a generation-scoped HOME. Once initialized, only
    // the CLI may rotate its auth record; vault arguments may be a delayed
    // launch snapshot. Reconnection uses a different HOME, not this fallback.
    if marker_path(profile_home).exists() {
        return OwnKeySeedDecision::KeepProfile;
    }
    OwnKeySeedDecision::SeedFromVault
}

/// Merge the tokens the CLI now holds in `profile_home` back into vault key
/// `key_id`. `Ok(None)` means the profile had nothing readable to sync.
///
/// `launched_access_token` is the `KIRO_ACCESS_TOKEN` this run was launched
/// with; the vault refuses the write if its own token has changed since.
pub(crate) fn sync_profile_tokens_to_key_vault(
    service: &KeyService,
    profile_home: &Path,
    key_id: &str,
    generation: u64,
    launched_access_token: Option<&str>,
) -> Result<Option<CliOAuthTokenSyncOutcome>, String> {
    let Some(tokens) = read_profile_tokens(profile_home) else {
        return Ok(None);
    };
    let outcome = service
        .sync_cli_oauth_tokens_for_generation(
            key_id,
            ModelType::Kiro,
            generation,
            launched_access_token,
            CliOAuthTokenSync {
                access_token: Some(tokens.access_token),
                refresh_token: tokens.refresh_token,
                id_token: None,
                expires_at: tokens.expires_at,
            },
        )
        .map_err(|err| format!("Failed to save refreshed Kiro CLI tokens: {err}"))?;

    Ok(Some(outcome))
}

#[cfg(test)]
#[path = "profile_tokens_tests.rs"]
mod tests;
