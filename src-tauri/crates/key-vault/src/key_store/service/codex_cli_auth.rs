//! Coordination with the Codex CLI's own auth file (`$CODEX_HOME/auth.json`,
//! default `~/.codex/auth.json`) for keys that were imported from it.
//!
//! A scan-imported key holds a *copy* of the CLI's refresh token. That token is
//! rotates; reuse can be rejected by the server (`refresh_token_reused`).
//! No assumption is made about a production reuse grace period. The Codex CLI
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
    crate::auto_detect::local_codex_auth_path()
}

pub(super) fn codex_cli_auth_path_for_key(key: &ModelKey) -> Option<PathBuf> {
    key.codex_cli_auth_path
        .clone()
        .or_else(local_codex_cli_auth_path)
}

pub(super) fn bind_codex_cli_source(key: &mut ModelKey) {
    if !key.is_native_oauth_for(&super::super::types::ModelType::Codex) {
        return;
    }
    let method = key
        .account_metadata
        .get(ACCOUNT_SETUP_METHOD_METADATA_KEY)
        .map(String::as_str);
    if method.is_some_and(|method| method != ACCOUNT_SETUP_METHOD_AUTODETECT) {
        key.codex_cli_auth_path = None;
        return;
    }
    if key.codex_cli_auth_path.is_some() {
        return;
    }
    if let Some(path) = local_codex_cli_auth_path() {
        if read_codex_cli_tokens(&path)
            .is_some_and(|tokens| shares_codex_cli_refresh_token(key, &tokens))
        {
            key.codex_cli_auth_path = Some(path);
        }
    }
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
    let account = codex_account_id_from_jwt(&tokens.access_token)?;
    if tokens.account_id.as_ref().is_some_and(|id| id != &account)
        || tokens
            .id_token
            .as_deref()
            .and_then(codex_account_id_from_jwt)
            .is_some_and(|id| id != account)
    {
        return None;
    }
    Some(account)
}

pub(super) fn source_token_hash(token: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(token.as_bytes()))
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
    if cli.refresh_token.is_none()
        || cli.access_token == rejected_access_token
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
        expected: &ModelKey,
        tokens: CodexCliTokens,
        source_path: Option<&Path>,
    ) -> Result<Option<ModelKey>, String> {
        let key_id = &expected.id;
        self.update_store(|store| {
            let entry = store.keys.get_mut(key_id)?;
            if !entry.matches_oauth_snapshot(expected) {
                return Some(entry.clone());
            }
            entry.codex_cli_auth_path = source_path.map(Path::to_path_buf);
            entry.codex_pending_source_token_hash = None;
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
            Self::complete_oauth_refresh(entry);
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
    pub(super) fn mark_key_linked_to_codex_cli(&self, expected: &ModelKey) -> Result<(), String> {
        self.update_store(|store| {
            if let Some(entry) = store.keys.get_mut(&expected.id) {
                if !entry.matches_oauth_snapshot(expected) {
                    return;
                }
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
/// Serialize cooperating ORG2 writers and recheck the complete source before
/// rename. This is NOT an atomic CAS against the native CLI: it does not take
/// our lock and can still write between the last comparison and rename.
#[cfg(test)]
pub(super) fn write_back_rotated_codex_cli_tokens(
    path: &Path,
    spent_refresh_token: &str,
    rotated: &ModelKey,
) -> Result<bool, String> {
    write_back_codex_cli_tokens_by_hash(path, &source_token_hash(spent_refresh_token), rotated)
}

fn write_back_codex_cli_tokens_by_hash(
    path: &Path,
    expected_hash: &str,
    rotated: &ModelKey,
) -> Result<bool, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock = options
        .open(path.with_extension("orgii.lock"))
        .map_err(|err| format!("Open Codex source lock: {err}"))?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .map_err(|_| "Codex auth source is being written by another ORG2 instance".to_string())?;
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
    let Some(source_refresh) = non_empty(tokens.get("refresh_token")) else {
        return Ok(false);
    };
    // A previous write may have succeeded before its intent was cleared.
    if key_refresh_token(rotated) == Some(source_refresh.as_str()) {
        return Ok(true);
    }
    if source_token_hash(&source_refresh) != expected_hash {
        return Ok(false);
    }
    let (Some(access_token), Some(refresh_token)) = (
        rotated
            .session_token
            .as_deref()
            .filter(|token| !token.is_empty()),
        key_refresh_token(rotated),
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
    write_private_file_if_unchanged(path, &content, serialized.as_bytes())
}

/// Unique owner-only temp file; clean up on failure or a changed source.
fn write_private_file_if_unchanged(
    path: &Path,
    original: &str,
    bytes: &[u8],
) -> Result<bool, String> {
    use std::io::Write;
    let file_name = path
        .file_name()
        .ok_or("Auth path has no filename")?
        .to_string_lossy();
    let temp_path = path.with_file_name(format!(".{file_name}.orgii-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> std::io::Result<bool> {
        let mut file = options.open(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if std::fs::read_to_string(path).ok().as_deref() != Some(original) {
            return Ok(false);
        }
        std::fs::rename(&temp_path, path)?;
        Ok(true)
    })();
    let _ = std::fs::remove_file(&temp_path);
    result.map_err(|err| format!("Write Codex auth source: {err}"))
}

impl KeyService {
    pub(super) fn retry_codex_source_writeback(&self, key: &ModelKey) {
        if key.codex_pending_source_token_hash.is_some() {
            if let Some(path) = key.codex_cli_auth_path.as_deref() {
                if let Err(err) = self.write_back_codex_source_if_current(path, "", key) {
                    tracing::warn!(key_id = %key.id, error = %err, "Codex source remains unsynchronized");
                }
            }
        }
    }

    /// Keep the vault snapshot stable across source writeback. The external CLI
    /// still has the independent race documented on the file writer above.
    pub(super) fn write_back_codex_source_if_current(
        &self,
        path: &Path,
        spent_refresh_token: &str,
        rotated: &ModelKey,
    ) -> Result<bool, String> {
        self.update_store(|store| {
            let Some(current) = store
                .keys
                .get_mut(&rotated.id)
                .filter(|current| current.matches_oauth_snapshot(rotated))
            else {
                return Ok(false);
            };
            let expected = current
                .codex_pending_source_token_hash
                .clone()
                .unwrap_or_else(|| source_token_hash(spent_refresh_token));
            let wrote = write_back_codex_cli_tokens_by_hash(path, &expected, rotated)?;
            // false means a replaced/deleted source; only I/O errors retain the intent.
            current.codex_pending_source_token_hash = None;
            Ok(wrote)
        })?
    }
}

#[cfg(test)]
mod writeback_tests {
    use super::*;

    #[test]
    fn changed_source_is_preserved_and_temporary_file_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "new login").unwrap();
        assert!(!write_private_file_if_unchanged(&path, "old login", b"rotated login").unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new login");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn cooperating_writers_cannot_mix_tokens_or_leave_secret_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(
            &path,
            r#"{"tokens":{"access_token":"a0","refresh_token":"r0"},"custom":true}"#,
        )
        .unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let writers: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|name| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let mut key = ModelKey::new(super::super::super::types::ModelType::Codex);
                    key.session_token = Some(name.into());
                    key.env_vars
                        .insert(CODEX_REFRESH_TOKEN_ENV_KEY.into(), name.into());
                    barrier.wait();
                    write_back_rotated_codex_cli_tokens(&path, "r0", &key)
                })
            })
            .collect();
        let wrote = writers
            .into_iter()
            .map(|writer| writer.join().unwrap())
            .filter(|result| matches!(result, Ok(true)))
            .count();
        assert_eq!(wrote, 1);
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            json["tokens"]["access_token"],
            json["tokens"]["refresh_token"]
        );
        assert_eq!(json["custom"], true);
        assert!(!std::fs::read_dir(dir.path()).unwrap().any(|entry| entry
            .unwrap()
            .path()
            .extension()
            .is_some_and(|ext| ext == "tmp")));
    }
}
