//! Token ownership between the Key Vault and an own-key Kiro profile.
//!
//! `kiro-cli` refreshes inside the ORGII-managed profile
//! (`~/.orgii/kiro-cli-profiles/<account>/`) and the refresh token it spends is
//! single-use. Once the child has rotated, the profile — not the vault — holds
//! the only live token, so two invariants keep the pair from diverging:
//!
//! 1. **Sync-back** ([`sync_profile_tokens_to_key_vault`]): after a run, the
//!    profile's tokens are merged back into the vault key (guarded, so a vault
//!    token that changed since launch is never clobbered).
//! 2. **Seed precedence** ([`decide_own_key_seed`]): a launch only overwrites
//!    the profile when the vault actually has something newer to say.
//!
//! Seed precedence needs to tell "the vault changed" (re-scan / re-sign-in:
//! vault wins) apart from "the profile changed" (the child rotated and the
//! sync-back never ran — crash, or skipped behind a sibling session: profile
//! wins). Token values alone cannot say which side moved, so the profile
//! carries an *agreement marker*: the SHA-256 fingerprint of the vault's
//! access + refresh token at the last moment vault and profile were known to
//! match (a seed, or a successful sync-back). If the vault still fingerprints
//! to the marker, the vault has not moved and any difference is the child's
//! rotation. A missing or stale marker falls back to "vault wins", which is
//! the pre-marker behaviour. The marker holds a digest, never a token.

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
    /// Leave the profile's auth records alone: they are newer than the vault.
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

fn read_vault_agreement_marker(profile_home: &Path) -> Option<String> {
    let marker = std::fs::read_to_string(marker_path(profile_home)).ok()?;
    let marker = marker.trim();
    (!marker.is_empty()).then(|| marker.to_string())
}

/// Record that the vault (fingerprinted by the tokens it would seed) and the
/// profile agree. Best effort: losing the marker only degrades the next launch
/// to "vault wins".
pub(super) fn record_vault_agreement(
    profile_home: &Path,
    vault_access_token: &str,
    vault_refresh_token: Option<&str>,
) {
    let fingerprint = token_fingerprint(vault_access_token, vault_refresh_token);
    if let Err(err) = std::fs::write(marker_path(profile_home), fingerprint) {
        tracing::warn!(
            error = %err,
            "[KiroProfile] Failed to record the Key Vault agreement marker"
        );
    }
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
pub(super) fn decide_own_key_seed(
    profile_home: &Path,
    vault_access_token: &str,
    vault_refresh_token: Option<&str>,
) -> OwnKeySeedDecision {
    let Some(profile) = read_profile_tokens(profile_home) else {
        return OwnKeySeedDecision::SeedFromVault;
    };
    let vault_fingerprint = token_fingerprint(vault_access_token, vault_refresh_token);
    let profile_fingerprint =
        token_fingerprint(&profile.access_token, profile.refresh_token.as_deref());
    if profile_fingerprint == vault_fingerprint {
        // Same tokens: re-seeding is idempotent and keeps the device
        // registration record in step with the vault.
        return OwnKeySeedDecision::SeedFromVault;
    }
    if read_vault_agreement_marker(profile_home).as_deref() == Some(vault_fingerprint.as_str()) {
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
    launched_access_token: Option<&str>,
) -> Result<Option<CliOAuthTokenSyncOutcome>, String> {
    let Some(tokens) = read_profile_tokens(profile_home) else {
        return Ok(None);
    };
    let outcome = service
        .sync_cli_oauth_tokens_if_current(
            key_id,
            ModelType::Kiro,
            launched_access_token,
            CliOAuthTokenSync {
                access_token: Some(tokens.access_token),
                refresh_token: tokens.refresh_token,
                id_token: None,
                expires_at: tokens.expires_at,
            },
        )
        .map_err(|err| format!("Failed to save refreshed Kiro CLI tokens: {err}"))?;

    if matches!(outcome, CliOAuthTokenSyncOutcome::Updated(_)) {
        // Fingerprint exactly what the next launch would seed, so the marker
        // stays true whatever shape the key is stored in.
        let env = service.get_env_for_agent(&ModelType::Kiro, Some(key_id));
        if let Some(access_token) = non_blank(env.get("KIRO_ACCESS_TOKEN").map(String::as_str)) {
            record_vault_agreement(
                profile_home,
                access_token,
                env.get("KIRO_REFRESH_TOKEN").map(String::as_str),
            );
        }
    }
    Ok(Some(outcome))
}

#[cfg(test)]
#[path = "profile_tokens_tests.rs"]
mod tests;
