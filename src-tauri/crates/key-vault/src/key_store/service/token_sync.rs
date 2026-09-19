//! Write-back of OAuth tokens rotated by an external CLI process, guarded so a
//! stale launch never clobbers a newer Key Vault token.
//!
//! Rotating refresh tokens are single-use: once the spawned CLI refreshes, the
//! copy the vault launched it with is spent. Every provider whose CLI refreshes
//! inside an ORGII-managed profile must therefore flow the rotated tokens back
//! through [`KeyService::sync_cli_oauth_tokens_if_current`], otherwise the next
//! launch re-seeds the profile with a dead token.
//!
//! Two sessions can share one profile, and a run can die before its sync-back.
//! In both cases the profile ends up holding tokens newer than the vault's
//! while the "unchanged since launch" guard no longer matches, so a CLI token
//! that is *provably newer* than the vault's (see [`cli_tokens_are_newer`]) is
//! accepted as well — at sync-back, and through
//! [`KeyService::sync_cli_oauth_tokens_if_newer`] before a launch seeds the
//! profile. Providers that cannot prove it keep their own seed-precedence
//! rule in the platform adapter.

use chrono::Utc;

use core_types::providers::{CODEX_ID_TOKEN_ENV_KEY, CODEX_REFRESH_TOKEN_ENV_KEY};

use super::super::types::{AuthMethod, ModelKey, ModelType};
use super::KeyService;

const KIRO_ACCESS_TOKEN_ENV_KEY: &str = "KIRO_ACCESS_TOKEN";
const KIRO_REFRESH_TOKEN_ENV_KEY: &str = "KIRO_REFRESH_TOKEN";
const KIRO_EXPIRES_AT_ENV_KEY: &str = "KIRO_EXPIRES_AT";

#[derive(Debug, Clone, Default)]
pub struct CliOAuthTokenSync {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    /// Access-token expiry exactly as the CLI persisted it (RFC 3339). Only
    /// providers whose vault shape carries an expiry (Kiro) store it.
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone)]
pub enum CliOAuthTokenSyncOutcome {
    Updated(Box<ModelKey>),
    SkippedNewerKeyVaultToken,
    NotApplicable,
}

fn non_blank(value: Option<String>) -> Option<String> {
    value.filter(|token| !token.trim().is_empty())
}

/// A Kiro `session_token` is either the whole `kiro-cli` token JSON (local
/// scan) or the bare access token (sign-in wizard, which keeps the rest in
/// `env_vars`). `Ok(None)` means "not the JSON shape".
fn kiro_session_token_json(
    entry: &ModelKey,
) -> Result<Option<serde_json::Map<String, serde_json::Value>>, String> {
    let Some(raw) = entry.session_token.as_deref() else {
        return Ok(None);
    };
    if !raw.trim_start().starts_with('{') {
        return Ok(None);
    }
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(serde_json::Value::Object(map)) => Ok(Some(map)),
        // Never echo the payload: it holds the credential.
        _ => Err(format!(
            "Kiro key {} has a malformed session token JSON; refusing to merge CLI tokens",
            entry.id
        )),
    }
}

/// The access token a launch of this key hands to the CLI — the value the
/// session runner later passes back as `launched_access_token`.
///
/// Must mirror the precedence in `agent_env_builder`: for Kiro the token JSON
/// wins over a bare session token, which wins over the `env_vars` mirror.
fn vault_access_token(entry: &ModelKey, model_type: &ModelType) -> Result<Option<String>, String> {
    if *model_type != ModelType::Kiro {
        return Ok(non_blank(entry.session_token.clone()));
    }
    let from_json = kiro_session_token_json(entry)?.map(|map| {
        map.get("access_token")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    });
    let from_session_token = match from_json {
        Some(access_token) => access_token,
        None => entry.session_token.clone(),
    };
    Ok(non_blank(from_session_token)
        .or_else(|| non_blank(entry.env_vars.get(KIRO_ACCESS_TOKEN_ENV_KEY).cloned())))
}

fn set_env_var_if_changed(entry: &mut ModelKey, key: &str, value: &str) -> bool {
    if entry.env_vars.get(key).map(String::as_str) == Some(value) {
        return false;
    }
    entry.env_vars.insert(key.to_string(), value.to_string());
    true
}

/// Codex shape: access token in `session_token`, refresh/id tokens in
/// `env_vars`. `None` means this provider has no slot for the refresh token it
/// was handed; that is decided before anything is written, so a
/// `NotApplicable` outcome never leaves a half-applied entry behind.
fn apply_codex_shaped_tokens(
    entry: &mut ModelKey,
    model_type: &ModelType,
    tokens: CliOAuthTokenSync,
) -> Option<bool> {
    let refresh_token = non_blank(tokens.refresh_token);
    let refresh_key = match model_type {
        ModelType::Codex => Some(CODEX_REFRESH_TOKEN_ENV_KEY),
        _ => None,
    };
    if refresh_token.is_some() && refresh_key.is_none() {
        return None;
    }

    let mut changed = false;
    if let Some(token) = non_blank(tokens.access_token) {
        if entry.session_token.as_deref() != Some(token.as_str()) {
            entry.session_token = Some(token);
            changed = true;
        }
    }
    if let (Some(token), Some(refresh_key)) = (refresh_token, refresh_key) {
        changed |= set_env_var_if_changed(entry, refresh_key, &token);
    }
    if let Some(token) = non_blank(tokens.id_token) {
        if *model_type == ModelType::Codex {
            changed |= set_env_var_if_changed(entry, CODEX_ID_TOKEN_ENV_KEY, &token);
        }
    }
    Some(changed)
}

/// Kiro keeps whichever shape the key was saved in, replacing only the
/// rotating fields so the next `get_env_for_agent` hands out the new tokens:
///
/// - token JSON in `session_token`: rewrite `access_token` / `refresh_token` /
///   `expires_at` in place; `client_id`, `client_secret`, `region`,
///   `start_url` and unknown fields survive untouched.
/// - bare access token: `session_token` plus the `KIRO_*` `env_vars` mirror.
///
/// A legacy OAuth key that still carries its refresh token in `api_key`
/// overrides `KIRO_REFRESH_TOKEN` at launch, so that slot rotates too.
fn apply_kiro_tokens(entry: &mut ModelKey, tokens: CliOAuthTokenSync) -> Result<bool, String> {
    let access_token = non_blank(tokens.access_token);
    let refresh_token = non_blank(tokens.refresh_token);
    let expires_at = non_blank(tokens.expires_at);
    let mut changed = false;

    if let Some(mut token_json) = kiro_session_token_json(entry)? {
        let mut json_changed = false;
        for (field, value) in [
            ("access_token", access_token.as_deref()),
            ("refresh_token", refresh_token.as_deref()),
            ("expires_at", expires_at.as_deref()),
        ] {
            let Some(value) = value else { continue };
            if token_json.get(field).and_then(serde_json::Value::as_str) != Some(value) {
                token_json.insert(field.to_string(), serde_json::Value::from(value));
                json_changed = true;
            }
        }
        if json_changed {
            entry.session_token = Some(serde_json::Value::Object(token_json).to_string());
            changed = true;
        }
    } else {
        if let Some(token) = access_token.as_deref() {
            let has_session_token = non_blank(entry.session_token.clone()).is_some();
            let has_env_mirror = entry.env_vars.contains_key(KIRO_ACCESS_TOKEN_ENV_KEY);
            if has_env_mirror {
                changed |= set_env_var_if_changed(entry, KIRO_ACCESS_TOKEN_ENV_KEY, token);
            }
            if (has_session_token || !has_env_mirror)
                && entry.session_token.as_deref() != Some(token)
            {
                entry.session_token = Some(token.to_string());
                changed = true;
            }
        }
        if let Some(token) = refresh_token.as_deref() {
            changed |= set_env_var_if_changed(entry, KIRO_REFRESH_TOKEN_ENV_KEY, token);
        }
        if let Some(value) = expires_at.as_deref() {
            changed |= set_env_var_if_changed(entry, KIRO_EXPIRES_AT_ENV_KEY, value);
        }
    }

    if let Some(token) = refresh_token {
        let api_key_is_refresh_token = non_blank(entry.api_key.clone()).is_some();
        if api_key_is_refresh_token && entry.api_key.as_deref() != Some(token.as_str()) {
            entry.api_key = Some(token);
            changed = true;
        }
    }
    Ok(changed)
}

/// When CLI-held tokens may replace the vault's.
enum CliTokenSyncGuard<'a> {
    /// Post-run sync-back: accepted when the vault still holds the access token
    /// the run was launched with, or the CLI's token is provably newer.
    LaunchedWith(Option<&'a str>),
    /// Pre-launch reconciliation: only a provably newer CLI token is accepted.
    OnlyIfNewer,
}

const CODEX_AUTH_CLAIMS_KEY: &str = "https://api.openai.com/auth";

fn jwt_claims(token: &str) -> Option<serde_json::Value> {
    use base64::Engine;
    let payload = token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn codex_account_id(access_token: &str) -> Option<String> {
    jwt_claims(access_token)?
        .get(CODEX_AUTH_CLAIMS_KEY)?
        .get("chatgpt_account_id")?
        .as_str()
        .map(str::to_string)
}

/// Whether the CLI's access token was provably issued after the vault's, for
/// the same login. Only Codex can prove it: its access token is a JWT carrying
/// both the expiry (later expiry means a later refresh) and the ChatGPT
/// account. Opaque tokens (Kiro) never qualify — a later expiry there could
/// just as well belong to a login the user has since replaced. Fails closed:
/// both expiries and both accounts must be readable, the CLI's expiry strictly
/// later, the account identical.
fn cli_tokens_are_newer(
    model_type: &ModelType,
    vault_access_token: &str,
    tokens: &CliOAuthTokenSync,
) -> bool {
    if *model_type != ModelType::Codex {
        return false;
    }
    let Some(cli_access_token) = tokens
        .access_token
        .as_deref()
        .filter(|token| !token.trim().is_empty())
    else {
        return false;
    };
    let (Some(vault_expiry), Some(cli_expiry)) = (
        KeyService::jwt_expires_at(vault_access_token),
        KeyService::jwt_expires_at(cli_access_token),
    ) else {
        return false;
    };
    if cli_expiry <= vault_expiry {
        return false;
    }
    matches!(
        (codex_account_id(vault_access_token), codex_account_id(cli_access_token)),
        (Some(vault_account), Some(cli_account)) if vault_account == cli_account
    )
}

impl KeyService {
    /// Post-run sync-back of the tokens a CLI holds in its managed profile.
    pub fn sync_cli_oauth_tokens_if_current(
        &self,
        key_id: &str,
        model_type: ModelType,
        launched_access_token: Option<&str>,
        tokens: CliOAuthTokenSync,
    ) -> Result<CliOAuthTokenSyncOutcome, String> {
        self.sync_cli_oauth_tokens(
            key_id,
            model_type,
            CliTokenSyncGuard::LaunchedWith(launched_access_token),
            tokens,
        )
    }

    /// Pre-launch reconciliation: take over the profile's tokens only when they
    /// are provably newer than the vault's, so seeding the profile never
    /// replaces a rotated token with the spent one the vault still holds.
    pub fn sync_cli_oauth_tokens_if_newer(
        &self,
        key_id: &str,
        model_type: ModelType,
        tokens: CliOAuthTokenSync,
    ) -> Result<CliOAuthTokenSyncOutcome, String> {
        self.sync_cli_oauth_tokens(key_id, model_type, CliTokenSyncGuard::OnlyIfNewer, tokens)
    }

    fn sync_cli_oauth_tokens(
        &self,
        key_id: &str,
        model_type: ModelType,
        guard: CliTokenSyncGuard<'_>,
        tokens: CliOAuthTokenSync,
    ) -> Result<CliOAuthTokenSyncOutcome, String> {
        self.update_store(|store| {
            let Some(entry) = store.keys.get_mut(key_id) else {
                return Ok(CliOAuthTokenSyncOutcome::NotApplicable);
            };
            if entry.model_type != model_type || entry.auth_method != AuthMethod::Oauth {
                return Ok(CliOAuthTokenSyncOutcome::NotApplicable);
            }

            if let Some(current) = vault_access_token(entry, &model_type)? {
                let unchanged_since_launch = match guard {
                    CliTokenSyncGuard::LaunchedWith(launched) => launched
                        .filter(|token| !token.trim().is_empty())
                        .is_none_or(|launched| launched == current),
                    CliTokenSyncGuard::OnlyIfNewer => false,
                };
                if !unchanged_since_launch && !cli_tokens_are_newer(&model_type, &current, &tokens)
                {
                    return Ok(CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken);
                }
            }

            let changed = match model_type {
                ModelType::Kiro => apply_kiro_tokens(entry, tokens)?,
                _ => match apply_codex_shaped_tokens(entry, &model_type, tokens) {
                    Some(changed) => changed,
                    None => return Ok(CliOAuthTokenSyncOutcome::NotApplicable),
                },
            };
            if changed {
                // Refresh-failure bookkeeping (and its auto-disable) only
                // exists for the providers KeyService refreshes itself. For
                // the rest, fresh tokens must not undo a manual disable.
                if entry.is_refreshable_native_oauth() {
                    Self::reset_oauth_refresh_failure_state(entry);
                    entry.enabled = true;
                }
                entry.updated_at = Utc::now();
                store.updated_at = Utc::now();
            }
            Ok(CliOAuthTokenSyncOutcome::Updated(Box::new(entry.clone())))
        })?
    }
}
