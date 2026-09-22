//! Token sync from CLI auth files back to the key vault: after a run, and
//! before a launch re-seeds a profile.

use std::path::Path;

use core_types::providers::CodexCliAuthConfig;
use key_vault::key_store::{
    CliOAuthTokenSync, CliOAuthTokenSyncOutcome, KeyService, ModelType, KEY_SERVICE,
};

use super::super::platform_adapters::kiro::profile_tokens::sync_profile_tokens_to_key_vault;

/// Tokens the Codex CLI currently holds in a profile's `auth.json`. A missing
/// file or an empty `tokens` object is the normal "nothing to sync" outcome.
fn read_codex_cli_profile_tokens(auth_path: &Path) -> Result<Option<CliOAuthTokenSync>, String> {
    if !auth_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(auth_path).map_err(|err| {
        format!(
            "Failed to read Codex auth file {}: {err}",
            auth_path.display()
        )
    })?;
    let auth: CodexCliAuthConfig = serde_json::from_str(&content).map_err(|err| {
        format!(
            "Failed to parse Codex auth file {}: {err}",
            auth_path.display()
        )
    })?;
    let Some(tokens) = auth.tokens else {
        return Ok(None);
    };

    let access_token = tokens.access_token.filter(|token| !token.trim().is_empty());
    let refresh_token = tokens
        .refresh_token
        .filter(|token| !token.trim().is_empty());
    let id_token = tokens.id_token.filter(|token| !token.trim().is_empty());
    if access_token.is_none() && refresh_token.is_none() && id_token.is_none() {
        return Ok(None);
    }
    Ok(Some(CliOAuthTokenSync {
        access_token,
        refresh_token,
        id_token,
        expires_at: None,
    }))
}

pub(super) fn sync_codex_cli_auth_to_key_vault(
    account_id: Option<&str>,
    generation: Option<u64>,
    profile_home: &Path,
    launched_access_token: Option<&str>,
) -> Result<(), String> {
    let (Some(account_id), Some(generation)) = (account_id, generation) else {
        return Ok(());
    };
    let auth_path = profile_home.join("auth.json");
    let Some(tokens) = read_codex_cli_profile_tokens(&auth_path)? else {
        return Ok(());
    };

    let outcome = KEY_SERVICE
        .sync_cli_oauth_tokens_for_generation(
            account_id,
            ModelType::Codex,
            generation,
            launched_access_token,
            tokens,
        )
        .map_err(|err| format!("Failed to save refreshed Codex CLI tokens: {err}"))?;
    if matches!(outcome, CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken) {
        tracing::warn!(
            "[CodeSession] Skipped Codex CLI auth sync because Key Vault has a newer access token"
        );
    }
    Ok(())
}

/// Before a launch seeds the Codex profile from the vault, take over tokens the
/// profile holds that the vault never received — a run that died before its
/// sync-back, or a sibling session whose sync-back was refused. Seeding first
/// would replace the CLI's rotated refresh token with the spent one.
pub(super) fn reconcile_codex_cli_profile_before_launch(account_id: &str) -> Result<(), String> {
    let key = KEY_SERVICE
        .get_key_by_id(account_id)
        .ok_or("Account was removed before reconcile")?;
    reconcile_codex_cli_profile_with(
        &KEY_SERVICE,
        &app_paths::codex_cli_profile_dir_for_generation(account_id, key.credential_generation)
            .join("auth.json"),
        account_id,
        key.credential_generation,
    )
}

fn reconcile_codex_cli_profile_with(
    service: &KeyService,
    auth_path: &Path,
    account_id: &str,
    generation: u64,
) -> Result<(), String> {
    let Some(tokens) = read_codex_cli_profile_tokens(auth_path)? else {
        return Ok(());
    };
    let outcome = service
        .sync_cli_oauth_tokens_if_newer_for_generation(
            account_id,
            ModelType::Codex,
            generation,
            tokens,
        )
        .map_err(|err| format!("Failed to reconcile Codex CLI profile tokens: {err}"))?;
    if matches!(outcome, CliOAuthTokenSyncOutcome::Updated(_)) {
        tracing::info!(
            "[CodeSession] Reconciled Codex CLI profile tokens into Key Vault before launch"
        );
    }
    Ok(())
}

/// Kiro counterpart of the Codex sync: `kiro-cli` refreshes inside the
/// account-scoped profile HOME, so the tokens it holds there after the run are
/// the only live ones and must replace the copy the vault launched it with.
pub(super) fn sync_kiro_cli_auth_to_key_vault(
    account_id: Option<&str>,
    profile_home: &Path,
    generation: u64,
    launched_access_token: Option<&str>,
) -> Result<(), String> {
    let Some(account_id) = account_id else {
        return Ok(());
    };
    let outcome = sync_profile_tokens_to_key_vault(
        &KEY_SERVICE,
        profile_home,
        account_id,
        generation,
        launched_access_token,
    )?;
    if matches!(
        outcome,
        Some(CliOAuthTokenSyncOutcome::SkippedNewerKeyVaultToken)
    ) {
        tracing::warn!(
            "[CodeSession] Skipped Kiro CLI auth sync because Key Vault has a newer access token"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use chrono::{Duration, Utc};
    use core_types::providers::CODEX_REFRESH_TOKEN_ENV_KEY;
    use key_vault::key_store::{AuthMethod, ModelKey};

    fn codex_access_token(account_id: &str, expires_in: Duration) -> String {
        let payload = serde_json::json!({
            "exp": (Utc::now() + expires_in).timestamp(),
            "https://api.openai.com/auth": { "chatgpt_account_id": account_id },
        });
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string());
        format!("header.{encoded}.signature")
    }

    fn vault_with_codex_key(access_token: &str) -> (tempfile::TempDir, KeyService, String) {
        let store_dir = tempfile::tempdir().unwrap();
        let service = KeyService::new(Some(store_dir.path().to_path_buf()));
        let mut key = ModelKey::new(ModelType::Codex);
        key.auth_method = AuthMethod::Oauth;
        key.session_token = Some(access_token.to_string());
        key.env_vars.insert(
            CODEX_REFRESH_TOKEN_ENV_KEY.to_string(),
            "vault-refresh".to_string(),
        );
        let key_id = key.id.clone();
        service.save_key(key).unwrap();
        (store_dir, service, key_id)
    }

    fn write_profile_auth(dir: &tempfile::TempDir, access_token: &str) -> std::path::PathBuf {
        let auth_path = dir.path().join("auth.json");
        let body = serde_json::json!({
            "OPENAI_API_KEY": null,
            "tokens": { "access_token": access_token, "refresh_token": "profile-refresh" },
        });
        std::fs::write(&auth_path, body.to_string()).unwrap();
        auth_path
    }

    fn stored_refresh_token(service: &KeyService, key_id: &str) -> Option<String> {
        service
            .get_key_by_id(key_id)
            .unwrap()
            .env_vars
            .get(CODEX_REFRESH_TOKEN_ENV_KEY)
            .cloned()
    }

    #[test]
    fn reconcile_takes_over_tokens_a_dead_run_left_in_the_profile() {
        let vault_access = codex_access_token("acct-a", Duration::days(2));
        let (_store_dir, service, key_id) = vault_with_codex_key(&vault_access);
        let profile_dir = tempfile::tempdir().unwrap();
        let profile_access = codex_access_token("acct-a", Duration::days(9));
        let auth_path = write_profile_auth(&profile_dir, &profile_access);

        reconcile_codex_cli_profile_with(&service, &auth_path, &key_id, 0).unwrap();

        let stored = service.get_key_by_id(&key_id).unwrap();
        assert_eq!(
            stored.session_token.as_deref(),
            Some(profile_access.as_str())
        );
        assert_eq!(
            stored_refresh_token(&service, &key_id).as_deref(),
            Some("profile-refresh")
        );
    }

    #[test]
    fn reconcile_leaves_a_vault_that_is_already_ahead_of_the_profile() {
        let vault_access = codex_access_token("acct-a", Duration::days(9));
        let (_store_dir, service, key_id) = vault_with_codex_key(&vault_access);
        let profile_dir = tempfile::tempdir().unwrap();
        let auth_path = write_profile_auth(
            &profile_dir,
            &codex_access_token("acct-a", Duration::days(2)),
        );

        reconcile_codex_cli_profile_with(&service, &auth_path, &key_id, 0).unwrap();

        let stored = service.get_key_by_id(&key_id).unwrap();
        assert_eq!(stored.session_token.as_deref(), Some(vault_access.as_str()));
        assert_eq!(
            stored_refresh_token(&service, &key_id).as_deref(),
            Some("vault-refresh")
        );
    }

    #[test]
    fn reconcile_without_a_profile_auth_file_is_a_no_op() {
        let vault_access = codex_access_token("acct-a", Duration::days(2));
        let (_store_dir, service, key_id) = vault_with_codex_key(&vault_access);
        let profile_dir = tempfile::tempdir().unwrap();

        reconcile_codex_cli_profile_with(
            &service,
            &profile_dir.path().join("auth.json"),
            &key_id,
            0,
        )
        .unwrap();

        assert_eq!(
            service
                .get_key_by_id(&key_id)
                .unwrap()
                .session_token
                .as_deref(),
            Some(vault_access.as_str())
        );
    }
}
