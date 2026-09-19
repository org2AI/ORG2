//! Coordination with the Codex CLI's own auth file (`$CODEX_HOME/auth.json`,
//! default `~/.codex/auth.json`) for keys that were imported from it.
//!
//! A scan-imported key holds a *copy* of the CLI's refresh token. That token is
//! single-use and rotates on every exchange, so whichever holder spends it
//! first invalidates the other copy (`refresh_token_reused`). The Codex CLI
//! guards against this by reloading its auth file before refreshing; the vault
//! follows the same protocol:
//!
//! 1. before spending a linked key's refresh token, and again when an exchange
//!    reports the token already spent, re-read the CLI file and adopt the
//!    tokens the CLI already rotated;
//! 2. after the vault rotates a linked key's tokens itself, write them back so
//!    the CLI's reload picks them up instead of failing on the spent token.

use std::path::{Path, PathBuf};

use chrono::{Duration as ChronoDuration, SecondsFormat, Utc};

use core_types::providers::{CODEX_ID_TOKEN_ENV_KEY, CODEX_REFRESH_TOKEN_ENV_KEY};

use super::super::types::{
    ModelKey, ACCOUNT_SETUP_METHOD_AUTODETECT, ACCOUNT_SETUP_METHOD_METADATA_KEY,
};
use super::{KeyService, OAUTH_REFRESH_EXPIRY_SKEW_SECONDS};

const CODEX_AUTH_CLAIMS_KEY: &str = "https://api.openai.com/auth";

/// Tokens read from a Codex CLI auth file. `access_token` is never empty.
#[derive(Debug, Clone)]
pub(super) struct CodexCliTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub account_id: Option<String>,
}

/// The auth file of the user's own Codex CLI login.
///
/// Unit tests never resolve the developer's real file; they pass an explicit
/// path to `refresh_codex_oauth_key_with`.
pub(super) fn local_codex_cli_auth_path() -> Option<PathBuf> {
    if cfg!(test) {
        return None;
    }
    let codex_home = std::env::var("CODEX_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))?;
    Some(codex_home.join("auth.json"))
}

fn non_empty(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// A missing file is the normal "no CLI login" outcome and stays silent; an
/// unreadable or malformed file is logged so a broken CLI login is visible.
pub(super) fn read_codex_cli_tokens(path: &Path) -> Option<CodexCliTokens> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return None,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "[key-vault] Codex CLI auth file read failed"
            );
            return None;
        }
    };
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(json) => json,
        Err(err) => {
            tracing::warn!(
                path = %path.display(),
                error = %err,
                "[key-vault] Codex CLI auth file parse failed"
            );
            return None;
        }
    };
    let tokens = json.get("tokens")?;
    Some(CodexCliTokens {
        access_token: non_empty(tokens.get("access_token"))?,
        refresh_token: non_empty(tokens.get("refresh_token")),
        id_token: non_empty(tokens.get("id_token")),
        account_id: non_empty(tokens.get("account_id")),
    })
}

fn jwt_claims(token: &str) -> Option<serde_json::Value> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn codex_account_id_from_jwt(token: &str) -> Option<String> {
    non_empty(
        jwt_claims(token)?
            .get(CODEX_AUTH_CLAIMS_KEY)?
            .get("chatgpt_account_id"),
    )
}

fn key_codex_account_id(key: &ModelKey) -> Option<String> {
    key.env_vars
        .get(CODEX_ID_TOKEN_ENV_KEY)
        .and_then(|token| codex_account_id_from_jwt(token))
        .or_else(|| {
            key.session_token
                .as_deref()
                .and_then(codex_account_id_from_jwt)
        })
}

fn cli_codex_account_id(tokens: &CodexCliTokens) -> Option<String> {
    tokens
        .account_id
        .clone()
        .or_else(|| {
            tokens
                .id_token
                .as_deref()
                .and_then(codex_account_id_from_jwt)
        })
        .or_else(|| codex_account_id_from_jwt(&tokens.access_token))
}

fn key_refresh_token(key: &ModelKey) -> Option<&str> {
    key.env_vars
        .get(CODEX_REFRESH_TOKEN_ENV_KEY)
        .map(|token| token.trim())
        .filter(|token| !token.is_empty())
}

/// Whether the key and the CLI file hold the same refresh token right now —
/// proof the key is a copy of the CLI login even without a recorded method.
pub(super) fn shares_codex_cli_refresh_token(key: &ModelKey, cli: &CodexCliTokens) -> bool {
    matches!(
        (key_refresh_token(key), cli.refresh_token.as_deref()),
        (Some(ours), Some(theirs)) if ours == theirs
    )
}

pub(super) fn is_linked_to_codex_cli(key: &ModelKey) -> bool {
    key.account_metadata
        .get(ACCOUNT_SETUP_METHOD_METADATA_KEY)
        .is_some_and(|method| method == ACCOUNT_SETUP_METHOD_AUTODETECT)
}

/// The CLI file's tokens, when they are a usable replacement for the key's.
///
/// Fails closed: both sides must prove the same ChatGPT account, and the CLI's
/// access token must be a different, unexpired one — an expired token would
/// only send the vault straight back into an exchange with the CLI's refresh
/// token.
pub(super) fn adoptable_codex_cli_tokens(
    key: &ModelKey,
    rejected_access_token: &str,
    cli: CodexCliTokens,
) -> Option<CodexCliTokens> {
    if cli.access_token == rejected_access_token
        || key.session_token.as_deref() == Some(cli.access_token.as_str())
    {
        return None;
    }
    let key_account = key_codex_account_id(key)?;
    if cli_codex_account_id(&cli)? != key_account {
        return None;
    }
    let expires_at = KeyService::jwt_expires_at(&cli.access_token)?;
    if Utc::now() + ChronoDuration::seconds(OAUTH_REFRESH_EXPIRY_SKEW_SECONDS) >= expires_at {
        return None;
    }
    Some(cli)
}

impl KeyService {
    /// Replace the key's tokens with the ones the Codex CLI already rotated.
    /// From here on the key shares the CLI's login, so it is recorded as
    /// linked.
    pub(super) fn adopt_codex_cli_tokens(
        &self,
        key_id: &str,
        tokens: CodexCliTokens,
    ) -> Result<Option<ModelKey>, String> {
        self.update_store(|store| {
            let entry = store.keys.get_mut(key_id)?;
            entry.session_token = Some(tokens.access_token);
            if let Some(refresh_token) = tokens.refresh_token {
                entry
                    .env_vars
                    .insert(CODEX_REFRESH_TOKEN_ENV_KEY.to_string(), refresh_token);
            }
            if let Some(id_token) = tokens.id_token {
                entry
                    .env_vars
                    .insert(CODEX_ID_TOKEN_ENV_KEY.to_string(), id_token);
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
                "[key-vault] Codex OAuth key {} adopted tokens rotated by the Codex CLI",
                key_id
            );
            Some(entry.clone())
        })
    }

    /// Record a key proven to be a copy of the CLI login as linked, so keys
    /// imported before the setup method was persisted get the same treatment.
    pub(super) fn mark_key_linked_to_codex_cli(&self, key_id: &str) -> Result<(), String> {
        self.update_store(|store| {
            if let Some(entry) = store.keys.get_mut(key_id) {
                entry.account_metadata.insert(
                    ACCOUNT_SETUP_METHOD_METADATA_KEY.to_string(),
                    ACCOUNT_SETUP_METHOD_AUTODETECT.to_string(),
                );
            }
        })
    }
}

/// Hand tokens the vault just rotated back to the Codex CLI.
///
/// Compare-and-swap on the spent refresh token: the file is only rewritten
/// while it still holds the token the vault consumed, so a login the CLI
/// changed in the meantime is never overwritten. Every other field of the file
/// is preserved.
pub(super) fn write_back_rotated_codex_cli_tokens(
    path: &Path,
    spent_refresh_token: &str,
    rotated: &ModelKey,
) -> Result<bool, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(format!("read {}: {err}", path.display())),
    };
    let mut json: serde_json::Value =
        serde_json::from_str(&content).map_err(|err| format!("parse {}: {err}", path.display()))?;
    let Some(tokens) = json
        .get_mut("tokens")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return Ok(false);
    };
    if non_empty(tokens.get("refresh_token")).as_deref() != Some(spent_refresh_token) {
        return Ok(false);
    }
    let (Some(access_token), Some(refresh_token)) = (
        rotated
            .session_token
            .as_deref()
            .filter(|token| !token.is_empty()),
        key_refresh_token(rotated).filter(|token| *token != spent_refresh_token),
    ) else {
        return Ok(false);
    };

    tokens.insert("access_token".to_string(), access_token.into());
    tokens.insert("refresh_token".to_string(), refresh_token.into());
    if let Some(id_token) = rotated.env_vars.get(CODEX_ID_TOKEN_ENV_KEY) {
        tokens.insert("id_token".to_string(), id_token.as_str().into());
    }
    if let Some(root) = json.as_object_mut() {
        root.insert(
            "last_refresh".to_string(),
            Utc::now()
                .to_rfc3339_opts(SecondsFormat::Micros, true)
                .into(),
        );
    }

    let serialized = serde_json::to_string_pretty(&json)
        .map_err(|err| format!("serialize {}: {err}", path.display()))?;
    write_private_file_atomically(path, serialized.as_bytes())?;
    Ok(true)
}

/// Same-directory temp file + rename, owner-only like the CLI's own file.
fn write_private_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let file_name = path
        .file_name()
        .ok_or_else(|| format!("{} has no file name", path.display()))?
        .to_string_lossy();
    let temp_path = path.with_file_name(format!(".{file_name}.orgii-{}.tmp", std::process::id()));

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = options
        .open(&temp_path)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            file.sync_all()
        })
        .and_then(|()| std::fs::rename(&temp_path, path));
    if let Err(err) = result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("write {}: {err}", path.display()));
    }
    Ok(())
}
